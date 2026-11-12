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

const newChart = () => {
  const chart = new Chart({ baseDir: dir });
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
  raw.tasks.push({ id: 'x1', name: 'B', level: 0, start: '2026-11-17', duration: 1, progress: 0 });
  await writeFile(file, JSON.stringify(raw), 'utf8');
  await chart.mutate([{ op: 'update', id: 't1', progress: 50 }]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.tasks.map((task) => task.name), ['A', 'B']);
  assert.equal(saved.tasks[0].progress, 50);
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
  assert.match(await html.text(), /<title>ガントチャート<\/title>/);
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
