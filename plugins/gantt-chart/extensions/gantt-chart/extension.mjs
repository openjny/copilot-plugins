import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { Chart } from './lib/chart.mjs';
import { resolveLocale, setLocale, t } from './lib/i18n.mjs';
import { COLORS, MAX_LAG, ModelError, OPS, describe } from './lib/model.mjs';
import { CANVAS_ID, loadLocale } from './lib/store.mjs';

let session;
const log = (message) => {
  session?.log(`[${CANVAS_ID}] ${message}`, { ephemeral: true }).catch(() => {});
};
const charts = new Map();

// Messages follow the chosen language; "auto" follows the OS until a page tells which language it uses.
const savedLocale = await loadLocale();
setLocale(savedLocale === 'auto' ? resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale) : savedLocale);

function toCanvasError(error) {
  if (error instanceof CanvasError) return error;
  if (error instanceof ModelError) return new CanvasError(error.code, error.message);
  return new CanvasError('internal_error', t('err.unexpected', { message: error?.message ?? error }));
}

async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    throw toCanvasError(error);
  }
}

function asObject(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new CanvasError('invalid_input', t('err.inputObject'));
  return input;
}

function optionalString(value, name) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new CanvasError('invalid_input', t('err.nonEmptyString', { name }));
  return value;
}

async function ensureChart(instanceId, baseDir) {
  let chart = charts.get(instanceId);
  if (!chart) {
    chart = new Chart({ baseDir, log });
    charts.set(instanceId, chart);
  }
  if (baseDir) chart.baseDir = baseDir;
  await chart.ensureServer();
  return chart;
}

const noFileOpen = () => new CanvasError('no_file', t('err.noFileOpen'));

/** The chart of an open panel, with whatever is on disk now. */
async function openedChart(ctx) {
  const chart = charts.get(ctx.instanceId);
  if (!chart?.file) throw noFileOpen();
  await chart.refresh();
  return chart;
}

function chartView(chart, extra = {}) {
  if (chart.error) throw new CanvasError(chart.error.code, t('err.cannotLoad', { message: chart.error.message }));
  return { file: chart.file, ...describe(chart.doc, extra) };
}

const idProperty = { type: 'string', description: 'Task id, as listed by get_chart (letters, digits, "_" and "-", up to 32 characters).' };
const taskFields = {
  name: { type: 'string', description: 'Task name. For "project" and "save_version" it is the project or version name.' },
  start: { type: 'string', description: 'Start date, YYYY-MM-DD. A weekend or holiday moves to the next working day. For a task with predecessors the start follows them, so this changes their lags; a date before the predecessors end becomes the first day they allow, and the op result reports it in "adjusted.start".' },
  end: { type: 'string', description: 'Last day, YYYY-MM-DD; sets the duration. Do not combine with duration.' },
  duration: { type: ['integer', 'string'], description: 'Working days: 3, "3d" or "2w" (a week is 5 working days). Do not combine with end.' },
  progress: { type: 'number', minimum: 0, maximum: 100, description: 'Percent complete. Not for a parent task: it is computed from its children.' },
  milestone: { type: 'boolean', description: 'true makes the task a milestone: a point in time shown as a diamond, one working day long. Not for a parent task.' },
  effort: { type: ['number', 'null'], description: 'Effort in hours; null clears it.' },
  resources: { type: 'array', items: { type: 'string' }, description: 'People or teams assigned.' },
  color: { type: 'string', enum: COLORS, description: 'Color label of the bar. "inherit" (the default) takes the color of the parent task, or blue when no parent has one; a color on a parent is the default for the tasks under it, and setting it clears the colors of the tasks under it.' },
  note: { type: 'string', description: 'Free-text memo.' },
  collapsed: { type: 'boolean', description: 'Collapse a parent task in the list.' },
  predecessors: {
    type: 'array',
    description: 'Replaces the predecessors. The task starts after the latest of them: the next working day after its end, plus lag working days.',
    items: { type: 'object', properties: { task: idProperty, lag: { type: 'integer', minimum: 0, maximum: MAX_LAG, description: 'Working days added after the next working day of the predecessor end (0 or more; a task cannot start before its predecessors end). Default 0.' } }, required: ['task'], additionalProperties: false },
  },
};
const opSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: OPS },
    id: { ...idProperty, description: 'add: an id for the new task (optional, generated if omitted). Other ops: the task (or, for restore_version and delete_version, the version) to act on.' },
    ids: { type: 'array', minItems: 1, maxItems: 500, items: idProperty, description: 'slide: the tasks to move together (a parent stands for its children).' },
    days: { type: 'integer', minimum: -2600, maximum: 2600, description: 'slide: working days to move the tasks by (negative = earlier), keeping their positions relative to each other. A move that would start a task before its predecessors end is cut down to the most that works; the op result reports it in "adjusted.days".' },
    parent: { ...idProperty, description: 'add / move: place as the last child of this task.' },
    after: { ...idProperty, description: 'add / move: place right after this task and its children, at the same level.' },
    before: { ...idProperty, description: 'add / move: place right before this task, at the same level.' },
    direction: { type: 'string', enum: ['up', 'down'], description: 'shift: swap with the previous or next task of the same level.' },
    holidays: { type: 'array', items: { type: 'string' }, description: 'project: the holidays (YYYY-MM-DD); replaces the list. Saturdays and Sundays are always off.' },
    ...taskFields,
  },
  required: ['op'],
  additionalProperties: false,
};

const pathProperty = { type: 'string', description: 'Path of the chart JSON file, for example plan.gantt.json (relative paths resolve against the session working directory). A path that does not exist yet is created.' };

const ganttChart = createCanvas({
  id: CANVAS_ID,
  displayName: t('app.name'),
  description: 'An editable Gantt chart saved in a JSON file (see schema/gantt-chart.schema.json): task tree with parent tasks and milestones, timeline bars, dependencies, progress, color labels, resources, undo / redo and saved versions, editable by the user in the page and by the agent through actions.',
  inputSchema: {
    type: 'object',
    properties: { path: pathProperty, name: { type: 'string', description: 'Project name, used only when the file is created.' } },
    additionalProperties: false,
  },
  actions: [
    {
      name: 'open_chart',
      description: 'Open (or create) a chart file in this panel. Returns the task count.',
      inputSchema: { type: 'object', properties: { path: pathProperty, name: { type: 'string', description: 'Project name, used only when the file is created.' } }, required: ['path'], additionalProperties: false },
      handler: (ctx) => guarded(async () => {
        const input = asObject(ctx.input);
        optionalString(input.path, 'path');
        if (!input.path) throw new CanvasError('invalid_input', t('err.pathRequired'));
        const chart = await ensureChart(ctx.instanceId, ctx.session?.workingDirectory);
        await chart.openFile(input.path, { name: optionalString(input.name, 'name') });
        return { file: chart.file, taskCount: chart.doc.tasks.length };
      }),
    },
    {
      name: 'get_chart',
      description: 'Read the chart: every task with its computed start, end, duration and progress, the project summary, and the task the user has selected (selectedTaskId; selectedTaskIds lists them all when several are selected). Reads the file again first, so it also shows edits made to the file directly.',
      inputSchema: { type: 'object', properties: { includeVersions: { type: 'boolean', description: 'Also list the saved versions.' } }, additionalProperties: false },
      handler: (ctx) => guarded(async () => {
        const input = asObject(ctx.input);
        const chart = await openedChart(ctx);
        return { ...chartView(chart, { includeVersions: input.includeVersions === true }), selectedTaskId: chart.selection, ...(chart.selectionIds.length > 1 && { selectedTaskIds: chart.selectionIds }) };
      }),
    },
    {
      name: 'edit_chart',
      description: 'Apply one or more edits to the chart, all or nothing, and save the file. The page updates at once, and the user can undo the edit there. Returns one result per op (the id of an added task) and the resulting chart. Parent tasks (tasks with children) take their dates and progress from their children. Durations count working days (Saturdays, Sundays and project holidays are off).',
      inputSchema: {
        type: 'object',
        properties: {
          ops: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            description: 'Edits, applied in order. add {name, parent|after|before, start, end|duration, progress, milestone, effort, resources, color, predecessors, id}; update {id, ...fields}; delete {id} (with its children); duplicate {id} (copies a task with its children right after it; the result has "copy", the id of the new task); move {id, parent|after|before}; indent/outdent {id}; shift {id, direction}; slide {ids, days} moves tasks together by working days; project {name, holidays}; save_version {name} saves a version; restore_version {id}; delete_version {id}.',
            items: opSchema,
          },
        },
        required: ['ops'],
        additionalProperties: false,
      },
      handler: (ctx) => guarded(async () => {
        const input = asObject(ctx.input);
        const chart = charts.get(ctx.instanceId);
        if (!chart?.file) throw noFileOpen();
        const { results } = await chart.mutate(input.ops);
        return { results, ...chartView(chart) };
      }),
    },
    {
      name: 'reload',
      description: 'Read the chart file again, for example after it was edited outside the canvas. The canvas also does this by itself every second.',
      handler: (ctx) => guarded(async () => {
        const chart = await openedChart(ctx);
        return { file: chart.file, taskCount: chart.doc?.tasks.length ?? 0, error: chart.error };
      }),
    },
  ],
  open: (ctx) => guarded(async () => {
    const input = asObject(ctx.input);
    optionalString(input.path, 'path');
    const chart = await ensureChart(ctx.instanceId, ctx.session?.workingDirectory);
    if (input.path !== undefined) await chart.openFile(input.path, { name: optionalString(input.name, 'name') });
    else if (chart.file) await chart.refresh();
    return { url: chart.url, title: chart.title };
  }),
  onClose: (ctx) => {
    const chart = charts.get(ctx.instanceId);
    charts.delete(ctx.instanceId);
    return chart?.close().catch((error) => log(`Failed to close: ${error.message}`));
  },
});

session = await joinSession({
  canvases: [ganttChart],
  hooks: {
    onUserPromptSubmitted: async () => {
      try {
        const lines = [];
        for (const [instanceId, chart] of charts) {
          const selected = chart.consumeSelection();
          if (!selected) continue;
          if (selected.tasks.length === 1) {
            const [task] = selected.tasks;
            lines.push(t('agent.selectedOne', { file: selected.file, row: task.row, name: task.name, id: task.id, instance: instanceId }));
          } else {
            lines.push(t('agent.selectedMany', { file: selected.file, count: selected.tasks.length, instance: instanceId }), ...selected.tasks.map((task) => t('agent.selectedItem', { row: task.row, name: task.name, id: task.id })));
          }
        }
        if (!lines.length) return undefined;
        return { additionalContext: [t('agent.selectedHeader', { canvas: CANVAS_ID }), ...lines, t('agent.selectedFooter')].join('\n') };
      } catch (error) {
        log(`Failed to check the selected tasks: ${error.message}`);
        return undefined;
      }
    },
  },
});
log('Registered the Gantt chart canvas.');

process.on('unhandledRejection', (reason) => log(`Unhandled rejection: ${reason?.stack ?? reason}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    Promise.allSettled([...charts.values()].map((chart) => chart.close())).finally(() => process.exit(0));
  });
}
