// Pure chart model shared by the extension (Node) and the page (browser): dates, working-day calendar, field
// validation, scheduling and edit operations. It imports only the message catalog.

import { t } from './i18n.mjs';

export const FORMAT = 'openjny-gantt-chart';
export const VERSION = 3;
/** The color labels. A task that has none of its own ("inherit") takes the color of its parent, and blue at the top. */
export const PALETTE = ['blue', 'green', 'orange', 'red', 'purple', 'pink', 'gray'];
export const COLORS = ['inherit', ...PALETTE];
export const MAX_LEVEL = 8;
export const MAX_VERSIONS = 100;
export const MAX_TASKS = 2000;
export const MAX_DURATION = 3650;
export const MAX_LAG = 999;
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TASK_FIELDS = ['name', 'start', 'duration', 'progress', 'estimate', 'actual', 'resources', 'color', 'note', 'collapsed', 'milestone', 'predecessors', 'due'];
export const WEEK_STARTS = ['mon', 'sun'];

/** An error with a code for programs and a message in the current language (key and params let a caller say it again). */
export class ModelError extends Error {
  constructor(code, message, key, params) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.key = key;
    this.params = params;
  }
}

/** Throws a ModelError whose message is the catalog entry `key` filled in with `params`. */
export const fail = (code, key, params = {}) => {
  throw new ModelError(code, t(key, params), key, params);
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const round2 = (value) => Math.round(value * 100) / 100;

// ---- Dates: a day is an integer count of days since 1970-01-01 (UTC) -------------------------------------

const DAY_MS = 86400000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function parseDate(text) {
  if (typeof text !== 'string') return null;
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1970 || year > 2200) return null;
  const day = Math.round(Date.UTC(year, Number(match[2]) - 1, Number(match[3])) / DAY_MS);
  return formatDate(day) === text ? day : null;
}

/** 0 = Sunday. */
export const dayOfWeek = (day) => (((day + 4) % 7) + 7) % 7;
export const mondayOnOrBefore = (day) => day - ((dayOfWeek(day) + 6) % 7);
export const isWeekend = (day) => dayOfWeek(day) === 0 || dayOfWeek(day) === 6;
/** The first day of the week that holds `day`, for a week that starts on Monday ("mon") or Sunday ("sun"). */
export const weekStartOnOrBefore = (day, weekStart = 'mon') => day - ((dayOfWeek(day) - (weekStart === 'sun' ? 0 : 1) + 7) % 7);

export function todayDay(now = new Date()) {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

export function ymd(day) {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

// ---- Working-day calendar: Saturday, Sunday and the project's holidays are off, except the weekend days it works ----

export function makeCalendar(project) {
  const holidays = new Set((project?.holidays ?? []).map(parseDate).filter((day) => day !== null));
  const workdays = new Set((project?.workdays ?? []).map(parseDate).filter((day) => day !== null));
  const isHoliday = (day) => holidays.has(day);
  const isWorkday = (day) => (isWeekend(day) ? workdays.has(day) : !holidays.has(day));
  const step = (day, direction) => {
    let current = day;
    for (let i = 0; i < 20000; i++) {
      current += direction;
      if (isWorkday(current)) return current;
    }
    return fail('invalid_input', 'err.noWorkday');
  };
  const next = (day) => (isWorkday(day) ? day : step(day, 1));
  const prev = (day) => (isWorkday(day) ? day : step(day, -1));
  const add = (day, count) => {
    let current = next(day);
    for (let i = 0; i < Math.abs(count); i++) current = step(current, Math.sign(count));
    return current;
  };
  /** Working days in [from, to], both included. */
  const count = (from, to) => {
    let total = 0;
    for (let day = from; day <= to; day++) if (isWorkday(day)) total++;
    return total;
  };
  /** Signed number of working days from a to b; both must be working days. */
  const diff = (a, b) => (a <= b ? count(a, b) - 1 : -(count(b, a) - 1));
  return { isWorkday, isHoliday, next, prev, add, count, diff };
}

export const formatDuration = (days) => (days >= 5 && days % 5 === 0 ? `${days / 5}w` : `${days}d`);

export function parseDuration(value) {
  if (Number.isInteger(value)) return value >= 1 && value <= MAX_DURATION ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+)\s*([dDwW]?)\s*$/.exec(value);
  if (!match) return null;
  const days = Number(match[1]) * (match[2].toLowerCase() === 'w' ? 5 : 1);
  return days >= 1 && days <= MAX_DURATION ? days : null;
}

// ---- Structure: tasks are a flat list in display order; a task's children follow it at level + 1 --------

/** Index after the last descendant of task i. */
export function subtreeEnd(tasks, i) {
  let j = i + 1;
  while (j < tasks.length && tasks[j].level > tasks[i].level) j++;
  return j;
}

export const isSummary = (tasks, i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

// ---- Field validation, shared by file loading and edit operations ----------------------------------------

/** Throws "<what> must be <expect>", where `expect` is the catalog entry `expectKey`. */
const bad = (what, expectKey, params = {}) => fail('invalid_input', 'err.expect', { what, expect: t(expectKey, params) });

const FIELD = {
  name(value, what) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) bad(what, 'expect.name');
    return value.trim();
  },
  start(value, what) {
    if (parseDate(value) === null) bad(what, 'expect.date');
    return value;
  },
  end(value, what) {
    return FIELD.start(value, what);
  },
  due(value, what) {
    return value === null ? null : FIELD.start(value, what);
  },
  duration(value, what) {
    const days = parseDuration(value);
    if (days === null) bad(what, 'expect.duration', { max: MAX_DURATION });
    return days;
  },
  progress(value, what) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) bad(what, 'expect.progress');
    return Math.round(value);
  },
  estimate(value, what) {
    return FIELD.hours(value, what);
  },
  actual(value, what) {
    return FIELD.hours(value, what);
  },
  hours(value, what) {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e6) bad(what, 'expect.effort');
    return round2(value);
  },
  resources(value, what) {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,、]/) : null;
    if (!list || list.some((item) => typeof item !== 'string')) bad(what, 'expect.resources');
    const names = [...new Set(list.map((item) => item.trim()).filter(Boolean))];
    if (names.length > 20 || names.some((item) => item.length > 50)) bad(what, 'expect.resourcesLimit');
    return names;
  },
  color(value, what) {
    if (!COLORS.includes(value)) bad(what, 'expect.color', { list: COLORS.join(', ') });
    return value;
  },
  note(value, what) {
    if (typeof value !== 'string' || value.length > 2000) bad(what, 'expect.note');
    return value;
  },
  collapsed(value, what) {
    if (typeof value !== 'boolean') bad(what, 'expect.boolean');
    return value;
  },
  milestone(value, what) {
    if (typeof value !== 'boolean') bad(what, 'expect.boolean');
    return value;
  },
  predecessors(value, what) {
    if (!Array.isArray(value) || value.length > 50) bad(what, 'expect.predecessors');
    const seen = new Set();
    return value.map((item, i) => {
      const where = `${what}[${i}]`;
      if (!isObject(item)) bad(where, 'expect.pred');
      for (const key of Object.keys(item)) if (key !== 'task' && key !== 'lag') fail('invalid_input', 'err.unknownProp', { where, key });
      if (typeof item.task !== 'string' || !ID_RE.test(item.task)) bad(`${where}.task`, 'expect.taskId');
      if (seen.has(item.task)) fail('invalid_input', 'err.dupPred', { where, task: item.task });
      seen.add(item.task);
      const lag = item.lag === undefined ? 0 : item.lag;
      if (!Number.isInteger(lag) || lag < 0 || lag > MAX_LAG) bad(`${where}.lag`, 'expect.lag', { max: MAX_LAG });
      return { task: item.task, lag };
    });
  },
  holidays(value, what) {
    if (!Array.isArray(value) || value.length > 500 || value.some((item) => parseDate(item) === null)) bad(what, 'expect.holidays');
    return [...new Set(value)].sort();
  },
  workdays(value, what) {
    if (!Array.isArray(value) || value.length > 500 || value.some((item) => parseDate(item) === null || !isWeekend(parseDate(item)))) bad(what, 'expect.workdays');
    return [...new Set(value)].sort();
  },
  weekStart(value, what) {
    if (!WEEK_STARTS.includes(value)) bad(what, 'expect.weekStart');
    return value;
  },
};

export const blankTask = (id) => ({
  id,
  name: '',
  level: 0,
  start: '1970-01-01',
  duration: 1,
  progress: 0,
  estimate: null,
  actual: null,
  resources: [],
  color: 'inherit',
  predecessors: [],
  note: '',
  collapsed: false,
  milestone: false,
  due: null,
});

export function emptyDoc(name = '') {
  return { format: FORMAT, version: VERSION, project: { name: name.slice(0, 200), holidays: [], workdays: [], weekStart: 'mon' }, tasks: [], versions: [] };
}

/** Checks the outline (the first task is at level 0, a level rises by at most 1) and the predecessors of a flat task list. */
export function checkTasks(tasks, where, code) {
  const ids = new Set(tasks.map((task) => task.id));
  tasks.forEach((task, i) => {
    if (i === 0 ? task.level !== 0 : task.level > tasks[i - 1].level + 1) fail(code, 'err.badLevel', { where: `${where}[${i}]`, name: task.name });
    for (const pred of task.predecessors) {
      if (pred.task === task.id) fail(code, 'err.selfPred', { name: task.name });
      if (!ids.has(pred.task)) fail(code, 'err.missingPred', { name: task.name, task: pred.task });
    }
  });
}

/**
 * Makes the document consistent: checks the structure, drops predecessors from parent tasks, and
 * stores the computed dates, progress and hours back into the tasks. Throws on a dependency cycle.
 */
export function finalize(doc, code = 'invalid_input') {
  checkTasks(doc.tasks, 'tasks', code);
  doc.tasks.forEach((task, i) => {
    if (isSummary(doc.tasks, i)) {
      task.predecessors = [];
      task.milestone = false;
    }
  });
  const result = schedule(doc);
  doc.tasks.forEach((task, i) => {
    const row = result.rows[i];
    task.start = formatDate(row.startDay);
    if (row.summary) {
      task.duration = row.duration;
      task.progress = Math.round(row.progress);
      task.estimate = row.estimate === null ? null : round2(row.estimate);
      task.actual = row.actual === null ? null : round2(row.actual);
    }
  });
  return result;
}

// ---- Scheduling ---------------------------------------------------------------------------------------------

/**
 * Computes every task's dates. A task starts on the day it is placed ("start") or, when its predecessors end later,
 * on the first day they allow (end + 1 working day + lag): predecessors only push a task later, they never pull it
 * earlier. A parent spans its children and its progress is weighted by their durations.
 */
export function schedule(doc, cal = makeCalendar(doc.project)) {
  const tasks = doc.tasks;
  const index = new Map(tasks.map((task, i) => [task.id, i]));
  const rows = new Array(tasks.length);
  const mark = new Uint8Array(tasks.length);

  const resolve = (i) => {
    if (mark[i] === 2) return rows[i];
    if (mark[i] === 1) fail('cycle', 'err.cycle', { name: tasks[i].name });
    mark[i] = 1;
    const task = tasks[i];
    const end = subtreeEnd(tasks, i);
    let row;
    if (end > i + 1) {
      let startDay = Infinity;
      let endDay = -Infinity;
      let work = 0;
      let done = 0;
      let estimate = null;
      let actual = null;
      for (let child = i + 1; child < end; child = subtreeEnd(tasks, child)) {
        const sub = resolve(child);
        startDay = Math.min(startDay, sub.startDay);
        endDay = Math.max(endDay, sub.endDay);
        work += sub.work;
        done += sub.done;
        if (sub.estimate !== null) estimate = (estimate ?? 0) + sub.estimate;
        if (sub.actual !== null) actual = (actual ?? 0) + sub.actual;
      }
      row = { summary: true, milestone: false, startDay, endDay, duration: cal.count(startDay, endDay), progress: work ? done / work : 0, estimate, actual, work, done };
    } else {
      let startDay = cal.next(parseDate(task.start));
      for (const pred of task.predecessors) {
        const at = index.get(pred.task);
        if (at === undefined) fail('invalid_input', 'err.missingPred', { name: task.name, task: pred.task });
        const candidate = cal.add(resolve(at).endDay, 1 + pred.lag);
        if (candidate > startDay) startDay = candidate;
      }
      row = {
        summary: false,
        milestone: task.milestone === true,
        startDay,
        endDay: cal.add(startDay, task.duration - 1),
        duration: task.duration,
        progress: task.progress,
        estimate: task.estimate,
        actual: task.actual,
        work: task.duration,
        done: task.duration * task.progress,
      };
    }
    Object.assign(row, { id: task.id, index: i, row: i + 1, level: task.level });
    mark[i] = 2;
    rows[i] = row;
    return row;
  };

  for (let i = 0; i < tasks.length; i++) resolve(i);

  const ancestors = [];
  for (let i = 0; i < tasks.length; i++) {
    while (ancestors.length && tasks[ancestors[ancestors.length - 1]].level >= tasks[i].level) ancestors.pop();
    rows[i].parent = ancestors.length ? ancestors[ancestors.length - 1] : -1;
    rows[i].hidden = ancestors.some((at) => tasks[at].collapsed);
    ancestors.push(i);
  }

  const project = { count: tasks.length, startDay: null, endDay: null, duration: 0, progress: 0, estimate: null, actual: null };
  const top = rows.filter((row) => row.level === 0);
  if (top.length) {
    project.startDay = Math.min(...top.map((row) => row.startDay));
    project.endDay = Math.max(...top.map((row) => row.endDay));
    project.duration = cal.count(project.startDay, project.endDay);
    const work = top.reduce((sum, row) => sum + row.work, 0);
    project.progress = work ? top.reduce((sum, row) => sum + row.done, 0) / work : 0;
    for (const row of top) {
      if (row.estimate !== null) project.estimate = (project.estimate ?? 0) + row.estimate;
      if (row.actual !== null) project.actual = (project.actual ?? 0) + row.actual;
    }
  }
  return { rows, byId: new Map(rows.map((row) => [row.id, row])), project };
}

// ---- Edit operations ----------------------------------------------------------------------------------------

function findIndex(d, id, what) {
  const i = typeof id === 'string' ? d.tasks.findIndex((task) => task.id === id) : -1;
  if (i < 0) fail('not_found', 'err.taskNotFound', { what, id: JSON.stringify(id) });
  return i;
}

function allowKeys(op, allowed) {
  for (const key of Object.keys(op)) {
    if (!allowed.includes(key)) fail('invalid_input', 'err.unknownKey', { key, allowed: allowed.join(', ') });
  }
}

function readPatch(op) {
  const patch = {};
  for (const key of [...TASK_FIELDS, 'end']) if (op[key] !== undefined) patch[key] = FIELD[key](op[key], key);
  return patch;
}

function maxTaskNumber(d) {
  let max = 0;
  for (const task of d.tasks) {
    const match = /^t(\d+)$/.exec(task.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

const newId = (d) => `t${maxTaskNumber(d) + 1}`;

/** Where a task goes: as the last child of `parent`, after or before another task, or at the end. */
function resolveTarget(d, op) {
  const given = ['parent', 'after', 'before'].filter((key) => op[key] !== undefined);
  if (given.length > 1) fail('invalid_input', 'err.oneTarget');
  if (!given.length) return { index: d.tasks.length, level: 0 };
  const key = given[0];
  const i = findIndex(d, op[key], key);
  const level = d.tasks[i].level;
  if (key === 'parent') {
    if (level + 1 > MAX_LEVEL) fail('invalid_input', 'err.maxDepth', { max: MAX_LEVEL + 1 });
    return { index: subtreeEnd(d.tasks, i), level: level + 1 };
  }
  return key === 'after' ? { index: subtreeEnd(d.tasks, i), level } : { index: i, level };
}

function shiftLevels(tasks, from, to, delta) {
  for (let i = from; i < to; i++) {
    const level = tasks[i].level + delta;
    if (level < 0 || level > MAX_LEVEL) fail('invalid_input', 'err.levelRange', { max: MAX_LEVEL });
    tasks[i].level = level;
  }
}

/**
 * Places a leaf task so that it starts on `wanted` (a working day). Its predecessors only set the earliest day it may
 * start: a start before they end becomes the first day they allow, and that is reported as { start } (null when the
 * start is as asked). Lags are not touched.
 */
function setStart(d, i, wanted, cal) {
  const task = d.tasks[i];
  task.start = formatDate(wanted);
  if (!task.predecessors.length) return null;
  const first = schedule(d, cal).rows[i].startDay;
  return first > wanted ? { start: formatDate(first) } : null;
}

// ---- Sliding several tasks together -----------------------------------------------------------------------------

/** The earliest day the model keeps: the first Monday of 1970. */
export const FIRST_DAY = 4;
const MAX_SLIDE = 2600;

/** Indexes of the tasks that carry dates under the given ids: a parent stands for its children. */
function leafIndexes(d, ids) {
  const leaves = new Set();
  for (const id of ids) {
    const i = findIndex(d, id, 'ids');
    for (let j = i, end = subtreeEnd(d.tasks, i); j < end; j++) if (!isSummary(d.tasks, j)) leaves.add(j);
  }
  return leaves;
}

/** Task indexes with every predecessor (and, for a parent, every child) before the task. */
function dependencyOrder(tasks) {
  const index = new Map(tasks.map((task, i) => [task.id, i]));
  const seen = new Uint8Array(tasks.length);
  const order = [];
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    for (const pred of tasks[i].predecessors) visit(index.get(pred.task));
    for (let j = i + 1, end = subtreeEnd(tasks, i); j < end; j = subtreeEnd(tasks, j)) visit(j);
    order.push(i);
  };
  tasks.forEach((_, i) => visit(i));
  return order;
}

/** Plans sliding the given tasks: which leaves move, in what order, and where each one starts now. */
function planSlide(d, ids, cal) {
  const leaves = leafIndexes(d, ids);
  const plan = schedule(d, cal);
  const order = dependencyOrder(d.tasks).filter((i) => leaves.has(i));
  return { order, from: new Map(order.map((i) => [i, plan.rows[i].startDay])) };
}

/** The tasks slid by `days` working days on a copy, or null if any of them would have to start earlier than allowed. */
function trySlide(d, slide, days, cal) {
  const work = { project: d.project, tasks: structuredClone(d.tasks) };
  for (const i of slide.order) {
    const target = cal.add(slide.from.get(i), days);
    if (target < FIRST_DAY || setStart(work, i, target, cal)) return null;
  }
  return work;
}

/** The largest number of working days (up to `max`) the tasks can all move earlier: one that does not push any task before its predecessors. */
export function maxSlideEarlier(doc, ids, max = MAX_SLIDE) {
  const cal = makeCalendar(doc.project);
  const slide = planSlide(doc, ids, cal);
  let ok = 0;
  let over = max + 1;
  while (over - ok > 1) {
    const mid = Math.floor((ok + over) / 2);
    if (trySlide(doc, slide, -mid, cal)) ok = mid;
    else over = mid;
  }
  return ok;
}

/**
 * Moves the tasks by `days` working days, keeping their positions relative to each other. Each task keeps
 * its place among its predecessors (lags change only where a predecessor stays put). When that is not
 * possible all the way, the move is cut down to the most that works. Returns the days actually moved.
 */
function slideTasks(d, ids, days, cal) {
  const slide = planSlide(d, ids, cal);
  const sign = Math.sign(days);
  let moved = Math.abs(days);
  let work = trySlide(d, slide, days, cal);
  if (!work) {
    let ok = 0;
    let over = moved;
    while (over - ok > 1) {
      const mid = Math.floor((ok + over) / 2);
      if (trySlide(d, slide, sign * mid, cal)) ok = mid;
      else over = mid;
    }
    moved = ok;
    work = ok ? trySlide(d, slide, sign * ok, cal) : null;
  }
  if (work) d.tasks = work.tasks;
  return moved ? sign * moved : 0;
}

function patchTask(d, i, patch, cal) {
  const task = d.tasks[i];
  if (patch.end !== undefined && patch.duration !== undefined) fail('invalid_input', 'err.endAndDuration');
  const derived = ['start', 'end', 'duration', 'progress', 'estimate', 'actual', 'predecessors'].filter((key) => patch[key] !== undefined);
  if (patch.milestone === true) derived.push('milestone');
  if (derived.length && isSummary(d.tasks, i)) fail('summary_field', 'err.summaryField', { name: task.name, fields: derived.join(', ') });
  for (const key of ['name', 'resources', 'color', 'note', 'collapsed', 'milestone', 'progress', 'estimate', 'actual', 'due']) if (patch[key] !== undefined) task[key] = patch[key];
  // A milestone is a point in time: one working day.
  if (task.milestone && ((patch.duration !== undefined && patch.duration !== 1) || patch.end !== undefined)) fail('invalid_input', 'err.milestoneDuration', { name: task.name });
  if (patch.milestone === true) task.duration = 1;
  // A parent's color is the default for the tasks under it, so setting it recolors the whole group.
  if (patch.color !== undefined && isSummary(d.tasks, i)) {
    for (let j = i + 1, end = subtreeEnd(d.tasks, i); j < end; j++) d.tasks[j].color = 'inherit';
  }
  if (patch.predecessors !== undefined) {
    for (const pred of patch.predecessors) {
      if (pred.task === task.id) fail('invalid_input', 'err.selfPredOp');
      findIndex(d, pred.task, 'predecessors');
    }
    task.predecessors = patch.predecessors;
  }
  if (patch.duration !== undefined) task.duration = patch.duration;

  const driven = task.predecessors.length > 0;
  let adjusted = null;
  if (patch.start !== undefined) adjusted = setStart(d, i, cal.next(parseDate(patch.start)), cal);
  if (patch.end !== undefined) {
    const first = driven ? schedule(d, cal).rows[i].startDay : cal.next(parseDate(task.start));
    const last = cal.prev(parseDate(patch.end));
    if (last < first) fail('invalid_range', 'err.endBeforeStart', { name: task.name });
    task.duration = cal.count(first, last);
    if (task.duration > MAX_DURATION) fail('invalid_input', 'err.maxDuration', { max: MAX_DURATION });
  }
  return adjusted;
}

function localStamp(now) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function saveVersion(d, name, now) {
  if (d.versions.length >= MAX_VERSIONS) fail('too_many_versions', 'err.tooManyVersions', { max: MAX_VERSIONS });
  finalize(d);
  let max = 0;
  for (const version of d.versions) {
    const match = /^v(\d+)$/.exec(version.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const version = { id: `v${max + 1}`, name, createdAt: now.toISOString(), project: structuredClone(d.project), tasks: structuredClone(d.tasks) };
  d.versions.push(version);
  return version;
}

export const OPS = ['add', 'update', 'delete', 'duplicate', 'move', 'indent', 'outdent', 'shift', 'slide', 'tighten', 'project', 'save_version', 'restore_version', 'delete_version'];

function runOp(d, op, ctx) {
  if (!isObject(op) || typeof op.op !== 'string') fail('invalid_input', 'err.opShape');
  const now = ctx.now ?? new Date();
  const cal = makeCalendar(d.project);
  switch (op.op) {
    case 'add': {
      allowKeys(op, ['op', 'id', 'parent', 'after', 'before', 'end', ...TASK_FIELDS]);
      if (d.tasks.length >= MAX_TASKS) fail('invalid_input', 'err.maxTasks', { max: MAX_TASKS });
      let id = newId(d);
      if (op.id !== undefined) {
        if (typeof op.id !== 'string' || !ID_RE.test(op.id)) bad('id', 'expect.id');
        if (d.tasks.some((task) => task.id === op.id)) fail('invalid_input', 'err.idUsed', { id: op.id });
        id = op.id;
      }
      const patch = readPatch(op);
      const at = resolveTarget(d, op);
      const task = blankTask(id);
      task.name = patch.name ?? t('task.new');
      task.level = at.level;
      const above = at.index > 0 ? schedule(d, cal).rows[at.index - 1] : null;
      task.start = formatDate(above ? above.startDay : cal.next(todayDay(now)));
      // A new task that is given predecessors and no start is placed right after them.
      if (patch.predecessors?.length && patch.start === undefined) task.start = formatDate(FIRST_DAY);
      d.tasks.splice(at.index, 0, task);
      const adjusted = patchTask(d, at.index, patch, cal);
      return { op: 'add', id, ...(adjusted && { adjusted }) };
    }
    case 'update': {
      allowKeys(op, ['op', 'id', 'end', ...TASK_FIELDS]);
      const adjusted = patchTask(d, findIndex(d, op.id, 'id'), readPatch(op), cal);
      return { op: 'update', id: op.id, ...(adjusted && { adjusted }) };
    }
    case 'slide': {
      allowKeys(op, ['op', 'ids', 'days']);
      if (!Array.isArray(op.ids) || !op.ids.length || op.ids.length > 500) bad('ids', 'expect.ids');
      if (!Number.isInteger(op.days) || Math.abs(op.days) > MAX_SLIDE) bad('days', 'expect.days', { max: MAX_SLIDE });
      const moved = slideTasks(d, op.ids, op.days, cal);
      return { op: 'slide', ids: op.ids, days: moved, ...(moved !== op.days && { adjusted: { days: moved } }) };
    }
    case 'delete': {
      allowKeys(op, ['op', 'id', 'reconnect']);
      const i = findIndex(d, op.id, 'id');
      if (op.reconnect !== undefined && typeof op.reconnect !== 'boolean') bad('reconnect', 'expect.boolean');
      if (op.reconnect && subtreeEnd(d.tasks, i) > i + 1) fail('invalid_input', 'err.reconnectParent', { name: d.tasks[i].name });
      const gone0 = d.tasks[i];
      let reconnected = 0;
      if (op.reconnect) {
        // What waited for the deleted task now waits for what it waited for, with the gap the two links added up to.
        for (const task of d.tasks) {
          const link = task.predecessors.find((pred) => pred.task === gone0.id);
          if (!link) continue;
          const have = new Set(task.predecessors.map((pred) => pred.task));
          const bridged = gone0.predecessors.filter((pred) => !have.has(pred.task)).map((pred) => ({ task: pred.task, lag: Math.min(MAX_LAG, pred.lag + gone0.duration + link.lag) }));
          task.predecessors = [...task.predecessors.filter((pred) => pred.task !== gone0.id), ...bridged];
          reconnected++;
        }
      }
      const removed = d.tasks.splice(i, subtreeEnd(d.tasks, i) - i);
      const gone = new Set(removed.map((task) => task.id));
      for (const task of d.tasks) task.predecessors = task.predecessors.filter((pred) => !gone.has(pred.task));
      return { op: 'delete', id: op.id, removed: removed.length, ...(reconnected && { reconnected }) };
    }
    case 'tighten': {
      // Puts tasks on the first day their predecessors allow, closing the gap the placement left (a parent stands for its children).
      allowKeys(op, ['op', 'ids']);
      if (!Array.isArray(op.ids) || !op.ids.length || op.ids.length > 500) bad('ids', 'expect.ids');
      const leaves = leafIndexes(d, op.ids);
      let count = 0;
      for (const i of dependencyOrder(d.tasks).filter((at) => leaves.has(at))) {
        const task = d.tasks[i];
        if (!task.predecessors.length) continue;
        const plan = schedule(d, cal);
        const first = Math.max(...task.predecessors.map((pred) => cal.add(plan.byId.get(pred.task).endDay, 1 + pred.lag)));
        if (first < plan.rows[i].startDay) {
          task.start = formatDate(first);
          count++;
        }
      }
      return { op: 'tighten', ids: op.ids, count };
    }
    case 'duplicate': {
      // Copies a task with everything under it, right after it. Dependencies among the copies point at the copies;
      // the ones that leave the group stay as they were, so a copy waits for the same predecessors as the original.
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      const end = subtreeEnd(d.tasks, i);
      if (d.tasks.length + (end - i) > MAX_TASKS) fail('invalid_input', 'err.maxTasks', { max: MAX_TASKS });
      const copy = structuredClone(d.tasks.slice(i, end));
      let number = maxTaskNumber(d);
      const renamed = new Map(copy.map((task) => [task.id, `t${++number}`]));
      for (const task of copy) {
        task.id = renamed.get(task.id);
        task.predecessors = task.predecessors.map((pred) => ({ task: renamed.get(pred.task) ?? pred.task, lag: pred.lag }));
      }
      d.tasks.splice(end, 0, ...copy);
      return { op: 'duplicate', id: op.id, copy: copy[0].id, ids: copy.map((task) => task.id) };
    }
    case 'move': {
      allowKeys(op, ['op', 'id', 'parent', 'after', 'before']);
      const i = findIndex(d, op.id, 'id');
      const end = subtreeEnd(d.tasks, i);
      for (const key of ['parent', 'after', 'before']) {
        if (op[key] === undefined) continue;
        const at = findIndex(d, op[key], key);
        if (at >= i && at < end) fail('invalid_move', 'err.moveIntoSelf');
      }
      const block = d.tasks.splice(i, end - i);
      const at = resolveTarget(d, op);
      shiftLevels(block, 0, block.length, at.level - block[0].level);
      d.tasks.splice(at.index, 0, ...block);
      return { op: 'move', id: op.id };
    }
    case 'indent': {
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      if (i === 0 || d.tasks[i - 1].level < d.tasks[i].level) fail('cannot_indent', 'err.cannotIndent');
      shiftLevels(d.tasks, i, subtreeEnd(d.tasks, i), 1);
      return { op: 'indent', id: op.id };
    }
    case 'outdent': {
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      if (d.tasks[i].level === 0) fail('cannot_outdent', 'err.cannotOutdent');
      shiftLevels(d.tasks, i, subtreeEnd(d.tasks, i), -1);
      return { op: 'outdent', id: op.id };
    }
    case 'shift': {
      allowKeys(op, ['op', 'id', 'direction']);
      if (op.direction !== 'up' && op.direction !== 'down') bad('direction', 'expect.direction');
      const i = findIndex(d, op.id, 'id');
      const end = subtreeEnd(d.tasks, i);
      const level = d.tasks[i].level;
      if (op.direction === 'up') {
        let j = i - 1;
        while (j >= 0 && d.tasks[j].level > level) j--;
        if (j < 0 || d.tasks[j].level < level) fail('cannot_move', 'err.cannotMoveUp');
        d.tasks.splice(j, 0, ...d.tasks.splice(i, end - i));
      } else {
        if (end >= d.tasks.length || d.tasks[end].level < level) fail('cannot_move', 'err.cannotMoveDown');
        const after = subtreeEnd(d.tasks, end);
        d.tasks.splice(after - (end - i), 0, ...d.tasks.splice(i, end - i));
      }
      return { op: 'shift', id: op.id };
    }
    case 'project': {
      allowKeys(op, ['op', 'name', 'holidays', 'workdays', 'weekStart']);
      if (op.name !== undefined) {
        if (typeof op.name !== 'string' || op.name.length > 200) bad('name', 'expect.name200');
        d.project.name = op.name.trim();
      }
      if (op.holidays !== undefined) d.project.holidays = FIELD.holidays(op.holidays, 'holidays');
      if (op.workdays !== undefined) d.project.workdays = FIELD.workdays(op.workdays, 'workdays');
      if (op.weekStart !== undefined) d.project.weekStart = FIELD.weekStart(op.weekStart, 'weekStart');
      return { op: 'project' };
    }
    case 'save_version': {
      allowKeys(op, ['op', 'name']);
      if (op.name !== undefined && (typeof op.name !== 'string' || op.name.length > 200)) bad('name', 'expect.name200');
      const version = saveVersion(d, op.name?.trim() || localStamp(now), now);
      return { op: 'save_version', id: version.id };
    }
    case 'restore_version': {
      allowKeys(op, ['op', 'id']);
      const version = d.versions.find((item) => item.id === op.id);
      if (!version) fail('not_found', 'err.versionNotFound', { id: JSON.stringify(op.id) });
      saveVersion(d, t('version.beforeRestore', { stamp: localStamp(now) }), now);
      d.project = structuredClone(version.project);
      d.tasks = structuredClone(version.tasks);
      return { op: 'restore_version', id: op.id };
    }
    case 'delete_version': {
      allowKeys(op, ['op', 'id']);
      const at = d.versions.findIndex((item) => item.id === op.id);
      if (at < 0) fail('not_found', 'err.versionNotFound', { id: JSON.stringify(op.id) });
      d.versions.splice(at, 1);
      return { op: 'delete_version', id: op.id };
    }
    default:
      return fail('invalid_input', 'err.unknownOp', { op: op.op, ops: OPS.join(', ') });
  }
}

/**
 * Applies operations to a copy of the document, all or nothing. Returns the new document and one result
 * per operation (the id of an added task, for example).
 */
export function applyOps(doc, ops, ctx = {}) {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) fail('invalid_input', 'err.opsCount');
  const d = structuredClone(doc);
  const before = scheduleOrNull(doc);
  const results = ops.map((op, i) => {
    try {
      return runOp(d, op, ctx);
    } catch (error) {
      if (error instanceof ModelError) error.message = `ops[${i}] (${op?.op}): ${error.message}`;
      throw error;
    }
  });
  // A leaf that becomes a parent loses its predecessors, and its dates come from its children.
  const dropped = d.tasks.flatMap((task, i) => (isSummary(d.tasks, i) && task.predecessors.length ? [{ id: task.id, name: task.name, predecessors: task.predecessors.map((pred) => pred.task) }] : []));
  const after = finalize(d);
  return { doc: d, results, shifted: before ? shiftedTasks(before, after, d, ctx.includeNamed ? new Set() : namedLeaves(doc, d, ops)) : [], dropped };
}

/** The schedule of a document, or null when it cannot be computed (a damaged file). */
function scheduleOrNull(doc) {
  try {
    return schedule(doc);
  } catch {
    return null;
  }
}

/** Ids of the tasks the operations name (and the leaves under them), in either document: the tasks the user is editing, as against the ones that moved with them. */
function namedLeaves(before, after, ops) {
  const named = new Set();
  for (const op of ops) {
    for (const id of [op?.id, ...(Array.isArray(op?.ids) ? op.ids : [])]) {
      if (typeof id !== 'string') continue;
      for (const doc of [before, after]) {
        const i = doc.tasks.findIndex((task) => task.id === id);
        if (i >= 0) for (let j = i, end = subtreeEnd(doc.tasks, i); j < end; j++) named.add(doc.tasks[j].id);
      }
    }
  }
  return named;
}

/**
 * The leaf tasks that start on another day after the operations than before them, other than the ones the operations
 * name: what moved because of a dependency. `days` is in working days (positive = later).
 */
function shiftedTasks(before, after, doc, named) {
  const cal = makeCalendar(doc.project);
  const out = [];
  for (const row of after.rows) {
    const old = before.byId.get(row.id);
    if (row.summary || !old || old.summary || named.has(row.id) || old.startDay === row.startDay) continue;
    out.push({ id: row.id, name: doc.tasks[row.index].name, days: cal.diff(old.startDay, row.startDay) });
  }
  return out;
}

// ---- Output --------------------------------------------------------------------------------------------------

/** What the agent sees: every task with its computed dates. */
export function describe(doc, { includeVersions = false } = {}) {
  const { rows, project } = schedule(doc);
  const out = {
    project: {
      name: doc.project.name,
      holidays: doc.project.holidays,
      workdays: doc.project.workdays,
      weekStart: doc.project.weekStart,
      start: project.startDay === null ? null : formatDate(project.startDay),
      end: project.endDay === null ? null : formatDate(project.endDay),
      workingDays: project.duration,
      progress: round2(project.progress),
      estimate: project.estimate,
      actual: project.actual,
      taskCount: project.count,
    },
    tasks: doc.tasks.map((task, i) => ({
      row: i + 1,
      id: task.id,
      name: task.name,
      level: task.level,
      isParent: rows[i].summary,
      isMilestone: rows[i].milestone,
      start: formatDate(rows[i].startDay),
      end: formatDate(rows[i].endDay),
      duration: rows[i].duration,
      progress: Math.round(rows[i].progress),
      estimate: rows[i].estimate,
      actual: rows[i].actual,
      resources: task.resources,
      color: task.color,
      predecessors: task.predecessors,
      note: task.note,
      collapsed: task.collapsed,
      ...(task.due && { due: task.due, ...(rows[i].endDay > parseDate(task.due) && { lateDays: rows[i].endDay - parseDate(task.due) }) }),
    })),
  };
  if (includeVersions) out.versions = doc.versions.map((version) => ({ id: version.id, name: version.name, createdAt: version.createdAt, taskCount: version.tasks.length }));
  return out;
}
