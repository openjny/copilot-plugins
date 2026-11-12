import path from 'node:path';
import { serializeDoc } from './format.mjs';
import { t } from './i18n.mjs';
import { ModelError, applyOps, emptyDoc, fail } from './model.mjs';
import { startServer } from './server.mjs';
import { createChartFile, hashText, loadRecent, pathKey, readChartFile, rememberRecent, resolveChartPath, statStamp, withFileLock, writeAtomic } from './store.mjs';

const POLL_MS = 1000;
const MAX_HISTORY = 100;

/** A short name for what a list of ops does, for the undo / redo tooltips ("update.progress", "add", "mixed"...). */
export function historyLabel(ops) {
  const names = new Set(ops.map((op) => op?.op));
  if (names.size !== 1) return 'mixed';
  const [name] = names;
  if (name !== 'update') return name;
  const fields = new Set(ops.flatMap((op) => Object.keys(op).filter((key) => key !== 'op' && key !== 'id')));
  return fields.size === 1 ? `update.${[...fields][0]}` : 'update';
}

/** One open panel: the chart file it shows, the page server, and the live state sent to the page. */
export class Chart {
  constructor({ baseDir, log = () => {} } = {}) {
    this.baseDir = baseDir;
    this.log = log;
    this.rev = 0;
    this.file = null;
    this.doc = null;
    this.hash = null;
    this.stamp = null;
    this.error = null;
    this.selection = null;
    this.selectionIds = [];
    this.reportedSelection = null;
    this.recent = [];
    this.listeners = new Set();
    this.server = null;
    this.timer = null;
    this.polling = false;
    // Undo / redo. A document is never changed after it is adopted (an edit works on a copy), so the history
    // keeps the documents themselves: { doc, label } is the state before the change called `label`.
    this.past = [];
    this.future = [];
  }

  get url() {
    return this.server?.url;
  }

  get title() {
    return this.doc?.project.name || (this.file ? path.basename(this.file) : t('app.name'));
  }

  async ensureServer() {
    if (!this.server) this.server = await startServer(this, { log: this.log });
    if (!this.file) this.recent = await loadRecent(this.log);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clientState() {
    return {
      rev: this.rev,
      file: this.file ? { path: this.file, name: path.basename(this.file) } : null,
      doc: this.doc ? { project: this.doc.project, tasks: this.doc.tasks } : null,
      versions: this.doc ? this.doc.versions.map((version) => ({ id: version.id, name: version.name, createdAt: version.createdAt, taskCount: version.tasks.length })) : [],
      history: { undo: this.past.at(-1)?.label ?? null, redo: this.future.at(-1)?.label ?? null },
      error: this.error ? { code: this.error.code, message: this.error.message } : null,
      selection: this.selection,
      recent: this.file ? [] : this.recent,
    };
  }

  #changed() {
    this.rev++;
    const json = JSON.stringify(this.clientState());
    for (const listener of this.listeners) listener(json);
  }

  /** Remembers the current document as the state before a change; a new change ends the redo chain. */
  #record(label) {
    this.past.push({ doc: this.doc, label });
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  /** Opens a chart file, creating it when it does not exist yet. A damaged file is reported, never replaced. */
  async openFile(input, { name } = {}) {
    const file = resolveChartPath(input, this.baseDir);
    await withFileLock(pathKey(file), async () => {
      let loaded;
      try {
        loaded = await readChartFile(file);
      } catch (error) {
        if (!(error instanceof ModelError) || error.code !== 'file_missing') throw error;
        const doc = emptyDoc(name ?? path.basename(file).replace(/(\.gantt)?\.json$/i, ''));
        const text = serializeDoc(doc);
        await createChartFile(file, text);
        loaded = { doc, hash: hashText(text) };
      }
      this.file = file;
      this.doc = loaded.doc;
      this.hash = loaded.hash;
      this.stamp = await statStamp(file);
      this.error = null;
      this.selection = null;
      this.selectionIds = [];
      this.reportedSelection = null;
      this.past = [];
      this.future = [];
    });
    this.#startPolling();
    this.#changed();
    await rememberRecent(file, this.log);
  }

  async closeFile() {
    this.#stopPolling();
    this.file = null;
    this.doc = null;
    this.hash = null;
    this.stamp = null;
    this.error = null;
    this.selection = null;
    this.selectionIds = [];
    this.past = [];
    this.future = [];
    this.recent = await loadRecent(this.log);
    this.#changed();
  }

  /** Reads the file again and adopts what is on disk. Returns true when the state changed. */
  refresh() {
    if (!this.file) return Promise.resolve(false);
    return withFileLock(pathKey(this.file), () => this.#syncFromDisk());
  }

  async #syncFromDisk() {
    let loaded;
    try {
      loaded = await readChartFile(this.file);
    } catch (error) {
      if (!(error instanceof ModelError) || error.code === 'io_error') throw error;
      this.stamp = await statStamp(this.file);
      if (this.error?.code === error.code && this.error.message === error.message) return false;
      this.error = { code: error.code, message: error.message };
      this.#changed();
      return true;
    }
    this.stamp = await statStamp(this.file);
    if (loaded.hash === this.hash && !this.error) return false;
    // A change made outside (a text editor, another program) can be undone like any other.
    if (this.doc && !this.error) this.#record('external');
    this.doc = loaded.doc;
    this.hash = loaded.hash;
    this.error = null;
    this.#pruneSelection();
    this.#changed();
    return true;
  }

  /** Makes `doc` the chart's content and saves it (`text` is its file text, when known). */
  async #adopt(doc, text = serializeDoc(doc)) {
    const hash = hashText(text);
    if (hash !== this.hash) {
      await writeAtomic(this.file, text);
      this.hash = hash;
      this.stamp = await statStamp(this.file);
    }
    this.doc = doc;
    this.#pruneSelection();
    this.#changed();
  }

  /** Applies operations to the file's current content, all or nothing, and saves them. */
  mutate(ops) {
    if (!this.file) fail('no_file', 'err.noFile');
    return withFileLock(pathKey(this.file), async () => {
      await this.#syncFromDisk();
      if (this.error) fail('file_invalid', 'err.fileInvalidEdit', { message: this.error.message });
      const { doc, results, shifted, dropped } = applyOps(this.doc, ops);
      const text = serializeDoc(doc);
      // An edit that changes nothing is not a step to undo.
      if (hashText(text) !== this.hash) this.#record(historyLabel(ops));
      await this.#adopt(doc, text);
      return { results, shifted, dropped };
    });
  }

  /** Goes back to the state before the last change (or forward again): `direction` is "undo" or "redo". */
  step(direction) {
    if (!this.file) fail('no_file', 'err.noFile');
    return withFileLock(pathKey(this.file), async () => {
      await this.#syncFromDisk();
      if (this.error) fail('file_invalid', 'err.fileInvalidEdit', { message: this.error.message });
      const [from, to] = direction === 'undo' ? [this.past, this.future] : [this.future, this.past];
      const entry = from.pop();
      if (!entry) fail('nothing_to_do', direction === 'undo' ? 'err.nothingToUndo' : 'err.nothingToRedo');
      to.push({ doc: this.doc, label: entry.label });
      await this.#adopt(entry.doc);
      return { label: entry.label };
    });
  }

  undo() {
    return this.step('undo');
  }

  redo() {
    return this.step('redo');
  }

  #pruneSelection() {
    const known = new Set(this.doc?.tasks.map((task) => task.id));
    this.selectionIds = this.selectionIds.filter((id) => known.has(id));
    if (this.selection && !known.has(this.selection)) this.selection = this.selectionIds[0] ?? null;
  }

  /** `id` is the task the user is working on; `ids` all the tasks selected (including it). */
  select(id, ids) {
    const known = new Set(this.doc?.tasks.map((task) => task.id));
    if (id !== null && (typeof id !== 'string' || !known.has(id))) return;
    this.selection = id;
    const more = Array.isArray(ids) ? ids.filter((other) => typeof other === 'string' && known.has(other)) : [];
    this.selectionIds = [...new Set([...(id ? [id] : []), ...more])].slice(0, 200);
  }

  /** The tasks the user selected, once per change, for the agent's next turn. */
  consumeSelection() {
    const key = this.selectionIds.join(',');
    if (!this.doc || key === this.reportedSelection) return null;
    this.reportedSelection = key;
    const tasks = [];
    for (const id of this.selectionIds) {
      const index = this.doc.tasks.findIndex((task) => task.id === id);
      if (index >= 0) tasks.push({ row: index + 1, id, name: this.doc.tasks[index].name });
    }
    return tasks.length ? { file: this.file, tasks } : null;
  }

  exportText() {
    return serializeDoc({ ...this.doc, versions: [] });
  }

  #startPolling() {
    this.#stopPolling();
    this.timer = setInterval(() => this.#poll(), POLL_MS);
    this.timer.unref?.();
  }

  #stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async #poll() {
    if (!this.file || this.polling) return;
    this.polling = true;
    try {
      if ((await statStamp(this.file)) !== this.stamp) await this.refresh();
    } catch (error) {
      this.log(`Failed to check the file: ${error.message}`);
    } finally {
      this.polling = false;
    }
  }

  async close() {
    this.#stopPolling();
    this.listeners.clear();
    const server = this.server;
    this.server = null;
    await server?.close();
  }
}
