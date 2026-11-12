import path from 'node:path';
import { ModelError, applyOps, emptyDoc, serializeDoc } from './model.mjs';
import { startServer } from './server.mjs';
import { createChartFile, hashText, loadRecent, pathKey, readChartFile, rememberRecent, resolveChartPath, statStamp, withFileLock, writeAtomic } from './store.mjs';

const POLL_MS = 1000;

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
  }

  get url() {
    return this.server?.url;
  }

  get title() {
    return this.doc?.project.name || (this.file ? path.basename(this.file) : 'ガントチャート');
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
      versions: this.doc ? this.doc.snapshots.map((snap) => ({ id: snap.id, name: snap.name, createdAt: snap.createdAt, taskCount: snap.tasks.length })) : [],
      error: this.error,
      selection: this.selection,
      recent: this.file ? [] : this.recent,
    };
  }

  #changed() {
    this.rev++;
    const json = JSON.stringify(this.clientState());
    for (const listener of this.listeners) listener(json);
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
    this.doc = loaded.doc;
    this.hash = loaded.hash;
    this.error = null;
    this.#pruneSelection();
    this.#changed();
    return true;
  }

  /** Applies operations to the file's current content, all or nothing, and saves them. */
  mutate(ops) {
    if (!this.file) throw new ModelError('no_file', 'ガントチャートのファイルが開かれていません。');
    return withFileLock(pathKey(this.file), async () => {
      await this.#syncFromDisk();
      if (this.error) throw new ModelError('file_invalid', `ファイルの問題を解消してから編集してください: ${this.error.message}`);
      const { doc, results } = applyOps(this.doc, ops);
      const text = serializeDoc(doc);
      const hash = hashText(text);
      if (hash !== this.hash) {
        await writeAtomic(this.file, text);
        this.hash = hash;
        this.stamp = await statStamp(this.file);
      }
      this.doc = doc;
      this.#pruneSelection();
      this.#changed();
      return { results };
    });
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
    return serializeDoc({ ...this.doc, snapshots: [] });
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
      this.log(`ファイルの確認に失敗しました: ${error.message}`);
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
