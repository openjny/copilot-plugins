// The chart file (format version 2): reading it into the in-memory document and writing the document back.
//
// In the file the tasks are a tree (a parent has "children"; see schema/gantt-chart.schema.json, which is the
// definition of the format). In memory they are a flat list in display order with a "level" per task, which
// is what the model works on. Node only: the schema is read from disk.

import { readFileSync } from 'node:fs';
import { t } from './i18n.mjs';
import { DEFAULT_WEEKLY_OFF, FORMAT, MAX_LEVEL, VERSION, blankTask, checkTasks, fail, finalize, isSummary, parseDate, sortWeekdays } from './model.mjs';
import { validate } from './validate.mjs';

export const SCHEMA = JSON.parse(readFileSync(new URL('../schema/gantt-chart.schema.json', import.meta.url), 'utf8'));
export const SCHEMA_URL = SCHEMA.$id;

const FORMATS = {
  date: (text) => parseDate(text) !== null,
  'date-time': (text) => /^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text)),
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---- Reading ---------------------------------------------------------------------------------------------

function describeErrors({ errors, truncated }) {
  const shown = errors.slice(0, 5).map((error) => {
    const where = error.owner && error.owner !== error.path ? t('err.schema.in', { path: error.path || t('err.schema.root'), owner: error.owner }) : error.path || t('err.schema.root');
    return t(`err.schema.${error.keyword}`, { ...error.params, where });
  });
  const more = errors.length - shown.length;
  return shown.join(' / ') + (more > 0 || truncated ? ` ${t('err.schema.more', { count: Math.max(more, 1) })}` : '');
}

/** Appends the tasks of `nodes` (and their children) to `out` as a flat list. */
function flatten(nodes, level, out, where, ids) {
  nodes.forEach((node, i) => {
    const at = `${where}[${i}]`;
    if (level > MAX_LEVEL) fail('invalid_file', 'err.file.tooDeep', { where: at, max: MAX_LEVEL + 1 });
    if (ids.has(node.id)) fail('invalid_file', 'err.file.dupId', { where: at, id: node.id });
    ids.add(node.id);
    const task = blankTask(node.id);
    task.name = node.name.trim();
    if (!task.name) fail('invalid_file', 'err.file.emptyName', { where: at });
    task.level = level;
    if (node.start !== undefined) task.start = node.start;
    if (node.duration !== undefined) task.duration = node.duration;
    if (node.progress !== undefined) task.progress = node.progress;
    if (node.milestone !== undefined) task.milestone = node.milestone;
    if (node.estimate !== undefined) task.estimate = node.estimate;
    if (node.actual !== undefined) task.actual = node.actual;
    if (node.resources !== undefined) task.resources = node.resources;
    if (node.color !== undefined) task.color = node.color;
    if (node.note !== undefined) task.note = node.note;
    if (node.due !== undefined) task.due = node.due;
    if (node.collapsed !== undefined) task.collapsed = node.collapsed;
    if (node.predecessors !== undefined) {
      const seen = new Set();
      task.predecessors = node.predecessors.map((pred) => {
        if (seen.has(pred.task)) fail('invalid_file', 'err.file.dupPred', { where: at, task: pred.task });
        seen.add(pred.task);
        return { task: pred.task, lag: pred.lag ?? 0 };
      });
    }
    out.push(task);
    if (node.children) flatten(node.children, level + 1, out, `${at}.children`, ids);
  });
  return out;
}

const readProject = (raw) => ({
  name: (raw.name ?? '').trim(),
  weeklyOff: sortWeekdays(raw.weeklyOff ?? DEFAULT_WEEKLY_OFF),
  holidays: [...(raw.holidays ?? [])].sort(),
  extraWorkdays: [...(raw.extraWorkdays ?? [])].sort(),
  weekStart: raw.weekStart ?? 'mon',
});

/** The project as the file holds it: what is still at its default (Saturday and Sunday off, no extra workdays, weeks starting on Monday) is left out. */
const projectNode = (project) => ({
  name: project.name,
  ...(project.weeklyOff.join() !== DEFAULT_WEEKLY_OFF.join() && { weeklyOff: project.weeklyOff }),
  holidays: project.holidays,
  ...(project.extraWorkdays.length && { extraWorkdays: project.extraWorkdays }),
  ...(project.weekStart !== 'mon' && { weekStart: project.weekStart }),
});

/** A version 2 file differs only in naming its hours "effort" (now "estimate", with "actual" next to it): read it as the current version. */
function upgradeV2(raw) {
  const rename = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (isObject(node) && node.effort !== undefined) {
        node.estimate = node.effort;
        delete node.effort;
      }
      if (isObject(node)) rename(node.children);
    }
  };
  rename(raw.tasks);
  for (const version of Array.isArray(raw.versions) ? raw.versions : []) if (isObject(version)) rename(version.tasks);
  raw.version = VERSION;
}

/** Parses the content of a chart file (the parsed JSON). Throws a ModelError that says what is wrong and where. */
export function readDoc(raw) {
  if (!isObject(raw)) fail('invalid_file', 'err.file.notObject');
  if (raw.format !== FORMAT) fail('invalid_file', 'err.file.notChart', { format: FORMAT });
  if (raw.version === 2) upgradeV2(raw);
  if (raw.version !== VERSION) fail('unsupported_version', 'err.file.version', { version: JSON.stringify(raw.version), supported: VERSION });
  const result = validate(SCHEMA, raw, { formats: FORMATS });
  if (result.errors.length) fail('invalid_file', 'err.file.schema', { details: describeErrors(result) });

  const tasks = flatten(raw.tasks, 0, [], 'tasks', new Set());
  checkTasks(tasks, 'tasks', 'invalid_file');
  const versionIds = new Set();
  const versions = (raw.versions ?? []).map((item, i) => {
    const where = `versions[${i}]`;
    if (versionIds.has(item.id)) fail('invalid_file', 'err.file.dupId', { where, id: item.id });
    versionIds.add(item.id);
    const flat = flatten(item.tasks, 0, [], `${where}.tasks`, new Set());
    checkTasks(flat, `${where}.tasks`, 'invalid_file');
    return { id: item.id, name: item.name, createdAt: item.createdAt, project: readProject(item.project), tasks: flat };
  });
  const doc = { format: FORMAT, version: VERSION, project: readProject(raw.project), tasks, versions };
  finalize(doc, 'invalid_file');
  return doc;
}

// ---- Writing ---------------------------------------------------------------------------------------------

/** The tasks as the tree the file holds: a task that is followed by deeper tasks gets them as its children. */
export function toTree(tasks) {
  const root = [];
  const stack = [{ level: -1, children: root }];
  tasks.forEach((task, i) => {
    while (stack[stack.length - 1].level >= task.level) stack.pop();
    const parent = isSummary(tasks, i);
    const node = parent ? { id: task.id, name: task.name } : { id: task.id, name: task.name, start: task.start, duration: task.duration, progress: task.progress };
    if (!parent && task.milestone) node.milestone = true;
    if (!parent && task.estimate !== null) node.estimate = task.estimate;
    if (!parent && task.actual !== null) node.actual = task.actual;
    if (task.resources.length) node.resources = task.resources;
    if (task.color !== 'inherit') node.color = task.color;
    if (!parent && task.predecessors.length) node.predecessors = task.predecessors.map((pred) => (pred.lag ? { task: pred.task, lag: pred.lag } : { task: pred.task }));
    if (task.note) node.note = task.note;
    if (task.due) node.due = task.due;
    if (parent) {
      if (task.collapsed) node.collapsed = true;
      node.children = [];
    }
    stack[stack.length - 1].children.push(node);
    if (parent) stack.push({ level: task.level, children: node.children });
  });
  return root;
}

const pad = (depth) => '  '.repeat(depth);

/** "[ ... ]" with one task per line (a parent opens its own block), closing at the indent of `depth`. */
function renderTasks(nodes, depth) {
  if (!nodes.length) return '[]';
  return `[\n${nodes.map((node) => renderNode(node, depth + 1)).join(',\n')}\n${pad(depth)}]`;
}

function renderNode(node, depth) {
  const { children, ...own } = node;
  if (!children) return pad(depth) + JSON.stringify(own);
  return `${pad(depth)}${JSON.stringify(own).slice(0, -1)},"children":${renderTasks(children, depth)}}`;
}

/** The file text: one line per task, so that diffs and hand edits stay easy. */
export function serializeDoc(doc) {
  const lines = ['{', `  "$schema": ${JSON.stringify(SCHEMA_URL)},`, `  "format": ${JSON.stringify(FORMAT)},`, `  "version": ${VERSION},`, `  "project": ${JSON.stringify(projectNode(doc.project))},`, `  "tasks": ${renderTasks(toTree(doc.tasks), 1)}${doc.versions.length ? ',' : ''}`];
  if (doc.versions.length) {
    const versions = doc.versions.map((version) => {
      const head = JSON.stringify({ id: version.id, name: version.name, createdAt: version.createdAt, project: projectNode(version.project) }).slice(0, -1);
      return `${pad(2)}${head},"tasks":${renderTasks(toTree(version.tasks), 2)}}`;
    });
    lines.push(`  "versions": [\n${versions.join(',\n')}\n  ]`);
  }
  lines.push('}', '');
  return lines.join('\n');
}
