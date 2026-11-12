import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, describe, emptyDoc, finalize, formatDate, makeCalendar, parseDate, parseDuration, readDoc, schedule, serializeDoc } from '../lib/model.mjs';

const NOW = new Date(2026, 10, 12, 9, 30);
const ops = (doc, list) => applyOps(doc, list, { now: NOW }).doc;
const day = (text) => parseDate(text);

/** The chart from the reference screenshot: 設計 (要件定義, 基本設計, 設計レビュー) and 実装. */
function sample() {
  return ops(emptyDoc('sample'), [
    { op: 'add', id: 'a', name: '設計', start: '2026-11-16' },
    { op: 'add', id: 'b', name: '要件定義', parent: 'a', start: '2026-11-16', duration: 2 },
    { op: 'add', id: 'c', name: '基本設計', parent: 'a', duration: 2, predecessors: [{ task: 'b' }] },
    { op: 'add', id: 'd', name: '設計レビュー', parent: 'a', duration: 1, predecessors: [{ task: 'c' }] },
    { op: 'add', id: 'e', name: '実装', start: '2026-11-25', duration: 3, progress: 20 },
  ]);
}

test('working-day calendar skips weekends and holidays', () => {
  const cal = makeCalendar({ holidays: ['2026-11-23'] });
  assert.equal(formatDate(cal.next(day('2026-11-21'))), '2026-11-24');
  assert.equal(formatDate(cal.prev(day('2026-11-22'))), '2026-11-20');
  assert.equal(formatDate(cal.add(day('2026-11-20'), 3)), '2026-11-26');
  assert.equal(cal.count(day('2026-11-16'), day('2026-11-27')), 9);
  assert.equal(cal.diff(day('2026-11-27'), day('2026-11-20')), -4);
});

test('durations parse as working days', () => {
  assert.equal(parseDuration('2w'), 10);
  assert.equal(parseDuration(' 3d '), 3);
  assert.equal(parseDuration('0'), null);
  assert.equal(parseDuration('abc'), null);
});

test('a dependent task follows its predecessor and a parent spans its children', () => {
  const view = describe(sample());
  const by = Object.fromEntries(view.tasks.map((task) => [task.id, task]));
  assert.deepEqual([by.b.start, by.b.end], ['2026-11-16', '2026-11-17']);
  assert.deepEqual([by.c.start, by.c.end], ['2026-11-18', '2026-11-19']);
  assert.deepEqual([by.d.start, by.d.end], ['2026-11-20', '2026-11-20']);
  assert.deepEqual([by.a.start, by.a.end, by.a.duration, by.a.isParent], ['2026-11-16', '2026-11-20', 5, true]);
  assert.equal(view.project.progress, 7.5);
  assert.equal(view.project.workingDays, 10);
  assert.equal(view.project.taskCount, 5);
});

test('lag moves the successor by working days', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: 2 }] }]);
  assert.equal(describe(doc).tasks.find((task) => task.id === 'd').start, '2026-11-24');
});

test('setting the start of a dependent task changes the lag instead', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', start: '2026-11-24' }]);
  const task = doc.tasks.find((item) => item.id === 'd');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 2 }]);
  assert.equal(task.start, '2026-11-24');
});

test('a dependent task cannot start before its predecessors end', () => {
  const doc = sample();
  const before = serializeDoc(doc);
  assert.throws(
    () => ops(doc, [{ op: 'update', id: 'd', start: '2026-11-19' }]),
    (error) => error.code === 'dependency_violation' && error.message.includes('2026-11-20'),
  );
  assert.equal(serializeDoc(doc), before);
});

test('moving a dependent task earlier only lowers the lag of the predecessor that decides the start', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: 3 }, { task: 'b' }] }]);
  const moved = ops(doc, [{ op: 'update', id: 'd', start: '2026-11-23' }]);
  const task = moved.tasks.find((item) => item.id === 'd');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 1 }, { task: 'b', lag: 0 }]);
  assert.equal(task.start, '2026-11-23');
});

test('a negative lag is rejected when editing and when reading a file', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: -1 }] }]), (error) => error.code === 'invalid_input' && /lag/.test(error.message));
  const raw = JSON.parse(serializeDoc(sample()));
  raw.tasks.find((task) => task.id === 'd').predecessors = [{ task: 'c', lag: -1 }];
  assert.throws(() => readDoc(raw), (error) => error.code === 'invalid_file' && /lag/.test(error.message));
});

test('an end date sets the duration in working days', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'e', end: '2026-12-01' }]);
  assert.equal(doc.tasks.find((task) => task.id === 'e').duration, 5);
});

test('end and duration together are rejected', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'e', end: '2026-12-01', duration: 2 }]), /同時/);
});

test('a dependency cycle is rejected and the document stays unchanged', () => {
  const doc = sample();
  const before = serializeDoc(doc);
  assert.throws(() => ops(doc, [{ op: 'update', id: 'b', predecessors: [{ task: 'd' }] }]), (error) => error.code === 'cycle');
  assert.equal(serializeDoc(doc), before);
});

test('a task cannot depend on its own parent', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'b', predecessors: [{ task: 'a' }] }]), (error) => error.code === 'cycle');
});

test('parent tasks take their dates from the children and cannot be edited directly', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'a', progress: 50 }]), (error) => error.code === 'summary_field');
});

test('a batch is all or nothing and names the failing operation', () => {
  assert.throws(
    () => ops(sample(), [{ op: 'update', id: 'e', name: 'x' }, { op: 'update', id: 'zzz', name: 'y' }]),
    (error) => error.code === 'not_found' && error.message.startsWith('ops[1]'),
  );
});

test('indent, outdent, shift and move keep the outline valid', () => {
  let doc = sample();
  doc = ops(doc, [{ op: 'shift', id: 'a', direction: 'down' }]);
  assert.deepEqual(doc.tasks.map((task) => task.id), ['e', 'a', 'b', 'c', 'd']);
  doc = ops(doc, [{ op: 'indent', id: 'a' }]);
  assert.deepEqual(doc.tasks.map((task) => task.level), [0, 1, 2, 2, 2]);
  doc = ops(doc, [{ op: 'outdent', id: 'a' }]);
  doc = ops(doc, [{ op: 'move', id: 'e', after: 'd' }]);
  assert.deepEqual(doc.tasks.map((task) => [task.id, task.level]), [['a', 0], ['b', 1], ['c', 1], ['d', 1], ['e', 1]]);
  assert.throws(() => ops(doc, [{ op: 'move', id: 'a', parent: 'b' }]), (error) => error.code === 'invalid_move');
  assert.throws(() => ops(doc, [{ op: 'indent', id: 'a' }]), (error) => error.code === 'cannot_indent');
});

test('deleting a task removes its subtree and the links to it', () => {
  const doc = ops(sample(), [{ op: 'delete', id: 'c' }]);
  assert.deepEqual(doc.tasks.map((task) => task.id), ['a', 'b', 'd', 'e']);
  assert.deepEqual(doc.tasks.find((task) => task.id === 'd').predecessors, []);
});

test('holidays change the working days', () => {
  const doc = ops(sample(), [{ op: 'project', holidays: ['2026-11-18'] }]);
  const by = Object.fromEntries(describe(doc).tasks.map((task) => [task.id, task]));
  assert.deepEqual([by.c.start, by.c.end], ['2026-11-19', '2026-11-20']);
});

test('versions restore the earlier state and keep an automatic backup', () => {
  let doc = ops(sample(), [{ op: 'snapshot', name: 'v1' }]);
  doc = ops(doc, [{ op: 'delete', id: 'e' }]);
  assert.equal(doc.tasks.length, 4);
  const id = doc.snapshots[0].id;
  doc = ops(doc, [{ op: 'restore', id }]);
  assert.equal(doc.tasks.length, 5);
  assert.equal(doc.snapshots.length, 2);
  assert.match(doc.snapshots[1].name, /^復元前/);
});

test('the file text round-trips and stays one task per line', () => {
  const doc = sample();
  const text = serializeDoc(doc);
  assert.equal(text.split('\n').filter((line) => line.includes('"level"')).length, 5);
  assert.equal(serializeDoc(readDoc(JSON.parse(text))), text);
});

test('reading rejects other documents, newer versions and broken outlines', () => {
  assert.throws(() => readDoc({ format: 'other' }), (error) => error.code === 'invalid_file');
  assert.throws(() => readDoc({ format: 'openjny-gantt-chart', version: 2 }), (error) => error.code === 'unsupported_version');
  const doc = JSON.parse(serializeDoc(sample()));
  doc.tasks[0].level = 2;
  assert.throws(() => readDoc(doc), (error) => error.code === 'invalid_file' && /level/.test(error.message));
});

test('finalize repairs the dates stored in a hand-edited file', () => {
  const raw = JSON.parse(serializeDoc(sample()));
  raw.tasks[2].start = '2026-01-01';
  const doc = readDoc(raw);
  assert.equal(doc.tasks[2].start, '2026-11-18');
  assert.equal(finalize(doc).rows[2].startDay, day('2026-11-18'));
  assert.equal(schedule(doc).project.endDay, day('2026-11-27'));
});
