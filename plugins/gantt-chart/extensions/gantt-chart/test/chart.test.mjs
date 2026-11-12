import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Chart } from '../lib/chart.mjs';

let dir;
const charts = [];

// fetch cannot override the Host header, so this goes through node:http.
const statusWithHost = (url, host) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gantt-chart-test-'));
  process.env.COPILOT_HOME = path.join(dir, 'home');
});

after(async () => {
  await Promise.all(charts.map((chart) => chart.close()));
  await rm(dir, { recursive: true, force: true });
});

const newChart = (options = {}) => {
  const chart = new Chart({ baseDir: dir, ...options });
  charts.push(chart);
  return chart;
};

test('opening a missing file creates it, and edits are saved', async () => {
  const chart = newChart();
  await chart.openFile('plan.gantt.json', { name: 'Plan' });
  const { results } = await chart.mutate([{ op: 'add', name: '設計', start: '2026-11-16', duration: 3 }]);
  assert.equal(results[0].id, 't1');
  const saved = JSON.parse(await readFile(path.join(dir, 'plan.gantt.json'), 'utf8'));
  assert.equal(saved.project.name, 'Plan');
  assert.equal(saved.tasks[0].name, '設計');
});

test('an edit is applied on top of changes made to the file in the meantime', async () => {
  const chart = newChart();
  const file = path.join(dir, 'merge.gantt.json');
  await chart.openFile(file);
  await chart.mutate([{ op: 'add', name: 'A', start: '2026-11-16' }]);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.tasks.push({ id: 'x1', name: 'B', start: '2026-11-17', duration: 1, progress: 0 });
  await writeFile(file, JSON.stringify(raw), 'utf8');
  await chart.mutate([{ op: 'update', id: 't1', progress: 50 }]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.tasks.map((task) => task.name), ['A', 'B']);
  assert.equal(saved.tasks[0].progress, 50);
});

test('undo and redo walk back and forth through the edits, whoever made them', async () => {
  const chart = newChart();
  const file = path.join(dir, 'history.gantt.json');
  await chart.openFile(file);
  const names = () => chart.doc.tasks.map((task) => task.name);
  const saved = async () => JSON.parse(await readFile(file, 'utf8')).tasks.map((task) => task.name);
  assert.deepEqual(chart.clientState().history, { undo: null, redo: null });
  await assert.rejects(() => chart.undo(), (error) => error.code === 'nothing_to_do');

  await chart.mutate([{ op: 'add', id: 'a', name: 'A', start: '2026-11-16' }]);
  await chart.mutate([{ op: 'add', id: 'b', name: 'B' }, { op: 'add', id: 'c', name: 'C' }]);
  await chart.mutate([{ op: 'update', id: 'a', progress: 40 }]);
  assert.deepEqual(chart.clientState().history, { undo: 'update.progress', redo: null });

  await chart.undo();
  assert.equal(chart.doc.tasks[0].progress, 0);
  assert.deepEqual(chart.clientState().history, { undo: 'add', redo: 'update.progress' });
  await chart.undo();
  assert.deepEqual(names(), ['A']);
  assert.deepEqual(await saved(), ['A']);
  await chart.redo();
  assert.deepEqual(names(), ['A', 'B', 'C']);
  assert.deepEqual(await saved(), ['A', 'B', 'C']);

  // A new edit ends the redo chain.
  await chart.mutate([{ op: 'update', id: 'b', name: 'B2' }]);
  assert.equal(chart.clientState().history.redo, null);
  await assert.rejects(() => chart.redo(), (error) => error.code === 'nothing_to_do');
  await chart.undo();
  assert.deepEqual(names(), ['A', 'B', 'C']);

  // An edit that changes nothing is not a step.
  const steps = chart.past.length;
  await chart.mutate([{ op: 'update', id: 'a', name: 'A' }]);
  assert.equal(chart.past.length, steps);
});

test('a change made to the file outside can be undone too, and history is kept per opened file', async () => {
  const chart = newChart();
  const file = path.join(dir, 'outside.gantt.json');
  await chart.openFile(file);
  await chart.mutate([{ op: 'add', id: 'a', name: 'A', start: '2026-11-16' }]);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.tasks.push({ id: 'x', name: 'X', start: '2026-11-17', duration: 1 });
  await writeFile(file, JSON.stringify(raw), 'utf8');
  assert.equal(await chart.refresh(), true);
  assert.equal(chart.clientState().history.undo, 'external');
  await chart.undo();
  assert.deepEqual(chart.doc.tasks.map((task) => task.name), ['A']);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).tasks.map((task) => task.name), ['A']);

  await chart.openFile(path.join(dir, 'other.gantt.json'));
  assert.deepEqual(chart.clientState().history, { undo: null, redo: null });
});

test('the page can undo and redo over HTTP', async () => {
  const chart = newChart();
  await chart.ensureServer();
  await chart.openFile('web-history.gantt.json');
  const post = (route, body = {}) => fetch(`${chart.url}api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('ops', { ops: [{ op: 'add', name: 'A', start: '2026-11-16' }] });
  const undone = await (await post('undo')).json();
  assert.equal(undone.state.doc.tasks.length, 0);
  assert.equal(undone.label, 'add');
  assert.equal(undone.state.history.redo, 'add');
  assert.equal((await (await post('redo')).json()).state.doc.tasks.length, 1);
  assert.equal((await post('redo')).status, 400);
});

test('several selected tasks are reported to the agent once, and the ones that disappear are dropped', async () => {
  const chart = newChart();
  await chart.openFile(path.join(dir, 'selection.gantt.json'));
  await chart.mutate([{ op: 'add', id: 'a', name: 'A', start: '2026-11-16' }, { op: 'add', id: 'b', name: 'B' }, { op: 'add', id: 'c', name: 'C' }]);
  chart.select('b', ['a', 'b', 'zzz', 'c']);
  assert.deepEqual(chart.consumeSelection().tasks.map((task) => task.id), ['b', 'a', 'c']);
  assert.equal(chart.consumeSelection(), null);
  await chart.mutate([{ op: 'delete', id: 'b' }]);
  assert.equal(chart.selection, 'a');
  assert.deepEqual(chart.consumeSelection().tasks.map((task) => task.id), ['a', 'c']);
});

test('a damaged file is reported and never overwritten', async () => {
  const chart = newChart();
  const file = path.join(dir, 'broken.gantt.json');
  await chart.openFile(file);
  await writeFile(file, '{ "format": "openjny-gantt-chart", oops', 'utf8');
  await assert.rejects(() => chart.mutate([{ op: 'add', name: 'A' }]), (error) => error.code === 'file_invalid');
  assert.equal(chart.error.code, 'file_invalid');
  assert.match(await readFile(file, 'utf8'), /oops/);

  await chart.openFile(path.join(dir, 'fresh.gantt.json'));
  await assert.rejects(() => chart.openFile(file), (error) => error.code === 'file_invalid');
  assert.match(await readFile(file, 'utf8'), /oops/);
});

test('fixing the file clears the error', async () => {
  const chart = newChart();
  const file = path.join(dir, 'fixed.gantt.json');
  await chart.openFile(file);
  await writeFile(file, 'not json', 'utf8');
  assert.equal(await chart.refresh(), true);
  assert.ok(chart.error);
  await writeFile(file, '', 'utf8');
  assert.equal(await chart.refresh(), true);
  assert.equal(chart.error, null);
  await chart.mutate([{ op: 'add', name: 'A', start: '2026-11-16' }]);
});

test('the page server only answers its own origin', async () => {
  const chart = newChart();
  await chart.ensureServer();
  await chart.openFile('web.gantt.json');
  const post = (headers) => fetch(`${chart.url}api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ops: [{ op: 'add', name: 'A', start: '2026-11-16' }] }) });

  const ok = await post({});
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).state.doc.tasks.length, 1);
  assert.equal((await post({ Origin: 'http://evil.example' })).status, 403);
  assert.equal(await statusWithHost(chart.url, 'evil.example'), 403);
  const html = await fetch(chart.url);
  assert.match(await html.text(), /<title>Gantt chart<\/title>/);
  const bad = await fetch(`${chart.url}api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'nope' }] }) });
  assert.equal(bad.status, 400);
});

test('the chosen theme is saved and put on the page, and an unknown theme is refused', async () => {
  const chart = newChart();
  await chart.ensureServer();
  const theme = async () => (await (await fetch(chart.url)).text()).match(/<html data-theme="(\w+)" /)?.[1];
  const choose = (value) => fetch(`${chart.url}api/theme`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: value }) });

  assert.equal(await theme(), 'auto');
  assert.equal((await choose('light')).status, 200);
  assert.equal(await theme(), 'light');
  assert.equal((await choose('sepia')).status, 400);
  assert.equal(await theme(), 'light');
});

test('the chosen language is saved and put on the page, and the messages that come back follow it', async () => {
  const chart = newChart();
  await chart.ensureServer();
  await chart.openFile('locale.gantt.json');
  const locale = async () => (await (await fetch(chart.url)).text()).match(/data-locale="(\w+)"/)?.[1];
  const choose = (value, resolved) => fetch(`${chart.url}api/locale`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: value, resolved }) });
  const failMessage = async () => (await (await fetch(`${chart.url}api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'nope' }] }) })).json()).error.message;

  assert.equal(await locale(), 'auto');
  // The page cannot know the language of the OS, so the server puts it on the page for the automatic choice.
  assert.equal((await (await fetch(chart.url)).text()).match(/data-os-locale="([^"]+)"/)?.[1], Intl.DateTimeFormat().resolvedOptions().locale);
  assert.equal((await choose('ja')).status, 200);
  assert.equal(await locale(), 'ja');
  assert.match(await failMessage(), /未知の op/);
  assert.equal((await choose('auto', 'en-US')).status, 200);
  assert.equal(await locale(), 'auto');
  assert.match(await failMessage(), /Unknown op/);
  // Without a language from the page, the automatic choice follows the OS.
  assert.equal((await choose('ja')).status, 200);
  assert.equal((await choose('auto')).status, 200);
  assert.equal(/^ja/i.test(Intl.DateTimeFormat().resolvedOptions().locale), /未知の op/.test(await failMessage()));
  assert.equal((await choose('fr')).status, 400);
  assert.equal(await locale(), 'auto');
});

test('the folder of the open file is shown through the opener, and only for the open file', async () => {
  const opened = [];
  const chart = newChart({ reveal: async (file) => void opened.push(file) });
  await chart.ensureServer();
  const reveal = () => fetch(`${chart.url}api/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await reveal()).status, 400, 'nothing is open yet');
  await chart.openFile('reveal.gantt.json');
  assert.equal((await reveal()).status, 200);
  assert.deepEqual(opened, [path.join(dir, 'reveal.gantt.json')]);
  // What the page sends is never used as a path.
  await fetch(`${chart.url}api/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'C:\\\\Windows' }) });
  assert.equal(opened.length, 2);
  assert.equal(opened[1], opened[0]);
  const failing = newChart({ reveal: async () => { throw new Error('no file manager'); } });
  await failing.ensureServer();
  await failing.openFile('reveal2.gantt.json');
  const answer = await fetch(`${failing.url}api/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(answer.status, 400);
  assert.equal((await answer.json()).error.code, 'reveal_failed');
});

test('the view choices (task names on the chart, task list, its columns) are saved one by one and put on the page', async () => {
  const chart = newChart();
  await chart.ensureServer();
  await chart.openFile('view.gantt.json');
  const attrs = async () => {
    const match = (await (await fetch(chart.url)).text()).match(/data-list="(\w+)" data-labels="(\w+)" data-cols="([^"]*)"/);
    return [match[1], match[2], JSON.parse(decodeURIComponent(match[3])).join('|')].join(',');
  };
  const choose = (body) => fetch(`${chart.url}api/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal(await attrs(), 'closed,on,', 'the name is the only column by default');
  assert.equal((await choose({ list: true })).status, 200);
  assert.equal(await attrs(), 'open,on,');
  assert.equal((await choose({ labels: false })).status, 200);
  assert.equal(await attrs(), 'open,off,');
  assert.equal((await choose({ cols: ['res', 'dur', 'res'] })).status, 200);
  assert.equal(await attrs(), 'open,off,dur|res', 'in their fixed order, without repeats');
  assert.equal((await choose({ list: false })).status, 200);
  assert.equal(await attrs(), 'closed,off,dur|res', 'the columns are kept when the list is folded');
  assert.equal((await choose({ cols: ['p:Hours', 'res', 'p:Hours', 'p:a,b "c"'] })).status, 200);
  assert.equal(await attrs(), 'closed,off,res|p:Hours|p:a,b "c"', 'the properties come after the fixed columns, and any character is safe in a name');
  assert.equal((await choose({ cols: [] })).status, 200);
  assert.equal(await attrs(), 'closed,off,');
  assert.equal((await choose({ cols: ['p:'] })).status, 400, 'a property column needs a name');
  assert.equal((await choose({ list: 'yes' })).status, 400);
  assert.equal((await choose({ zoom: true })).status, 400);
  assert.equal((await choose({ cols: ['name'] })).status, 400, 'the name is not a choice');
  assert.equal((await choose({ cols: 'dur' })).status, 400);
  assert.equal(await attrs(), 'closed,off,');

  // The items hidden in the detail panel and in the status bar are kept the same way.
  const hidden = async () => {
    const html = await (await fetch(chart.url)).text();
    const read = (name) => JSON.parse(decodeURIComponent(html.match(new RegExp(`data-${name}="([^"]*)"`))[1]));
    return { panel: read('panel-off'), status: read('status-off') };
  };
  assert.deepEqual(await hidden(), { panel: [], status: [] }, 'everything is shown by default');
  assert.equal((await choose({ panelOff: ['note', 'p:Hours', 'progress', 'note'], statusOff: ['late', 'tasks'] })).status, 200);
  assert.deepEqual(await hidden(), { panel: ['progress', 'note', 'p:Hours'], status: ['tasks', 'late'] }, 'in their fixed order, without repeats');
  assert.equal((await choose({ list: true })).status, 200);
  assert.deepEqual((await hidden()).panel, ['progress', 'note', 'p:Hours'], 'a change of something else keeps them');
  assert.equal((await choose({ panelOff: ['name'] })).status, 400, 'the name is not an item of the panel');
  assert.equal((await choose({ statusOff: ['progress', 'estimate'] })).status, 400);
  assert.equal((await choose({ statusOff: 'late' })).status, 400);
  assert.deepEqual(await hidden(), { panel: ['progress', 'note', 'p:Hours'], status: ['tasks', 'late'] });
  assert.equal((await choose({ panelOff: [], statusOff: [] })).status, 200);
  assert.deepEqual(await hidden(), { panel: [], status: [] });

  // Choices that arrive together (renaming a property changes several lists) must all be kept.
  const together = await Promise.all([choose({ cols: ['p:Hours'] }), choose({ panelOff: ['p:Hours'] }), choose({ statusOff: ['p:Hours'] })]);
  assert.deepEqual(together.map((response) => response.status), [200, 200, 200]);
  assert.deepEqual(await hidden(), { panel: ['p:Hours'], status: ['p:Hours'] });
  assert.equal(await attrs(), 'open,off,p:Hours');
  assert.equal((await choose({ cols: [], panelOff: [], statusOff: [] })).status, 200);
});