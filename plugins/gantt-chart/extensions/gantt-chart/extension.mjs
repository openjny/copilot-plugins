import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { Chart } from './lib/chart.mjs';
import { COLORS, ModelError, describe } from './lib/model.mjs';
import { CANVAS_ID } from './lib/store.mjs';

let session;
const log = (message) => {
  session?.log(`[${CANVAS_ID}] ${message}`, { ephemeral: true }).catch(() => {});
};
const charts = new Map();

function toCanvasError(error) {
  if (error instanceof CanvasError) return error;
  if (error instanceof ModelError) return new CanvasError(error.code, error.message);
  return new CanvasError('internal_error', `予期しないエラー: ${error?.message ?? error}`);
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
  if (typeof input !== 'object' || Array.isArray(input)) throw new CanvasError('invalid_input', '入力はオブジェクトで指定してください。');
  return input;
}

function optionalString(value, name) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new CanvasError('invalid_input', `${name} は空でない文字列で指定してください。`);
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

/** The chart of an open panel, with whatever is on disk now. */
async function openedChart(ctx) {
  const chart = charts.get(ctx.instanceId);
  if (!chart?.file) throw new CanvasError('no_file', 'ガントチャートのファイルが開かれていません。先に open_chart でファイルを開いてください。');
  await chart.refresh();
  return chart;
}

function chartView(chart, extra = {}) {
  if (chart.error) throw new CanvasError(chart.error.code, `ファイルを読み込めません: ${chart.error.message}`);
  return { file: chart.file, ...describe(chart.doc, extra) };
}

const idProperty = { type: 'string', description: 'Task id, as listed by get_chart (letters, digits, "_" and "-", up to 32 characters).' };
const taskFields = {
  name: { type: 'string', description: 'Task name. For "project" and "snapshot" it is the project or version name.' },
  start: { type: 'string', description: 'Start date, YYYY-MM-DD. A weekend or holiday moves to the next working day. For a task with predecessors the start follows them, so this changes their lags; a date before the predecessors end becomes the first day they allow, and the op result reports it in "adjusted.start".' },
  end: { type: 'string', description: 'Last day, YYYY-MM-DD; sets the duration. Do not combine with duration.' },
  duration: { type: ['integer', 'string'], description: 'Working days: 3, "3d" or "2w" (a week is 5 working days). Do not combine with end.' },
  progress: { type: 'number', minimum: 0, maximum: 100, description: 'Percent complete. Not for a parent task: it is computed from its children.' },
  effort: { type: ['number', 'null'], description: 'Effort in hours; null clears it.' },
  resources: { type: 'array', items: { type: 'string' }, description: 'People or teams assigned.' },
  color: { type: 'string', enum: COLORS, description: 'Color label of the bar.' },
  note: { type: 'string', description: 'Free-text memo.' },
  collapsed: { type: 'boolean', description: 'Collapse a parent task in the list.' },
  predecessors: {
    type: 'array',
    description: 'Replaces the predecessors. The task starts after the latest of them: the next working day after its end, plus lag working days.',
    items: { type: 'object', properties: { task: idProperty, lag: { type: 'integer', minimum: 0, description: 'Working days added after the next working day of the predecessor end (0 or more; a task cannot start before its predecessors end). Default 0.' } }, required: ['task'], additionalProperties: false },
  },
};
const opSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'update', 'delete', 'move', 'indent', 'outdent', 'shift', 'slide', 'project', 'snapshot', 'restore', 'delete_snapshot'] },
    id: { ...idProperty, description: 'add: an id for the new task (optional, generated if omitted). Other ops: the task (or, for restore and delete_snapshot, the version) to act on.' },
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
  displayName: 'ガントチャート',
  description: 'An editable Gantt chart saved in a JSON file: task table with parent tasks, timeline bars, dependencies, progress, color labels, resources and saved versions, editable by the user in the page and by the agent through actions.',
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
        if (!input.path) throw new CanvasError('invalid_input', 'path は必須です。');
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
      description: 'Apply one or more edits to the chart, all or nothing, and save the file. The page updates at once. Returns one result per op (the id of an added task) and the resulting chart. Parent tasks (tasks with children) take their dates and progress from their children. Durations count working days (Saturdays, Sundays and project holidays are off).',
      inputSchema: {
        type: 'object',
        properties: {
          ops: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            description: 'Edits, applied in order. add {name, parent|after|before, start, end|duration, progress, effort, resources, color, predecessors, id}; update {id, ...fields}; delete {id} (with its children); move {id, parent|after|before}; indent/outdent {id}; shift {id, direction}; slide {ids, days} moves tasks together by working days; project {name, holidays}; snapshot {name} saves a version; restore {id}; delete_snapshot {id}.',
            items: opSchema,
          },
        },
        required: ['ops'],
        additionalProperties: false,
      },
      handler: (ctx) => guarded(async () => {
        const input = asObject(ctx.input);
        const chart = charts.get(ctx.instanceId);
        if (!chart?.file) throw new CanvasError('no_file', 'ガントチャートのファイルが開かれていません。先に open_chart でファイルを開いてください。');
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
    return chart?.close().catch((error) => log(`閉じる処理に失敗しました: ${error.message}`));
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
            lines.push(`- ${selected.file}: 行 ${task.row}「${task.name}」（task id: ${task.id}、canvas instanceId: ${instanceId}）`);
          } else {
            lines.push(`- ${selected.file}: ${selected.tasks.length} 件のタスク（canvas instanceId: ${instanceId}）`, ...selected.tasks.map((task) => `  - 行 ${task.row}「${task.name}」（task id: ${task.id}）`));
          }
        }
        if (!lines.length) return undefined;
        return { additionalContext: ['ガントチャート（canvas ' + CANVAS_ID + '）でユーザーが選択しているタスク:', ...lines, '「このタスク」などの指示は、選択中のタスクを指している可能性があります。'].join('\n') };
      } catch (error) {
        log(`選択中のタスクの確認に失敗しました: ${error.message}`);
        return undefined;
      }
    },
  },
});
log('ガントチャートを登録しました。');

process.on('unhandledRejection', (reason) => log(`未処理の拒否: ${reason?.stack ?? reason}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    Promise.allSettled([...charts.values()].map((chart) => chart.close())).finally(() => process.exit(0));
  });
}
