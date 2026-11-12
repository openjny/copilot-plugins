import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelError, emptyDoc, readDoc } from './model.mjs';

export const CANVAS_ID = 'openjny-gantt-chart';
const RECENT_FORMAT = 'openjny-gantt-chart-recent';
const RECENT_MAX = 10;

export const copilotHome = () => (process.env.COPILOT_HOME ? process.env.COPILOT_HOME : path.join(os.homedir(), '.copilot'));
export const dataDir = () => path.join(copilotHome(), 'extension-data', CANVAS_ID);
export const pathKey = (file) => (process.platform === 'win32' ? file.toLowerCase() : file);
export const hashText = (text) => createHash('sha1').update(text).digest('hex');

/** Resolves a user-supplied chart path against the session's working directory. */
export function resolveChartPath(input, baseDir) {
  if (typeof input !== 'string' || !input.trim()) throw new ModelError('invalid_path', 'path は空でない文字列で指定してください。');
  const file = path.resolve(baseDir || process.cwd(), input.trim());
  if (path.extname(file).toLowerCase() !== '.json') {
    throw new ModelError('invalid_path', 'ファイル名の拡張子は .json にしてください（例: plan.gantt.json）。');
  }
  return file;
}

const ioError = (error, what) => new ModelError('io_error', `${what}に失敗しました: ${error?.message ?? error}`);

/** Reads and validates a chart file. An empty file counts as a new chart. */
export async function readChartFile(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ModelError('file_missing', 'ファイルが見つかりません。');
    throw ioError(error, 'ファイルの読み込み');
  }
  const hash = hashText(text);
  const body = text.replace(/^\uFEFF/, '');
  if (!body.trim()) return { doc: emptyDoc(), hash };
  let raw;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    throw new ModelError('file_invalid', `JSON として読み込めません: ${error.message}`);
  }
  try {
    return { doc: readDoc(raw), hash };
  } catch (error) {
    throw error instanceof ModelError ? new ModelError('file_invalid', error.message) : error;
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
    throw ioError(error, 'ファイルの保存');
  }
}

/** Creates a new chart file; the parent folder must exist. */
export async function createChartFile(file, text) {
  try {
    if (!(await fs.stat(path.dirname(file))).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ModelError('invalid_path', `保存先のフォルダーが存在しません: ${path.dirname(file)}`);
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
    if (error?.code !== 'ENOENT') log(`最近使ったファイルを読み込めません: ${error.message}`);
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
    log(`最近使ったファイルの一覧が壊れていたため ${kept} に退避しました: ${error.message}`);
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
    log(`最近使ったファイルを保存できません: ${error.message}`);
  }
}

// ---- Color theme, kept here because the page's origin (its port) changes on every start -------------------

export const THEMES = ['auto', 'light', 'dark'];
const themeFile = () => path.join(dataDir(), 'theme.json');

/** Returns the saved theme, or "auto" (follow the OS) when nothing usable is saved. */
export async function loadTheme() {
  try {
    const { theme } = JSON.parse(await fs.readFile(themeFile(), 'utf8'));
    return THEMES.includes(theme) ? theme : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveTheme(theme) {
  if (!THEMES.includes(theme)) throw new ModelError('invalid_request', `theme は ${THEMES.join(' / ')} のいずれかにしてください。`);
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await writeAtomic(themeFile(), `${JSON.stringify({ theme })}\n`);
  } catch (error) {
    throw ioError(error, 'テーマの保存');
  }
}
