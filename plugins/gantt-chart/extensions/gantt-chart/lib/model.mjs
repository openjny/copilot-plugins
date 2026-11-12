// Pure chart model shared by the extension (Node) and the page (browser): dates, working-day
// calendar, validation, scheduling and edit operations. It must not import anything.

export const FORMAT = 'openjny-gantt-chart';
export const VERSION = 1;
export const COLORS = ['none', 'green', 'orange', 'red', 'purple', 'teal', 'gray'];
export const MAX_LEVEL = 8;
export const MAX_SNAPSHOTS = 100;
const MAX_TASKS = 2000;
const MAX_DURATION = 3650;
const MAX_LAG = 999;
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TASK_FIELDS = ['name', 'start', 'duration', 'progress', 'effort', 'resources', 'color', 'note', 'collapsed', 'predecessors'];

export class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ModelError(code, message);
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
    return fail('invalid_input', '稼働日が見つかりません。休日の指定を確認してください。');
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

const bad = (what, expect) => fail('invalid_input', `${what} は${expect}で指定してください。`);

const FIELD = {
  name(value, what) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) bad(what, '1〜200 文字の文字列');
    return value.trim();
  },
  start(value, what) {
    if (parseDate(value) === null) bad(what, 'YYYY-MM-DD 形式の日付（1970〜2200 年）');
    return value;
  },
  end(value, what) {
    return FIELD.start(value, what);
  },
  duration(value, what) {
    const days = parseDuration(value);
    if (days === null) bad(what, `1〜${MAX_DURATION} の稼働日数（整数、または "3d" "2w"）`);
    return days;
  },
  progress(value, what) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) bad(what, '0〜100 の数値');
    return Math.round(value);
  },
  effort(value, what) {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e6) bad(what, '0 以上の数値（または null）');
    return round2(value);
  },
  resources(value, what) {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,、]/) : null;
    if (!list || list.some((item) => typeof item !== 'string')) bad(what, '文字列の配列（またはカンマ区切りの文字列）');
    const names = [...new Set(list.map((item) => item.trim()).filter(Boolean))];
    if (names.length > 20 || names.some((item) => item.length > 50)) bad(what, '50 文字以内・最大 20 件');
    return names;
  },
  color(value, what) {
    if (!COLORS.includes(value)) bad(what, `次のいずれか（${COLORS.join(', ')}）`);
    return value;
  },
  note(value, what) {
    if (typeof value !== 'string' || value.length > 2000) bad(what, '2000 文字以内の文字列');
    return value;
  },
  collapsed(value, what) {
    if (typeof value !== 'boolean') bad(what, '真偽値');
    return value;
  },
  predecessors(value, what) {
    if (!Array.isArray(value) || value.length > 50) bad(what, '先行タスクの配列（最大 50 件）');
    const seen = new Set();
    return value.map((item, i) => {
      const where = `${what}[${i}]`;
      if (!isObject(item)) bad(where, '{ task, lag } のオブジェクト');
      for (const key of Object.keys(item)) if (key !== 'task' && key !== 'lag') fail('invalid_input', `${where} に未知の項目 "${key}" があります。`);
      if (typeof item.task !== 'string' || !ID_RE.test(item.task)) bad(`${where}.task`, 'タスク ID');
      if (seen.has(item.task)) fail('invalid_input', `${where}: 先行タスク ${item.task} が重複しています。`);
      seen.add(item.task);
      const lag = item.lag === undefined ? 0 : item.lag;
      if (!Number.isInteger(lag) || Math.abs(lag) > MAX_LAG) bad(`${where}.lag`, `±${MAX_LAG} 以内の整数（稼働日）`);
      return { task: item.task, lag };
    });
  },
  holidays(value, what) {
    if (!Array.isArray(value) || value.length > 500 || value.some((item) => parseDate(item) === null)) {
      bad(what, 'YYYY-MM-DD 形式の日付の配列（最大 500 件）');
    }
    return [...new Set(value)].sort();
  },
};

const blankTask = (id) => ({
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
});

// ---- Reading a document -----------------------------------------------------------------------------------

function readTasks(raw, where) {
  if (!Array.isArray(raw)) fail('invalid_file', `${where} が配列ではありません。`);
  if (raw.length > MAX_TASKS) fail('invalid_file', `${where} は ${MAX_TASKS} 件までです。`);
  const ids = new Set();
  return raw.map((item, i) => {
    const at = `${where}[${i}]`;
    try {
      if (!isObject(item)) fail('invalid_file', `${at} がオブジェクトではありません。`);
      if (typeof item.id !== 'string' || !ID_RE.test(item.id)) fail('invalid_file', `${at}.id は英数字・_・- の 1〜32 文字で指定してください。`);
      if (ids.has(item.id)) fail('invalid_file', `${at}.id "${item.id}" が重複しています。`);
      ids.add(item.id);
      const task = blankTask(item.id);
      if (typeof item.name !== 'string') fail('invalid_file', `${at}.name は文字列で指定してください。`);
      task.name = item.name.trim().slice(0, 200);
      if (!Number.isInteger(item.level) || item.level < 0 || item.level > MAX_LEVEL) fail('invalid_file', `${at}.level は 0〜${MAX_LEVEL} の整数で指定してください。`);
      task.level = item.level;
      for (const key of TASK_FIELDS) {
        if (key === 'name') continue;
        if (item[key] === undefined) {
          if (key === 'start' || key === 'duration') fail('invalid_file', `${at}.${key} がありません。`);
          continue;
        }
        task[key] = FIELD[key](item[key], `${at}.${key}`);
      }
      return task;
    } catch (error) {
      throw error instanceof ModelError ? new ModelError('invalid_file', error.message) : error;
    }
  });
}

function readProject(raw, where = 'project') {
  if (!isObject(raw)) fail('invalid_file', `${where} がオブジェクトではありません。`);
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '';
  try {
    return { name, holidays: raw.holidays === undefined ? [] : FIELD.holidays(raw.holidays, `${where}.holidays`) };
  } catch (error) {
    throw error instanceof ModelError ? new ModelError('invalid_file', error.message) : error;
  }
}

function readSnapshots(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SNAPSHOTS) fail('invalid_file', `snapshots は ${MAX_SNAPSHOTS} 件以内の配列にしてください。`);
  const ids = new Set();
  return raw.map((item, i) => {
    const at = `snapshots[${i}]`;
    if (!isObject(item)) fail('invalid_file', `${at} がオブジェクトではありません。`);
    if (typeof item.id !== 'string' || !ID_RE.test(item.id) || ids.has(item.id)) fail('invalid_file', `${at}.id が不正または重複しています。`);
    ids.add(item.id);
    if (typeof item.name !== 'string' || Number.isNaN(Date.parse(item.createdAt))) fail('invalid_file', `${at} の name / createdAt が不正です。`);
    const tasks = readTasks(item.tasks, `${at}.tasks`);
    checkTasks(tasks, `${at}.tasks`, 'invalid_file');
    return { id: item.id, name: item.name.slice(0, 200), createdAt: item.createdAt, project: readProject(item.project, `${at}.project`), tasks };
  });
}

/** Parses the content of a chart file. */
export function readDoc(raw) {
  if (!isObject(raw)) fail('invalid_file', 'JSON のルートがオブジェクトではありません。');
  if (raw.format !== FORMAT) fail('invalid_file', `ガントチャートのファイルではありません（format が "${FORMAT}" ではありません）。`);
  if (raw.version !== VERSION) fail('unsupported_version', `version ${JSON.stringify(raw.version)} には未対応です（対応: ${VERSION}）。`);
  const doc = { format: FORMAT, version: VERSION, project: readProject(raw.project), tasks: readTasks(raw.tasks, 'tasks'), snapshots: readSnapshots(raw.snapshots) };
  finalize(doc, 'invalid_file');
  return doc;
}

export function emptyDoc(name = '') {
  return { format: FORMAT, version: VERSION, project: { name: name.slice(0, 200), holidays: [] }, tasks: [], snapshots: [] };
}

function checkTasks(tasks, where, code) {
  const ids = new Set(tasks.map((task) => task.id));
  tasks.forEach((task, i) => {
    if (i === 0 ? task.level !== 0 : task.level > tasks[i - 1].level + 1) {
      fail(code, `${where}[${i}]（「${task.name}」）の level が不正です。最初のタスクは 0、以降は直前のタスクの level + 1 以下にしてください。`);
    }
    for (const pred of task.predecessors) {
      if (pred.task === task.id) fail(code, `「${task.name}」が自分自身を先行タスクにしています。`);
      if (!ids.has(pred.task)) fail(code, `「${task.name}」の先行タスク ${pred.task} が存在しません。`);
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
    if (isSummary(doc.tasks, i)) task.predecessors = [];
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
    if (mark[i] === 1) fail('cycle', `先行タスクが循環しています（「${tasks[i].name}」）。`);
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
      row = { summary: true, startDay, endDay, duration: cal.count(startDay, endDay), progress: work ? done / work : 0, effort, work, done };
    } else {
      let startDay = cal.next(parseDate(task.start));
      if (task.predecessors.length) {
        startDay = null;
        for (const pred of task.predecessors) {
          const at = index.get(pred.task);
          if (at === undefined) fail('invalid_input', `「${task.name}」の先行タスク ${pred.task} が存在しません。`);
          const candidate = cal.add(resolve(at).endDay, 1 + pred.lag);
          if (startDay === null || candidate > startDay) startDay = candidate;
        }
      }
      row = {
        summary: false,
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
  if (i < 0) fail('not_found', `${what}: タスク ${JSON.stringify(id)} が見つかりません。`);
  return i;
}

function allowKeys(op, allowed) {
  for (const key of Object.keys(op)) {
    if (!allowed.includes(key)) fail('invalid_input', `未知の項目 "${key}" があります（使用できる項目: ${allowed.join(', ')}）。`);
  }
}

function readPatch(op) {
  const patch = {};
  for (const key of [...TASK_FIELDS, 'end']) if (op[key] !== undefined) patch[key] = FIELD[key](op[key], key);
  return patch;
}

function newId(d) {
  let max = 0;
  for (const task of d.tasks) {
    const match = /^t(\d+)$/.exec(task.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `t${max + 1}`;
}

/** Where a task goes: as the last child of `parent`, after or before another task, or at the end. */
function resolveTarget(d, op) {
  const given = ['parent', 'after', 'before'].filter((key) => op[key] !== undefined);
  if (given.length > 1) fail('invalid_input', 'parent / after / before は 1 つだけ指定できます。');
  if (!given.length) return { index: d.tasks.length, level: 0 };
  const key = given[0];
  const i = findIndex(d, op[key], key);
  const level = d.tasks[i].level;
  if (key === 'parent') {
    if (level + 1 > MAX_LEVEL) fail('invalid_input', `階層は ${MAX_LEVEL + 1} 段までです。`);
    return { index: subtreeEnd(d.tasks, i), level: level + 1 };
  }
  return key === 'after' ? { index: subtreeEnd(d.tasks, i), level } : { index: i, level };
}

function shiftLevels(tasks, from, to, delta) {
  for (let i = from; i < to; i++) {
    const level = tasks[i].level + delta;
    if (level < 0 || level > MAX_LEVEL) fail('invalid_input', `階層は 0〜${MAX_LEVEL} の範囲にしてください。`);
    tasks[i].level = level;
  }
}

function patchTask(d, i, patch, cal) {
  const task = d.tasks[i];
  if (patch.end !== undefined && patch.duration !== undefined) fail('invalid_input', 'end と duration は同時に指定できません。');
  const derived = ['start', 'end', 'duration', 'progress', 'effort', 'predecessors'].filter((key) => patch[key] !== undefined);
  if (derived.length && isSummary(d.tasks, i)) {
    fail('summary_field', `「${task.name}」は子タスクを持つため ${derived.join(', ')} を変更できません（子タスクから自動で決まります）。`);
  }
  for (const key of ['name', 'resources', 'color', 'note', 'collapsed', 'progress', 'effort']) if (patch[key] !== undefined) task[key] = patch[key];
  if (patch.predecessors !== undefined) {
    for (const pred of patch.predecessors) {
      if (pred.task === task.id) fail('invalid_input', '自分自身を先行タスクにはできません。');
      findIndex(d, pred.task, 'predecessors');
    }
    task.predecessors = patch.predecessors;
  }
  if (patch.duration !== undefined) task.duration = patch.duration;

  const driven = task.predecessors.length > 0;
  if (patch.start !== undefined) {
    const wanted = cal.next(parseDate(patch.start));
    if (driven) {
      // The start follows the predecessors, so moving it means changing their lags.
      const delta = cal.diff(schedule(d, cal).rows[i].startDay, wanted);
      if (delta) {
        task.predecessors = task.predecessors.map((pred) => {
          const lag = pred.lag + delta;
          if (Math.abs(lag) > MAX_LAG) fail('invalid_input', `ラグが ±${MAX_LAG} を超えます。`);
          return { task: pred.task, lag };
        });
      }
    } else {
      task.start = formatDate(wanted);
    }
  }
  if (patch.end !== undefined) {
    const first = driven ? schedule(d, cal).rows[i].startDay : cal.next(parseDate(task.start));
    const last = cal.prev(parseDate(patch.end));
    if (last < first) fail('invalid_range', `「${task.name}」の終了日が開始日より前です。`);
    task.duration = cal.count(first, last);
    if (task.duration > MAX_DURATION) fail('invalid_input', `期間は ${MAX_DURATION} 稼働日までです。`);
  }
}

function localStamp(now) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function takeSnapshot(d, name, now) {
  if (d.snapshots.length >= MAX_SNAPSHOTS) fail('too_many_versions', `バージョンは ${MAX_SNAPSHOTS} 件までです。古いバージョンを削除してください。`);
  finalize(d);
  let max = 0;
  for (const snap of d.snapshots) {
    const match = /^s(\d+)$/.exec(snap.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const snap = { id: `s${max + 1}`, name, createdAt: now.toISOString(), project: structuredClone(d.project), tasks: structuredClone(d.tasks) };
  d.snapshots.push(snap);
  return snap;
}

function runOp(d, op, ctx) {
  if (!isObject(op) || typeof op.op !== 'string') fail('invalid_input', 'op は { "op": "<name>", ... } の形で指定してください。');
  const now = ctx.now ?? new Date();
  const cal = makeCalendar(d.project);
  switch (op.op) {
    case 'add': {
      allowKeys(op, ['op', 'id', 'parent', 'after', 'before', 'end', ...TASK_FIELDS]);
      if (d.tasks.length >= MAX_TASKS) fail('invalid_input', `タスクは ${MAX_TASKS} 件までです。`);
      let id = newId(d);
      if (op.id !== undefined) {
        if (typeof op.id !== 'string' || !ID_RE.test(op.id)) bad('id', '英数字・_・- の 1〜32 文字');
        if (d.tasks.some((task) => task.id === op.id)) fail('invalid_input', `id "${op.id}" は既に使われています。`);
        id = op.id;
      }
      const patch = readPatch(op);
      const at = resolveTarget(d, op);
      const task = blankTask(id);
      task.name = patch.name ?? '新しいタスク';
      task.level = at.level;
      const above = at.index > 0 ? schedule(d, cal).rows[at.index - 1] : null;
      task.start = formatDate(above ? above.startDay : cal.next(todayDay(now)));
      d.tasks.splice(at.index, 0, task);
      patchTask(d, at.index, patch, cal);
      return { op: 'add', id };
    }
    case 'update': {
      allowKeys(op, ['op', 'id', 'end', ...TASK_FIELDS]);
      patchTask(d, findIndex(d, op.id, 'id'), readPatch(op), cal);
      return { op: 'update', id: op.id };
    }
    case 'delete': {
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      const removed = d.tasks.splice(i, subtreeEnd(d.tasks, i) - i);
      const gone = new Set(removed.map((task) => task.id));
      for (const task of d.tasks) task.predecessors = task.predecessors.filter((pred) => !gone.has(pred.task));
      return { op: 'delete', id: op.id, removed: removed.length };
    }
    case 'move': {
      allowKeys(op, ['op', 'id', 'parent', 'after', 'before']);
      const i = findIndex(d, op.id, 'id');
      const end = subtreeEnd(d.tasks, i);
      for (const key of ['parent', 'after', 'before']) {
        if (op[key] === undefined) continue;
        const at = findIndex(d, op[key], key);
        if (at >= i && at < end) fail('invalid_move', '自分自身または自分の子孫の位置には移動できません。');
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
      if (i === 0 || d.tasks[i - 1].level < d.tasks[i].level) fail('cannot_indent', '直前に同じ階層のタスクがないため、インデントできません。');
      shiftLevels(d.tasks, i, subtreeEnd(d.tasks, i), 1);
      return { op: 'indent', id: op.id };
    }
    case 'outdent': {
      allowKeys(op, ['op', 'id']);
      const i = findIndex(d, op.id, 'id');
      if (d.tasks[i].level === 0) fail('cannot_outdent', 'これ以上アウトデントできません。');
      shiftLevels(d.tasks, i, subtreeEnd(d.tasks, i), -1);
      return { op: 'outdent', id: op.id };
    }
    case 'shift': {
      allowKeys(op, ['op', 'id', 'direction']);
      if (op.direction !== 'up' && op.direction !== 'down') bad('direction', '"up" か "down"');
      const i = findIndex(d, op.id, 'id');
      const end = subtreeEnd(d.tasks, i);
      const level = d.tasks[i].level;
      if (op.direction === 'up') {
        let j = i - 1;
        while (j >= 0 && d.tasks[j].level > level) j--;
        if (j < 0 || d.tasks[j].level < level) fail('cannot_move', '上に入れ替えられる同じ階層のタスクがありません。');
        d.tasks.splice(j, 0, ...d.tasks.splice(i, end - i));
      } else {
        if (end >= d.tasks.length || d.tasks[end].level < level) fail('cannot_move', '下に入れ替えられる同じ階層のタスクがありません。');
        const after = subtreeEnd(d.tasks, end);
        d.tasks.splice(after - (end - i), 0, ...d.tasks.splice(i, end - i));
      }
      return { op: 'shift', id: op.id };
    }
    case 'project': {
      allowKeys(op, ['op', 'name', 'holidays']);
      if (op.name !== undefined) {
        if (typeof op.name !== 'string' || op.name.length > 200) bad('name', '200 文字以内の文字列');
        d.project.name = op.name.trim();
      }
      if (op.holidays !== undefined) d.project.holidays = FIELD.holidays(op.holidays, 'holidays');
      return { op: 'project' };
    }
    case 'snapshot': {
      allowKeys(op, ['op', 'name']);
      if (op.name !== undefined && (typeof op.name !== 'string' || op.name.length > 200)) bad('name', '200 文字以内の文字列');
      const snap = takeSnapshot(d, op.name?.trim() || localStamp(now), now);
      return { op: 'snapshot', id: snap.id };
    }
    case 'restore': {
      allowKeys(op, ['op', 'id']);
      const snap = d.snapshots.find((item) => item.id === op.id);
      if (!snap) fail('not_found', `id: バージョン ${JSON.stringify(op.id)} が見つかりません。`);
      takeSnapshot(d, `復元前（自動）${localStamp(now)}`, now);
      d.project = structuredClone(snap.project);
      d.tasks = structuredClone(snap.tasks);
      return { op: 'restore', id: op.id };
    }
    case 'delete_snapshot': {
      allowKeys(op, ['op', 'id']);
      const at = d.snapshots.findIndex((item) => item.id === op.id);
      if (at < 0) fail('not_found', `id: バージョン ${JSON.stringify(op.id)} が見つかりません。`);
      d.snapshots.splice(at, 1);
      return { op: 'delete_snapshot', id: op.id };
    }
    default:
      return fail('invalid_input', `未知の op "${op.op}" です（add, update, delete, move, indent, outdent, shift, project, snapshot, restore, delete_snapshot）。`);
  }
}

/**
 * Applies operations to a copy of the document, all or nothing. Returns the new document and one result
 * per operation (the id of an added task, for example).
 */
export function applyOps(doc, ops, ctx = {}) {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 200) fail('invalid_input', 'ops は 1〜200 件の配列で指定してください。');
  const d = structuredClone(doc);
  const results = ops.map((op, i) => {
    try {
      return runOp(d, op, ctx);
    } catch (error) {
      if (error instanceof ModelError) error.message = `ops[${i}]（${op?.op}）: ${error.message}`;
      throw error;
    }
  });
  finalize(d);
  return { doc: d, results };
}

// ---- Output --------------------------------------------------------------------------------------------------

const compactTask = (task) => {
  const out = { id: task.id, name: task.name, level: task.level, start: task.start, duration: task.duration, progress: task.progress };
  if (task.effort !== null) out.effort = task.effort;
  if (task.resources.length) out.resources = task.resources;
  if (task.color !== 'none') out.color = task.color;
  if (task.predecessors.length) out.predecessors = task.predecessors;
  if (task.note) out.note = task.note;
  if (task.collapsed) out.collapsed = true;
  return out;
};

/** The file text: one line per task so that diffs and hand edits stay easy. */
export function serializeDoc(doc) {
  const lines = (list) => (list.length ? `[\n${list.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]` : '[]');
  const snapshots = doc.snapshots.map((snap) => ({ id: snap.id, name: snap.name, createdAt: snap.createdAt, project: snap.project, tasks: snap.tasks.map(compactTask) }));
  return [
    '{',
    `  "format": ${JSON.stringify(doc.format)},`,
    `  "version": ${doc.version},`,
    `  "project": ${JSON.stringify(doc.project)},`,
    `  "tasks": ${lines(doc.tasks.map(compactTask))},`,
    `  "snapshots": ${lines(snapshots)}`,
    '}',
    '',
  ].join('\n');
}

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
  if (includeVersions) out.versions = doc.snapshots.map((snap) => ({ id: snap.id, name: snap.name, createdAt: snap.createdAt, taskCount: snap.tasks.length }));
  return out;
}
