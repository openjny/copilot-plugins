import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA, readDoc, serializeDoc, toTree } from '../lib/format.mjs';
import { setLocale } from '../lib/i18n.mjs';
import { MAX_DURATION, MAX_LAG, MAX_LEVEL, MAX_TASKS, MAX_VERSIONS, PALETTE, applyOps, describe, emptyDoc, finalize, formatDate, makeCalendar, maxSlideEarlier, parseDate, parseDuration, schedule, weekStartOnOrBefore } from '../lib/model.mjs';

setLocale('en');
const NOW = new Date(2026, 10, 12, 9, 30);
const ops = (doc, list) => applyOps(doc, list, { now: NOW }).doc;
const day = (text) => parseDate(text);
/** The node with this id in the file's task tree. */
const nodeOf = (nodes, id) => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children && nodeOf(node.children, id);
    if (found) return found;
  }
  return undefined;
};

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

test('placing a dependent task later is kept as its start and leaves the lag alone', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', start: '2026-11-24' }]);
  const task = doc.tasks.find((item) => item.id === 'd');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 0 }]);
  assert.equal(task.start, '2026-11-24');
});

test('a start before the predecessors end becomes the first day they allow', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: 2 }] }]);
  const run = applyOps(doc, [{ op: 'update', id: 'd', start: '2026-11-19' }], { now: NOW });
  const task = run.doc.tasks.find((item) => item.id === 'd');
  assert.equal(task.start, '2026-11-24');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 2 }]);
  assert.deepEqual(run.results[0].adjusted, { start: '2026-11-24' });
});

test('a start the predecessors allow is kept and not reported as adjusted', () => {
  const run = applyOps(sample(), [{ op: 'update', id: 'd', start: '2026-11-24' }], { now: NOW });
  assert.equal(run.doc.tasks.find((item) => item.id === 'd').start, '2026-11-24');
  assert.equal(run.results[0].adjusted, undefined);
});

test('moving a dependent task earlier stops at the gap its lags ask for', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: 3 }, { task: 'b' }] }]);
  const run = applyOps(doc, [{ op: 'update', id: 'd', start: '2026-11-23' }], { now: NOW });
  const task = run.doc.tasks.find((item) => item.id === 'd');
  assert.equal(task.start, '2026-11-25');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 3 }, { task: 'b', lag: 0 }]);
  assert.deepEqual(run.results[0].adjusted, { start: '2026-11-25' });
});

test('predecessors only push: shortening one does not pull what follows it earlier', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'b', duration: 1 }]);
  const by = Object.fromEntries(doc.tasks.map((task) => [task.id, task.start]));
  assert.deepEqual([by.c, by.d], ['2026-11-18', '2026-11-20']);
  const longer = applyOps(sample(), [{ op: 'update', id: 'b', duration: 4 }], { now: NOW });
  assert.deepEqual(longer.doc.tasks.filter((task) => task.id === 'c' || task.id === 'd').map((task) => task.start), ['2026-11-20', '2026-11-24']);
  assert.deepEqual(longer.shifted, [{ id: 'c', name: '基本設計', days: 2 }, { id: 'd', name: '設計レビュー', days: 2 }]);
});

test('connecting to a task that starts later changes nothing, and to one that starts earlier pushes it', () => {
  const later = applyOps(sample(), [{ op: 'update', id: 'e', predecessors: [{ task: 'b' }] }], { now: NOW });
  assert.equal(later.doc.tasks.find((task) => task.id === 'e').start, '2026-11-25');
  assert.deepEqual(later.shifted, []);
  const earlier = applyOps(sample(), [{ op: 'update', id: 'b', predecessors: [{ task: 'e' }] }], { now: NOW });
  const by = Object.fromEntries(earlier.doc.tasks.map((task) => [task.id, task.start]));
  assert.deepEqual([by.b, by.c, by.d], ['2026-11-30', '2026-12-02', '2026-12-04']);
  assert.deepEqual(earlier.shifted.map((item) => item.id), ['c', 'd']);
});

test('removing a link, or a task, never moves anything', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', start: '2026-11-24' }]);
  for (const edit of [{ op: 'update', id: 'd', predecessors: [] }, { op: 'delete', id: 'c' }, { op: 'delete', id: 'b' }]) {
    const run = applyOps(doc, [edit], { now: NOW });
    assert.equal(run.doc.tasks.find((task) => task.id === 'd').start, '2026-11-24');
    assert.deepEqual(run.shifted, []);
  }
});

test('a new task with predecessors and no start is placed right after them', () => {
  const run = applyOps(sample(), [{ op: 'add', id: 'f', name: 'F', predecessors: [{ task: 'e', lag: 1 }] }, { op: 'add', id: 'g', name: 'G', start: '2026-12-21', predecessors: [{ task: 'e' }] }], { now: NOW });
  const by = Object.fromEntries(run.doc.tasks.map((task) => [task.id, task.start]));
  assert.equal(by.f, '2026-12-01');
  assert.equal(by.g, '2026-12-21');
});

test('tighten puts tasks on the first day their predecessors allow, one after the other', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'c', start: '2026-11-23' }, { op: 'update', id: 'd', start: '2026-11-30' }]);
  const run = applyOps(doc, [{ op: 'tighten', ids: ['a'] }], { now: NOW });
  const by = Object.fromEntries(run.doc.tasks.map((task) => [task.id, task.start]));
  assert.deepEqual([by.c, by.d], ['2026-11-18', '2026-11-20']);
  assert.equal(run.results[0].count, 2);
  assert.equal(applyOps(sample(), [{ op: 'tighten', ids: ['a'] }], { now: NOW }).results[0].count, 0);
  assert.throws(() => ops(sample(), [{ op: 'tighten', ids: [] }]), (error) => error.code === 'invalid_input');
});

test('deleting with reconnect hands the deleted task\'s predecessors to what waited for it', () => {
  const run = applyOps(sample(), [{ op: 'delete', id: 'c', reconnect: true }], { now: NOW });
  const d = run.doc.tasks.find((task) => task.id === 'd');
  assert.deepEqual(d.predecessors, [{ task: 'b', lag: 2 }]);
  assert.equal(d.start, '2026-11-20');
  assert.equal(run.results[0].reconnected, 1);
  const plain = applyOps(sample(), [{ op: 'delete', id: 'c' }], { now: NOW });
  assert.deepEqual(plain.doc.tasks.find((task) => task.id === 'd').predecessors, []);
  assert.throws(() => ops(sample(), [{ op: 'delete', id: 'a', reconnect: true }]), (error) => error.code === 'invalid_input');
});

test('a leaf that becomes a parent loses its predecessors, and the operation says so', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'e', predecessors: [{ task: 'd' }] }, { op: 'add', id: 'x', name: 'X', after: 'e' }]);
  const run = applyOps(doc, [{ op: 'indent', id: 'x' }], { now: NOW });
  assert.deepEqual(run.dropped, [{ id: 'e', name: '実装', predecessors: ['d'] }]);
  assert.deepEqual(run.doc.tasks.find((task) => task.id === 'e').predecessors, []);
  assert.deepEqual(applyOps(doc, [{ op: 'update', id: 'x', name: 'Y' }], { now: NOW }).dropped, []);
});

test('a due date is optional, round-trips, and shows when the task ends after it', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'e', due: '2026-11-26' }, { op: 'update', id: 'a', due: '2026-11-20' }]);
  const view = describe(doc);
  const by = Object.fromEntries(view.tasks.map((task) => [task.id, task]));
  assert.deepEqual([by.e.due, by.e.lateDays], ['2026-11-26', 1]);
  assert.deepEqual([by.a.due, by.a.lateDays], ['2026-11-20', undefined]);
  assert.equal(by.b.due, undefined);
  const again = readDoc(JSON.parse(serializeDoc(doc)));
  assert.deepEqual([again.tasks.find((task) => task.id === 'e').due, again.tasks.find((task) => task.id === 'a').due], ['2026-11-26', '2026-11-20']);
  assert.equal(ops(doc, [{ op: 'update', id: 'e', due: null }]).tasks.find((task) => task.id === 'e').due, null);
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'e', due: '2026-02-30' }]), (error) => error.code === 'invalid_input');
});

test('a negative lag is rejected when editing and when reading a file', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: -1 }] }]), (error) => error.code === 'invalid_input' && /lag/.test(error.message));
  const raw = JSON.parse(serializeDoc(sample()));
  nodeOf(raw.tasks, 'd').predecessors = [{ task: 'c', lag: -1 }];
  assert.throws(() => readDoc(raw), (error) => error.code === 'invalid_file' && /lag/.test(error.message) && /task d/.test(error.message));
});

test('slide moves tasks together by working days and keeps their positions relative to each other', () => {
  const cal = makeCalendar({ holidays: [] });
  const doc = ops(sample(), [{ op: 'slide', ids: ['b', 'e'], days: 3 }]);
  const start = (id) => day(doc.tasks.find((task) => task.id === id).start);
  assert.equal(formatDate(start('b')), '2026-11-19');
  assert.equal(formatDate(start('e')), '2026-11-30');
  assert.equal(cal.diff(start('b'), start('e')), cal.diff(day('2026-11-16'), day('2026-11-25')));
  assert.equal(formatDate(start('c')), '2026-11-23');
});

test('sliding a parent moves its children and leaves the lags between them alone', () => {
  const run = applyOps(sample(), [{ op: 'slide', ids: ['a'], days: -2 }], { now: NOW });
  const by = Object.fromEntries(run.doc.tasks.map((task) => [task.id, task]));
  assert.deepEqual([by.b.start, by.c.start, by.d.start], ['2026-11-12', '2026-11-16', '2026-11-18']);
  assert.deepEqual(by.c.predecessors, [{ task: 'b', lag: 0 }]);
  assert.deepEqual(run.results[0], { op: 'slide', ids: ['a'], days: -2 });
});

test('slide is cut down to what the predecessors allow', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'd', predecessors: [{ task: 'c', lag: 2 }] }]);
  const run = applyOps(doc, [{ op: 'slide', ids: ['d'], days: -5 }], { now: NOW });
  const task = run.doc.tasks.find((item) => item.id === 'd');
  assert.equal(task.start, '2026-11-24');
  assert.deepEqual(task.predecessors, [{ task: 'c', lag: 2 }]);
  assert.deepEqual(run.results[0].adjusted, { days: 0 });
  assert.equal(maxSlideEarlier(doc, ['d']), 0);
  assert.equal(maxSlideEarlier(ops(doc, [{ op: 'update', id: 'd', start: '2026-12-01' }]), ['d']), 5);
});

test('sliding a dependent task later keeps its lag and pushes what follows it only when it would overlap', () => {
  const run = applyOps(sample(), [{ op: 'slide', ids: ['c'], days: 3 }], { now: NOW });
  const by = Object.fromEntries(run.doc.tasks.map((task) => [task.id, task]));
  assert.deepEqual(by.c.predecessors, [{ task: 'b', lag: 0 }]);
  assert.deepEqual([by.c.start, by.d.start], ['2026-11-23', '2026-11-25']);
  assert.equal(run.results[0].adjusted, undefined);
  assert.deepEqual(run.shifted, [{ id: 'd', name: '設計レビュー', days: 3 }]);
  const slack = applyOps(ops(sample(), [{ op: 'update', id: 'd', start: '2026-11-30' }]), [{ op: 'slide', ids: ['c'], days: 3 }], { now: NOW });
  assert.equal(slack.doc.tasks.find((task) => task.id === 'd').start, '2026-11-30');
  assert.deepEqual(slack.shifted, []);
});

test('slide rejects unknown tasks and bad days', () => {
  assert.throws(() => ops(sample(), [{ op: 'slide', ids: ['zzz'], days: 1 }]), (error) => error.code === 'not_found');
  assert.throws(() => ops(sample(), [{ op: 'slide', ids: ['b'], days: 1.5 }]), (error) => error.code === 'invalid_input');
  assert.throws(() => ops(sample(), [{ op: 'slide', ids: [], days: 1 }]), (error) => error.code === 'invalid_input');
});

test('setting the color of a parent clears the colors of the tasks under it', () => {
  let doc = ops(sample(), [{ op: 'update', id: 'b', color: 'red' }, { op: 'update', id: 'e', color: 'pink' }]);
  doc = ops(doc, [{ op: 'update', id: 'a', color: 'green' }]);
  const by = Object.fromEntries(doc.tasks.map((task) => [task.id, task.color]));
  assert.deepEqual([by.a, by.b, by.c, by.d], ['green', 'inherit', 'inherit', 'inherit']);
  assert.equal(by.e, 'pink');
  doc = ops(doc, [{ op: 'update', id: 'c', color: 'purple' }]);
  assert.equal(doc.tasks.find((task) => task.id === 'c').color, 'purple');
});

test('blue is a color of its own; only "inherit" is left out of the file', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'a', color: 'green' }, { op: 'update', id: 'b', color: 'blue' }]);
  const saved = JSON.parse(serializeDoc(doc));
  assert.equal(nodeOf(saved.tasks, 'b').color, 'blue');
  assert.equal('color' in nodeOf(saved.tasks, 'c'), false);
  assert.equal(readDoc(saved).tasks.find((task) => task.id === 'c').color, 'inherit');
});

test('an end date sets the duration in working days', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'e', end: '2026-12-01' }]);
  assert.equal(doc.tasks.find((task) => task.id === 'e').duration, 5);
});

test('end and duration together are rejected', () => {
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'e', end: '2026-12-01', duration: 2 }]), (error) => error.key === 'err.endAndDuration');
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

test('a worked weekend day counts as a working day, and a holiday on it does not matter', () => {
  const cal = makeCalendar({ holidays: ['2026-11-21'], workdays: ['2026-11-21', '2026-11-22'] });
  assert.deepEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map((text) => cal.isWorkday(day(text))), [true, true, true, true]);
  assert.equal(cal.count(day('2026-11-20'), day('2026-11-23')), 4);
  const doc = ops(sample(), [{ op: 'project', workdays: ['2026-11-21'] }, { op: 'update', id: 'b', duration: 5 }]);
  assert.equal(doc.tasks.find((task) => task.id === 'b').start, '2026-11-16');
  const by = Object.fromEntries(describe(doc).tasks.map((task) => [task.id, task]));
  assert.equal(by.b.end, '2026-11-20');
  const saturday = ops(sample(), [{ op: 'project', workdays: ['2026-11-21'] }, { op: 'update', id: 'b', duration: 6 }]);
  assert.equal(describe(saturday).tasks.find((task) => task.id === 'b').end, '2026-11-21');
  assert.throws(() => ops(sample(), [{ op: 'project', workdays: ['2026-11-18'] }]), (error) => error.key === 'err.expect' && /Saturdays or Sundays/.test(error.message));
  assert.deepEqual(describe(doc).project.workdays, ['2026-11-21']);
});

test('weeks start on Monday unless the project says Sunday', () => {
  const friday = day('2026-11-13');
  assert.equal(formatDate(weekStartOnOrBefore(friday)), '2026-11-09');
  assert.equal(formatDate(weekStartOnOrBefore(friday, 'sun')), '2026-11-08');
  assert.equal(formatDate(weekStartOnOrBefore(day('2026-11-15'), 'sun')), '2026-11-15');
  assert.equal(formatDate(weekStartOnOrBefore(day('2026-11-15'))), '2026-11-09');
  assert.equal(emptyDoc().project.weekStart, 'mon');
  assert.equal(ops(sample(), [{ op: 'project', weekStart: 'sun' }]).project.weekStart, 'sun');
  assert.throws(() => ops(sample(), [{ op: 'project', weekStart: 'tue' }]), (error) => error.code === 'invalid_input');
});

test('the file leaves out what is at its default, and keeps worked weekends and the week start', () => {
  const plain = JSON.parse(serializeDoc(sample()));
  assert.deepEqual(Object.keys(plain.project), ['name', 'holidays']);
  const set = ops(sample(), [{ op: 'project', workdays: ['2026-11-21'], weekStart: 'sun' }]);
  const raw = JSON.parse(serializeDoc(set));
  assert.deepEqual([raw.project.workdays, raw.project.weekStart], [['2026-11-21'], 'sun']);
  const again = readDoc(raw);
  assert.deepEqual([again.project.workdays, again.project.weekStart], [['2026-11-21'], 'sun']);
  assert.equal(readDoc(plain).project.weekStart, 'mon');
});

test('estimated and actual hours are separate, add up under a parent, and show in the description', () => {
  const doc = ops(sample(), [{ op: 'update', id: 'b', estimate: 8, actual: 3.5 }, { op: 'update', id: 'c', estimate: 16 }, { op: 'update', id: 'e', actual: 2 }]);
  const by = Object.fromEntries(describe(doc).tasks.map((task) => [task.id, task]));
  assert.deepEqual([by.b.estimate, by.b.actual], [8, 3.5]);
  assert.deepEqual([by.a.estimate, by.a.actual], [24, 3.5]);
  assert.deepEqual([by.e.estimate, by.e.actual], [null, 2]);
  assert.deepEqual([describe(doc).project.estimate, describe(doc).project.actual], [24, 5.5]);
  assert.throws(() => ops(doc, [{ op: 'update', id: 'a', actual: 1 }]), (error) => error.code === 'summary_field');
  assert.throws(() => ops(doc, [{ op: 'update', id: 'b', effort: 5 }]), (error) => error.code === 'invalid_input' && /effort/.test(error.message));
  assert.throws(() => ops(doc, [{ op: 'update', id: 'b', actual: -1 }]), (error) => error.code === 'invalid_input');
  assert.equal(ops(doc, [{ op: 'update', id: 'b', actual: null }]).tasks.find((task) => task.id === 'b').actual, null);
  const raw = JSON.parse(serializeDoc(doc));
  assert.deepEqual([nodeOf(raw.tasks, 'b').estimate, nodeOf(raw.tasks, 'b').actual], [8, 3.5]);
  assert.equal(nodeOf(raw.tasks, 'a').estimate, undefined);
});

test('a version 2 file (which calls the estimate "effort") is read as the current version', () => {
  const raw = JSON.parse(serializeDoc(ops(sample(), [{ op: 'update', id: 'b', estimate: 8 }, { op: 'save_version', name: 'old' }])));
  raw.version = 2;
  const old = JSON.parse(JSON.stringify(raw).replaceAll('"estimate"', '"effort"'));
  const doc = readDoc(old);
  assert.equal(doc.version, 3);
  assert.equal(doc.tasks.find((task) => task.id === 'b').estimate, 8);
  assert.equal(doc.versions[0].tasks.find((task) => task.id === 'b').estimate, 8);
  assert.equal(JSON.parse(serializeDoc(doc)).version, 3);
  assert.throws(() => readDoc({ ...old, version: 4 }), (error) => error.code === 'unsupported_version');
});

test('versions restore the earlier state and keep an automatic backup', () => {
  let doc = ops(sample(), [{ op: 'save_version', name: 'first' }]);
  doc = ops(doc, [{ op: 'delete', id: 'e' }]);
  assert.equal(doc.tasks.length, 4);
  const id = doc.versions[0].id;
  assert.equal(id, 'v1');
  doc = ops(doc, [{ op: 'restore_version', id }]);
  assert.equal(doc.tasks.length, 5);
  assert.equal(doc.versions.length, 2);
  assert.match(doc.versions[1].name, /^Before restore/);
  assert.equal(ops(doc, [{ op: 'delete_version', id: 'v2' }]).versions.length, 1);
});

test('the file keeps the tasks as a tree, one task per line, and round-trips', () => {
  const doc = sample();
  const text = serializeDoc(doc);
  const raw = JSON.parse(text);
  assert.equal(raw.version, 3);
  assert.match(raw.$schema, /gantt-chart\.schema\.json$/);
  assert.deepEqual(raw.tasks.map((task) => task.id), ['a', 'e']);
  assert.deepEqual(raw.tasks[0].children.map((task) => task.id), ['b', 'c', 'd']);
  // A parent has no dates of its own; a leaf has no "level".
  assert.deepEqual(Object.keys(raw.tasks[0]), ['id', 'name', 'children']);
  assert.equal(raw.tasks[1].level, undefined);
  assert.deepEqual(nodeOf(raw.tasks, 'd').predecessors, [{ task: 'c' }]);
  assert.equal(text.split('\n').filter((line) => line.includes('"id":')).length, 5);
  assert.equal(serializeDoc(readDoc(JSON.parse(text))), text);
  assert.deepEqual(toTree(readDoc(raw).tasks), raw.tasks);
});

test('the limits in the schema are the ones the model enforces', () => {
  const leaf = SCHEMA.$defs.leafTask.properties;
  assert.equal(SCHEMA.properties.tasks.maxItems, MAX_TASKS);
  assert.equal(SCHEMA.properties.versions.maxItems, MAX_VERSIONS);
  assert.equal(leaf.duration.maximum, MAX_DURATION);
  assert.equal(SCHEMA.$defs.dependency.properties.lag.maximum, MAX_LAG);
  assert.deepEqual(SCHEMA.$defs.color.enum, PALETTE);
  assert.equal(new RegExp(SCHEMA.$defs.id.pattern).test('a-B_9'), true);
  assert.equal(SCHEMA.properties.version.const, 3);
  assert.ok(MAX_LEVEL >= 8);
});

test('reading rejects other documents and other versions', () => {
  assert.throws(() => readDoc({ format: 'other' }), (error) => error.code === 'invalid_file');
  assert.throws(() => readDoc({ format: 'openjny-gantt-chart', version: 1 }), (error) => error.code === 'unsupported_version');
});

test('reading says where the file breaks the schema', () => {
  const broken = (change) => {
    const raw = JSON.parse(serializeDoc(sample()));
    change(raw);
    return () => readDoc(raw);
  };
  // A leaf needs its dates; a parent must not have them.
  assert.throws(broken((raw) => delete nodeOf(raw.tasks, 'e').start), (error) => error.code === 'invalid_file' && /tasks\[1\] \(task e\) is missing "start"/.test(error.message));
  assert.throws(broken((raw) => (raw.tasks[0].start = '2026-11-16')), (error) => /tasks\[0\]\.start/.test(error.message) && /not allowed/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').duration = 0)), (error) => /duration/.test(error.message) && /at least 1/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').color = 'teal')), (error) => /one of: blue, green/.test(error.message));
  assert.throws(broken((raw) => (raw.tasks[0].children = [])), (error) => /at least 1 items/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').start = '2026-02-30')), (error) => /valid date/.test(error.message));
  // A milestone lasts one day.
  assert.throws(broken((raw) => Object.assign(nodeOf(raw.tasks, 'e'), { milestone: true, duration: 2 })), (error) => /duration/.test(error.message) && /must be 1/.test(error.message));
});

test('reading checks what a schema cannot: ids, predecessors and cycles', () => {
  const broken = (change) => {
    const raw = JSON.parse(serializeDoc(sample()));
    change(raw);
    return () => readDoc(raw);
  };
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').id = 'b')), (error) => error.code === 'invalid_file' && /used twice/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').predecessors = [{ task: 'zzz' }])), (error) => error.code === 'invalid_file' && /does not exist/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').predecessors = [{ task: 'e' }])), (error) => error.code === 'invalid_file' && /its own predecessor/.test(error.message));
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'b').predecessors = [{ task: 'd' }])), (error) => error.code === 'cycle');
  assert.throws(broken((raw) => (nodeOf(raw.tasks, 'e').predecessors = [{ task: 'b' }, { task: 'b' }])), (error) => /listed twice/.test(error.message));
});

test('messages follow the chosen language', () => {
  try {
    setLocale('ja');
    assert.throws(() => ops(sample(), [{ op: 'update', id: 'a', progress: 50 }]), (error) => error.code === 'summary_field' && /子タスクを持つ/.test(error.message));
    assert.equal(ops(emptyDoc(), [{ op: 'add' }]).tasks[0].name, '新しいタスク');
    setLocale('en');
    assert.equal(ops(emptyDoc(), [{ op: 'add' }]).tasks[0].name, 'New task');
  } finally {
    setLocale('en');
  }
});

test('milestones last one day, cannot be parents, and show in the description', () => {
  let doc = ops(sample(), [{ op: 'update', id: 'e', milestone: true }]);
  const e = doc.tasks.find((task) => task.id === 'e');
  assert.deepEqual([e.milestone, e.duration], [true, 1]);
  assert.equal(describe(doc).tasks.find((task) => task.id === 'e').isMilestone, true);
  assert.throws(() => ops(doc, [{ op: 'update', id: 'e', duration: 3 }]), (error) => error.key === 'err.milestoneDuration');
  assert.throws(() => ops(sample(), [{ op: 'update', id: 'a', milestone: true }]), (error) => error.code === 'summary_field');
  // A milestone that gets a child stops being one.
  doc = ops(doc, [{ op: 'add', id: 'f', name: 'F', parent: 'e' }]);
  assert.equal(doc.tasks.find((task) => task.id === 'e').milestone, false);
  assert.equal(nodeOf(JSON.parse(serializeDoc(ops(sample(), [{ op: 'update', id: 'e', milestone: true }]))).tasks, 'e').milestone, true);
});

test('duplicate copies a task with its children and keeps the links among the copies', () => {
  const run = applyOps(sample(), [{ op: 'duplicate', id: 'a' }], { now: NOW });
  const ids = run.doc.tasks.map((task) => task.id);
  assert.deepEqual(ids.slice(0, 4), ['a', 'b', 'c', 'd']);
  assert.equal(run.results[0].copy, 't1');
  assert.deepEqual(run.results[0].ids, ['t1', 't2', 't3', 't4']);
  assert.deepEqual(run.doc.tasks.slice(4, 8).map((task) => [task.id, task.name, task.level]), [['t1', '設計', 0], ['t2', '要件定義', 1], ['t3', '基本設計', 1], ['t4', '設計レビュー', 1]]);
  // t3 follows t2 (the copy of b), not b.
  assert.deepEqual(run.doc.tasks.find((task) => task.id === 't3').predecessors, [{ task: 't2', lag: 0 }]);
  assert.equal(ids[8], 'e');
  const single = applyOps(sample(), [{ op: 'duplicate', id: 'e' }], { now: NOW }).doc;
  assert.deepEqual(single.tasks.map((task) => task.id).slice(-2), ['e', 't1']);
  assert.equal(single.tasks.at(-1).start, '2026-11-25');
  // A copy waits for the same outside predecessors as the original.
  const copy = applyOps(sample(), [{ op: 'duplicate', id: 'd' }], { now: NOW }).doc.tasks.find((task) => task.id === 't1');
  assert.deepEqual(copy.predecessors, [{ task: 'c', lag: 0 }]);
});

test('finalize repairs the dates stored in a hand-edited file', () => {
  const raw = JSON.parse(serializeDoc(sample()));
  nodeOf(raw.tasks, 'c').start = '2026-01-01';
  const doc = readDoc(raw);
  assert.equal(doc.tasks[2].start, '2026-11-18');
  assert.equal(finalize(doc).rows[2].startDay, day('2026-11-18'));
  assert.equal(schedule(doc).project.endDay, day('2026-11-27'));
});
