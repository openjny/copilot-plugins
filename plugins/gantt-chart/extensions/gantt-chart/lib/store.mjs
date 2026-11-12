import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDoc } from './format.mjs';
import { LOCALE_CHOICES, t } from './i18n.mjs';
import { ModelError, emptyDoc, fail } from './model.mjs';

export const CANVAS_ID = 'openjny-gantt-chart';
const RECENT_FORMAT = 'openjny-gantt-chart-recent';
const RECENT_MAX = 10;

export const copilotHome = () => (process.env.COPILOT_HOME ? process.env.COPILOT_HOME : path.join(os.homedir(), '.copilot'));
export const dataDir = () => path.join(copilotHome(), 'extension-data', CANVAS_ID);
export const pathKey = (file) => (process.platform === 'win32' ? file.toLowerCase() : file);
export const hashText = (text) => createHash('sha1').update(text).digest('hex');

/** Resolves a user-supplied chart path against the session's working directory. */
export function resolveChartPath(input, baseDir) {
  if (typeof input !== 'string' || !input.trim()) fail('invalid_path', 'err.pathRequired');
  const file = path.resolve(baseDir || process.cwd(), input.trim());
  if (path.extname(file).toLowerCase() !== '.json') fail('invalid_path', 'err.pathExt');
  return file;
}

const ioError = (error, whatKey) => new ModelError('io_error', t('err.io', { what: t(whatKey), message: error?.message ?? error }), 'err.io');

/** Reads and validates a chart file. An empty file counts as a new chart. */
export async function readChartFile(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail('file_missing', 'err.fileMissing');
    throw ioError(error, 'io.readFile');
  }
  const hash = hashText(text);
  const body = text.replace(/^\uFEFF/, '');
  if (!body.trim()) return { doc: emptyDoc(), hash };
  let raw;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    fail('file_invalid', 'err.jsonParse', { message: error.message });
  }
  try {
    return { doc: readDoc(raw), hash };
  } catch (error) {
    throw error instanceof ModelError ? new ModelError('file_invalid', error.message, error.key, error.params) : error;
  }
}

export async function statStamp(file) {
  try {
    const stat = await fs.stat(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/** Writes through a temporary file in the same directory, then renames it over the target. */
export async function writeAtomic(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temp, text, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (error) {
        // Another program (an editor, a virus scanner) may hold the target for a moment on Windows.
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw ioError(error, 'io.writeFile');
  }
}

/** Creates a new chart file; the parent folder must exist. */
export async function createChartFile(file, text) {
  try {
    if (!(await fs.stat(path.dirname(file))).isDirectory()) throw new Error('not a directory');
  } catch {
    fail('invalid_path', 'err.noFolder', { dir: path.dirname(file) });
  }
  await writeAtomic(file, text);
}

const chains = new Map();

/** Runs work one at a time per file, so that panels in this process never interleave their writes. */
export function withFileLock(key, work) {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

// ---- Recently opened charts, kept privately under the Copilot home ---------------------------------------

const recentFile = () => path.join(dataDir(), 'recent.json');

export async function loadRecent(log = () => {}) {
  let text;
  try {
    text = await fs.readFile(recentFile(), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') log(`Cannot read the recent files list: ${error.message}`);
    return [];
  }
  try {
    const raw = JSON.parse(text);
    if (raw?.format !== RECENT_FORMAT || raw.version !== 1 || !Array.isArray(raw.items)) throw new Error('unrecognized format');
    return raw.items.filter((item) => typeof item?.path === 'string' && typeof item.openedAt === 'string').slice(0, RECENT_MAX);
  } catch (error) {
    // Keep the unreadable file for the user instead of overwriting it, and start a new list.
    const kept = `${recentFile()}.corrupt-${Date.now()}`;
    await fs.rename(recentFile(), kept).catch(() => {});
    log(`The recent files list was damaged; moved it to ${kept}: ${error.message}`);
    return [];
  }
}

export async function rememberRecent(file, log = () => {}) {
  try {
    const items = (await loadRecent(log)).filter((item) => pathKey(item.path) !== pathKey(file));
    items.unshift({ path: file, openedAt: new Date().toISOString() });
    await fs.mkdir(dataDir(), { recursive: true });
    await writeAtomic(recentFile(), `${JSON.stringify({ format: RECENT_FORMAT, version: 1, items: items.slice(0, RECENT_MAX) }, null, 2)}\n`);
  } catch (error) {
    log(`Cannot save the recent files list: ${error.message}`);
  }
}

// ---- Preferences (color theme, language), kept here because the page's origin (its port) changes on every start --

export const THEMES = ['auto', 'light', 'dark'];
export const LOCALE_PREFS = LOCALE_CHOICES;
const prefFile = (name) => path.join(dataDir(), `${name}.json`);

/** Returns a saved choice, or "auto" (follow the OS) when nothing usable is saved. */
async function loadChoice(name, choices) {
  try {
    const value = JSON.parse(await fs.readFile(prefFile(name), 'utf8'))[name];
    return choices.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

async function saveChoice(name, value, choices) {
  if (!choices.includes(value)) fail('invalid_request', 'err.badChoice', { name, choices: choices.join(' / ') });
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await writeAtomic(prefFile(name), `${JSON.stringify({ [name]: value })}\n`);
  } catch (error) {
    throw ioError(error, 'io.savePref');
  }
}

export const loadTheme = () => loadChoice('theme', THEMES);
export const saveTheme = (theme) => saveChoice('theme', theme, THEMES);
export const loadLocale = () => loadChoice('locale', LOCALE_PREFS);
export const saveLocale = (locale) => saveChoice('locale', locale, LOCALE_PREFS);
