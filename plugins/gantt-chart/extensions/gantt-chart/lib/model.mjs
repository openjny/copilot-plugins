// Pure chart model shared by the extension (Node) and the page (browser): dates, working-day calendar, field
// validation, scheduling and edit operations. It imports only the message catalog.

import { t } from './i18n.mjs';

export const FORMAT = 'openjny-gantt-chart';
export const VERSION = 2;
export const COLORS = ['none', 'green', 'orange', 'red', 'purple', 'teal', 'gray'];
export const MAX_LEVEL = 8;
export const MAX_VERSIONS = 100;
export const MAX_TASKS = 2000;
export const MAX_DURATION = 3650;
export const MAX_LAG = 999;
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TASK_FIELDS = ['name', 'start', 'duration', 'progress', 'effort', 'resources', 'color', 'note', 'collapsed', 'milestone', 'predecessors'];

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

export function todayDay(now = new Date()) {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

export function ymd(day) {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

// ---- Working-day calendar: Saturday, Sunday and the project's holidays are off --------------------------

export function makeCalendar(project) {
  const holidays = new Set((project?.holidays ?? []).map(parseDate).filter((day) => day !== null));
  const isHoliday = (day) => holidays.has(day);
  const isWorkday = (day) => {
    const weekday = dayOfWeek(day);
    return weekday !== 0 && weekday !== 6 && !holidays.has(day);
  };
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
  duration(value, what) {
    const days = parseDuration(value);
    if (days === null) bad(what, 'expect.duration', { max: MAX_DURATION });
    return days;
  },
  progress(value, what) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) bad(what, 'expect.progress');
    return Math.round(value);
  },
  effort(value, what) {
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
};

export const blankTask = (id) => ({
  id,
  name: '',
  level: 0,
  start: '1970-01-01',
  duration: 1,
  progress: 0,
  effort: null,
  resources: [],
  color: 'none',
  predecessors: [],
  note: '',
  collapsed: false,
  milestone: false,
});

export function emptyDoc(name = '') {
  return { format: FORMAT, version: VERSION, project: { name: name.slice(0, 200), holidays: [] }, tasks: [], versions: [] };
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
 * stores the computed dates, progress and effort back into the tasks. Throws on a dependency cycle.
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
      task.effort = row.effort === null ? null : round2(row.effort);
    }
  });
  return result;
}

// ---- Scheduling ---------------------------------------------------------------------------------------------

/**
 * Computes every task's dates. A task with predecessors starts after the latest of them (end + 1 working
 * day + lag); a parent spans its children and its progress is weighted by their durations.
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
      let effort = null;
      for (let child = i + 1; child < end; child = subtreeEnd(tasks, child)) {
        const sub = resolve(child);
        startDay = Math.min(startDay, sub.startDay);
        endDay = Math.max(endDay, sub.endDay);
        work += sub.work;
        done += sub.done;
        if (sub.effort !== null) effort = (effort ?? 0) + sub.effort;
      }
      row = { summary: true, milestone: false, startDay, endDay, duration: cal.count(startDay, endDay), progress: work ? done / work : 0, effort, work, done };
    } else {
      let startDay = cal.next(parseDate(task.start));
      if (task.predecessors.length) {
        startDay = null;
        for (const pred of task.predecessors) {
          const at = index.get(pred.task);
          if (at === undefined) fail('invalid_input', 'err.missingPred', { name: task.name, task: pred.task });
          const candidate = cal.add(resolve(at).endDay, 1 + pred.lag);
          if (startDay === null || candidate > startDay) startDay = candidate;
        }
      }
      row = {
        summary: false,
        milestone: task.milestone === true,
        startDay,
        endDay: cal.add(startDay, task.duration - 1),
        duration: task.duration,
        progress: task.progress,
        effort: task.effort,
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

  const project = { count: tasks.length, startDay: null, endDay: null, duration: 0, progress: 0, effort: null };
  const top = rows.filter((row) => row.level === 0);
  if (top.length) {
    project.startDay = Math.min(...top.map((row) => row.startDay));
    project.endDay = Math.max(...top.map((row) => row.endDay));
    project.duration = cal.count(project.startDay, project.endDay);
    const work = top.reduce((sum, row) => sum + row.work, 0);
    project.progress = work ? top.reduce((sum, row) => sum + row.done, 0) / work : 0;
    for (const row of top) if (row.effort !== null) project.effort = (project.effort ?? 0) + row.effort;
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
 * Moves the start of a leaf task to `wanted` (a working day). A task with predecessors follows them, so
 * moving it means changing their lags; a start before they end becomes the first day they allow, and
 * that is reported as { start } (null when the start is as asked).
 */
function setStart(d, i, wanted, cal) {
  const task = d.tasks[i];
  if (!task.predecessors.length) {
    task.start = formatDate(wanted);
    return null;
  }
  const plan = schedule(d, cal);
  const earliest = Math.max(...task.predecessors.map((pred) => cal.add(plan.byId.get(pred.task).endDay, 1)));
  const target = Math.max(wanted, earliest);
  const delta = cal.diff(plan.rows[i].startDay, target);
  if (delta) {
    // A predecessor that does not decide the start would go below 0; it stays at 0 and still ends before the start.
    task.predecessors = task.predecessors.map((pred) => {
      const lag = Math.max(0, pred.lag + delta);
      if (lag > MAX_LAG) fail('invalid_input', 'err.lagOver', { max: MAX_LAG });
      return { task: pred.task, lag };
    });
  }
  return target > wanted ? { start: formatDate(target) } : null;
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
  return sign * moved;
}

function patchTask(d, i, patch, cal) {
  const task = d.tasks[i];
  if (patch.end !== undefined && patch.duration !== undefined) fail('invalid_input', 'err.endAndDuration');
  const derived = ['start', 'end', 'duration', 'progress', 'effort', 'predecessors'].filter((key) => patch[key] !== undefined);
  if (patch.milestone === true) derived.push('milestone');
  if (derived.length && isSummary(d.tasks, i)) fail('summary_field', 'err.summaryField', { name: task.name, fields: derived.join(', ') });
  for (const key of ['name', 'resources', 'color', 'note', 'collapsed', 'milestone', 'progress', 'effort']) if (patch[key] !== undefined) task[key] = patch[key];
  // A milestone is a point in time: one working day.
  if (task.milestone && ((patch.duration !== undefined && patch.duration !== 1) || patch.end !== undefined)) fail('invalid_input', 'err.milestoneDuration', { name: task.name });
  if (patch.milestone === true) task.duration = 1;
  // A parent's color is the default for the tasks under it, so setting it recolors the whole group.
  if (patch.color !== undefined && isSummary(d.tasks, i)) {
    for (let j = i + 1, end = subtreeEnd(d.tasks, i); j < end; j++) d.tasks[j].color = 'none';
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

export const OPS = ['add', 'update', 'delete', 'duplicate', 'move', 'indent', 'outdent', 'shift', 'slide', 'project', 'save_version', 'restore_version', 'delete_version'];

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
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      const removed = d.tasks.splice(i, subtreeEnd(d.tasks, i) - i);
      const gone = new Set(removed.map((task) => task.id));
      for (const task of d.tasks) task.predecessors = task.predecessors.filter((pred) => !gone.has(pred.task));
      return { op: 'delete', id: op.id, removed: removed.length };
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
      allowKeys(op, ['op', 'name', 'holidays']);
      if (op.name !== undefined) {
        if (typeof op.name !== 'string' || op.name.length > 200) bad('name', 'expect.name200');
        d.project.name = op.name.trim();
      }
      if (op.holidays !== undefined) d.project.holidays = FIELD.holidays(op.holidays, 'holidays');
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
  const results = ops.map((op, i) => {
    try {
      return runOp(d, op, ctx);
    } catch (error) {
      if (error instanceof ModelError) error.message = `ops[${i}] (${op?.op}): ${error.message}`;
      throw error;
    }
  });
  finalize(d);
  return { doc: d, results };
}

// ---- Output --------------------------------------------------------------------------------------------------

/** What the agent sees: every task with its computed dates. */
export function describe(doc, { includeVersions = false } = {}) {
  const { rows, project } = schedule(doc);
  const out = {
    project: {
      name: doc.project.name,
      holidays: doc.project.holidays,
      start: project.startDay === null ? null : formatDate(project.startDay),
      end: project.endDay === null ? null : formatDate(project.endDay),
      workingDays: project.duration,
      progress: round2(project.progress),
      effort: project.effort,
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
      effort: rows[i].effort,
      resources: task.resources,
      color: task.color,
      predecessors: task.predecessors,
      note: task.note,
      collapsed: task.collapsed,
    })),
  };
  if (includeVersions) out.versions = doc.versions.map((version) => ({ id: version.id, name: version.name, createdAt: version.createdAt, taskCount: version.tasks.length }));
  return out;
}
