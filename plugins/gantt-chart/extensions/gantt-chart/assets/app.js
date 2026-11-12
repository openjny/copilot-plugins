import { LOCALES, getLocale, resolveLocale, setLocale, t } from '/i18n.mjs';
import { AGGREGATES, FIRST_DAY, PALETTE, PROPERTY_TYPES, WEEKDAYS, WEEK_STARTS, applyOps, formatDate, formatDuration, isSummary, makeCalendar, maxSlideEarlier, parseDate, parseDuration, schedule, subtreeEnd, todayDay, weekStartOnOrBefore, ymd } from '/model.mjs';

// Row height and pixels per day change with Ctrl+scroll, so they are variables; the ROW_STD / PPD values are the
// "standard" scale that the day / week / month buttons reset to.
const ROW_STD = 28;
const ROW_MIN = 22;
const ROW_MAX = 40;
let ROW_H = ROW_STD;
let BAR_H = ROW_STD - 10;
const LINK_LEG = 14;
const HEAD_H = 56;
const PPD = { day: 48, week: 18, month: 5 };
const PPD_MIN = 1.5;
const PPD_MAX = 120;
const MIN_DAYS = { day: 35, week: 140, month: 365 };
/** The unit that reads best at this scale: columns stay wide enough for their labels (the standard scales sit in the middle of each band). */
const unitFor = (ppd) => (ppd >= 30 ? 'day' : ppd >= 9.5 ? 'week' : 'month');
// The timeline never starts before the first Monday of 1970 or ends after 2200 (the range of dates the model accepts).
const MIN_START = FIRST_DAY;
const MAX_END = parseDate('2200-12-31');
const UNITS = ['day', 'week', 'month'];
const THEMES = ['auto', 'light', 'dark'];
const LOCALE_PREFS = ['auto', ...LOCALES];
const LOCALE_LABEL = { ja: '日本語', en: 'English' };
const THEME_ICON = { auto: 'monitor', light: 'sun', dark: 'moon' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  indent: 'M4 6h16M12 10h8M12 14h8M4 18h16M4 9l4 3-4 3',
  outdent: 'M4 6h16M12 10h8M12 14h8M4 18h16M8 9l-4 3 4 3',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  tighten: 'M20 12H10M14 8l-4 4 4 4M4 5v14',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  sliders: 'M4 6h10M18 6h2M16 4v4M4 12h2M10 12h10M8 10v4M4 18h9M17 18h3M15 16v4',
  history: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2',
  today: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  menu: 'M5 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M17 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  milestone: 'M12 3l9 9-9 9-9-9z',
  check: 'M5 12l5 5 9-10',
  chevron: 'M6 9l6 6 6-6',
};
// Columns of the task list. "#" and the name are always there; the others are the user's choice (kept with the view
// settings): the duration, the assignee, and any property the project defines (key "p:<name>"). Each column has a
// width the user can drag.
const COL_NO = 36;
const COL_WIDTH = { name: { min: 120, max: 600, std: 240 }, dur: { min: 44, max: 140, std: 56 }, res: { min: 56, max: 320, std: 88 } };
const PROP_COL_WIDTH = {
  number: { min: 48, max: 200, std: 84 },
  text: { min: 60, max: 400, std: 140 },
  url: { min: 60, max: 400, std: 140 },
  date: { min: 76, max: 160, std: 100 },
  select: { min: 56, max: 240, std: 100 },
  tags: { min: 56, max: 320, std: 120 },
  checkbox: { min: 36, max: 120, std: 56 },
};
const COL_KEYS = Object.keys(COL_WIDTH);
const OPTIONAL_COLS = ['dur', 'res'];
const propCol = (prop) => `p:${prop.name}`;
function readCols(text) {
  try {
    const list = JSON.parse(decodeURIComponent(text ?? ''));
    return Array.isArray(list) ? list.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}
// Room kept for the timeline when the columns are widened.
const LIST_MARGIN = 160;
// A list wider than this share of the canvas leaves too little of the chart: the first time it is shown, the name column gives way.
const LIST_SHARE = 0.45;

const app = {
  state: null,
  cal: null,
  sched: null,
  visible: [],
  range: null,
  view: null,
  viewPath: null,
  autoScrolling: false,
  selected: null,
  picked: new Set(),
  selLink: null,
  link: null,
  marquee: null,
  zoom: 'day',
  ppd: PPD.day,
  listOpen: document.documentElement.dataset.list === 'open',
  // How far the name, duration and assignee columns are open, 0 to 1: it moves while the list slides in or out.
  listF: document.documentElement.dataset.list === 'open' ? 1 : 0,
  listWant: document.documentElement.dataset.list === 'open',
  listAnim: 0,
  listFitted: false,
  // Whether the chart shows the names of the tasks next to or on their bars.
  labels: document.documentElement.dataset.labels !== 'off',
  // The optional list columns that are shown: "dur", "res" and "p:<name>" for a property (the page gets them as JSON in a URL-encoded attribute).
  cols: new Set(readCols(document.documentElement.dataset.cols)),
  detailOpen: false,
  moreOpen: false,
  editing: null,
  editText: '',
  editingTitle: false,
  titleText: '',
  drag: null,
  suggestOwner: null,
  suggestPlace: null,
  tagDraft: '',
  tagDraftField: '',
  titleRedraw: false,
  colDrag: null,
  // The header cell under the pointer (or whose menu is open), marked across the chart too.
  bandCell: null,
  menuCell: null,
  lastClick: null,
  pendingRender: false,
  saving: 'saved',
  colW: Object.fromEntries(COL_KEYS.map((key) => [key, COL_WIDTH[key].std])),
  // Height of the detail panel when the user has dragged it; null lets it fit its content.
  panelH: null,
  panelKey: '',
  startKey: null,
  theme: THEMES.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'auto',
  locale: LOCALE_PREFS.includes(document.documentElement.dataset.locale) ? document.documentElement.dataset.locale : 'auto',
};

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['start', 'editor', 'topbar', 'toolbar', 'banner', 'scroller', 'grid', 'hl', 'ht', 'bl', 'bt', 'panel', 'psplit', 'splits', 'status', 'project', 'versions', 'confirm', 'toast', 'tip', 'today', 'fit', 'empty', 'ctx', 'suggest'].map((id) => [id, $(id)]));
/** The properties the project defines, in the order they are shown. */
const properties = () => app.state?.doc?.project?.properties ?? [];
/** The property a column key ("p:<name>") stands for, if the project still has it. */
const propOfCol = (key) => (key.startsWith('p:') ? properties().find((prop) => prop.name === key.slice(2)) : undefined);
const colSpec = (key) => COL_WIDTH[key] ?? PROP_COL_WIDTH[propOfCol(key)?.type] ?? PROP_COL_WIDTH.text;
const colWidth = (key) => app.colW[key] ?? colSpec(key).std;
const colTitle = (key) => propOfCol(key)?.name ?? t(`col.${key}`);
/** The columns of the list that are shown, left to right: the name, the duration and assignee (when chosen), then the chosen properties in their order. */
function colKeys() {
  return ['name', ...OPTIONAL_COLS.filter((key) => app.cols.has(key)), ...properties().filter((prop) => app.cols.has(propCol(prop))).map(propCol)];
}
/** Width of the task list in the scroller: the row numbers are always there, the rest (the name and the chosen columns) opens with the list. */
const listW = () => COL_NO + (app.listOpen ? colKeys().reduce((sum, key) => sum + colWidth(key), 0) * app.listF : 0);

// ---- Language -----------------------------------------------------------------------------------------------------

/** The language the page shows: the choice, or (for "auto") the browser's. */
const resolvedLocale = () => (app.locale === 'auto' ? resolveLocale(navigator.language) : app.locale);
const colorName = (color) => t(`color.${color}`);

/** Puts the chosen language on the page (the static texts, the title) and tells the server, whose messages follow it. */
function applyLocale() {
  setLocale(resolvedLocale());
  document.documentElement.lang = getLocale();
  document.documentElement.dataset.locale = app.locale;
  document.title = t('app.name');
  ui.today.title = ui.today.ariaLabel = t('fab.today');
  ui.fit.title = ui.fit.ariaLabel = t('fab.fit');
  ui.bl.setAttribute('aria-label', t('list.aria'));
  ui.toolbar.setAttribute('aria-label', t('tb.aria'));
  ui.panel.setAttribute('aria-label', t('panel.aria'));
  ui.psplit.title = t('panel.resize');
  ui.psplit.setAttribute('aria-label', t('panel.resize'));
  renderEmpty();
}

/** Intl formatters for the current language, made once per language. */
const formatters = new Map();
function dateFormat(options) {
  const key = `${getLocale()}:${JSON.stringify(options)}`;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC', ...options }));
  return formatters.get(key);
}
const dayDate = (day) => new Date(day * 86400000);
/** A Sunday: `SUNDAY + i` is the weekday with the number i (0 = Sunday), for the names of the weekdays. */
const SUNDAY = parseDate('2024-01-07');
/** The day weeks start on in the timeline: the project's choice (Monday unless it says Sunday). */
const weekStartDay = () => app.state?.doc?.project?.weekStart ?? 'mon';

// ---- DOM helpers --------------------------------------------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') {
      for (const [name, css] of Object.entries(value)) {
        if (name.startsWith('--')) el.style.setProperty(name, css);
        else el.style[name] = css;
      }
    } else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

let toastTimer;
/** Shows a message for a few seconds; `action` ({ label, run }) adds a button, and the message then stays a little longer. */
function toast(message, kind = 'info', action = null) {
  ui.toast.replaceChildren(message, action ? h('button', { class: 'toast-act', type: 'button', onclick: () => { ui.toast.classList.remove('show'); action.run(); } }, action.label) : null);
  ui.toast.className = `toast show ${kind}${action ? ' act' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), action ? 9000 : 5000);
}

function confirmDialog(message, okLabel) {
  return new Promise((resolve) => {
    const dialog = ui.confirm;
    const onCancel = () => resolve(false);
    const done = (value) => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      h('div', { class: 'db' }, h('p', { id: 'confirm-text', style: { margin: '0', whiteSpace: 'pre-line' } }, message)),
      h('div', { class: 'df' }, h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, t('dlg.cancel')), h('button', { class: 'btn primary', type: 'button', onclick: () => done(true) }, okLabel)),
    );
    dialog.addEventListener('cancel', onCancel, { once: true });
    dialog.showModal();
  });
}

/**
 * Clicking the dimmed area around a modal closes it, as Esc does. The press and the release must both be outside the
 * box, so that selecting text in a field and letting go outside does not close it.
 */
function closeOnBackdrop(dialog) {
  const outside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  let pressed = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressed = outside(event);
  });
  dialog.addEventListener('click', (event) => {
    const hit = pressed && outside(event);
    pressed = false;
    if (!hit) return;
    // The same event Esc raises, so that a pending confirmation is answered with "no".
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.close();
  });
}
for (const dialog of [ui.project, ui.versions, ui.confirm]) closeOnBackdrop(dialog);

// ---- Data access ----------------------------------------------------------------------------------------------

const tasks = () => app.state?.doc?.tasks ?? [];
const taskById = (id) => tasks().find((task) => task.id === id);
const rowById = (id) => app.sched?.byId.get(id);
const selectedRow = () => (app.selected ? rowById(app.selected) : undefined);

/** The color a task is drawn in: its own, or else that of the nearest parent that has one, or else blue. */
function colorOf(row) {
  for (let r = row; r; r = r.parent >= 0 ? app.sched.rows[r.parent] : null) {
    const color = taskById(r.id).color;
    if (color !== 'inherit') return color;
  }
  return 'blue';
}

/** What the color controls show as chosen: the own color, or "inherit" for a task under a parent that has none of its own. */
function chosenColor(row) {
  const own = taskById(row.id).color;
  return own === 'inherit' && row.parent < 0 ? colorOf(row) : own;
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(t('net.offline'));
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? t('net.failed', { status: response.status }));
  return data;
}

/**
 * Sends edit operations; the server saves them and answers with the new state.
 * An error goes to onError when given (a modal dialog covers the toast), otherwise to the toast.
 * When the edit pushed other tasks later (through their dependencies) or moved the start that was asked for, the toast
 * says so, and offers to undo it.
 */
async function send(ops, onError) {
  // Connecting (or changing a lag) can push the very task that is edited, which the server does not count as "other".
  const own = ops.length === 1 && isLinkEdit(ops[0]) ? previewOps(ops, { own: true })?.shifted : null;
  return request('/api/ops', { ops }, (data) => {
    const moved = data.results.find((result) => result.adjusted?.start);
    const pushed = own ?? data.shifted ?? [];
    const parts = [];
    if (moved) parts.push(t('toast.adjustedStart', { date: moved.adjusted.start }));
    if (pushed.length) parts.push(shiftText('toast.shifted', pushed));
    if (parts.length) toast(parts.join(' '), 'info', pushed.length ? { label: t('toast.undo'), run: () => stepHistory('undo') } : null);
    if (moved) {
      app.panelKey = '';
      renderPanel();
    }
    return data.results;
  }, onError);
}

/** An update that only touches the predecessors (adding one, a lag, removing one). */
const isLinkEdit = (op) => op.op === 'update' && op.predecessors !== undefined && op.start === undefined && op.end === undefined && op.duration === undefined;

/**
 * What the operations would do, without saving them: the model's own answer (applyOps), or null when they would fail.
 * `own` also counts the edited task itself among the tasks that moved.
 */
function previewOps(ops, { own = false } = {}) {
  try {
    return applyOps(app.state.doc, ops, { includeNamed: own });
  } catch {
    return null;
  }
}

/** "'X' was pushed 3d later" / "4 tasks were pushed later (by up to 2w)": `key` names the message for one task, `${key}Many` the one for several. */
const shiftText = (key, shifted) => {
  const days = formatDuration(Math.max(...shifted.map((item) => item.days)));
  return shifted.length === 1 ? t(key, { name: shifted[0].name, days }) : t(`${key}Many`, { count: shifted.length, days });
};

/** Posts to an API route that changes the chart, shows the state it answers with, and reports a failure. */
async function request(path, body, done, onError) {
  setSaving('saving');
  try {
    const data = await post(path, body);
    applyState(data.state);
    setSaving('saved');
    return done(data);
  } catch (error) {
    setSaving('error');
    if (onError) onError(error.message);
    else toast(error.message, 'error');
    app.panelKey = '';
    renderPanel();
    if (app.sched) renderChart();
    return null;
  }
}

/** Undo or redo the last change (the server keeps the history). */
async function stepHistory(direction) {
  const wanted = app.state?.history?.[direction];
  if (!wanted || app.drag) return;
  await request(`/api/${direction}`, {}, (data) => {
    toast(t(direction === 'undo' ? 'toast.undone' : 'toast.redone', { label: historyName(data.label) }), 'info');
  });
}

/** What a history entry did, in words: "update.progress" -> "Edit progress". */
function historyName(label) {
  const key = `history.${label}`;
  return t(key) === key ? t(`history.${label.split('.')[0]}`) : t(key);
}

function setSaving(value) {
  app.saving = value;
  const el = document.getElementById('save');
  if (el) {
    el.textContent = t(`save.${value}`);
    el.className = `save ${value}`;
  }
}

function applyState(state) {
  if (app.state && state.rev < app.state.rev) return;
  const first = app.state === null;
  app.state = state;
  app.cal = null;
  app.sched = null;
  if (state.doc) {
    try {
      app.cal = makeCalendar(state.doc.project);
      app.sched = schedule(state.doc, app.cal);
    } catch (error) {
      toast(t('toast.cannotCompute', { message: error.message }), 'error');
    }
  }
  if (first && state.selection) {
    app.selected = state.selection;
    app.picked = new Set([state.selection]);
  }
  // Tasks that no longer exist drop out of the selection.
  app.picked = new Set([...app.picked].filter((id) => taskById(id)));
  if (app.selected && !taskById(app.selected)) app.selected = [...app.picked][0] ?? null;
  if (app.selected) app.picked.add(app.selected);
  if (app.selLink && !hasLink(app.selLink.from, app.selLink.to)) app.selLink = null;
  if (app.drag) {
    app.pendingRender = true;
    return;
  }
  render();
}

// ---- Rendering ------------------------------------------------------------------------------------------------

function render() {
  const state = app.state;
  ui.start.hidden = Boolean(state.file);
  ui.editor.hidden = !state.file;
  if (!state.file) return renderStart();
  if (!app.sched) return;
  app.startKey = null;
  renderTop();
  renderBanner();
  renderToolbar();
  renderChart();
  renderEmpty();
  renderPanel();
  renderStatus();
  if (ui.versions.open) renderVersions();
}

function renderStart() {
  const key = JSON.stringify(app.state.recent);
  if (app.startKey === key) return;
  app.startKey = key;
  const input = h('input', { type: 'text', id: 'open-path', placeholder: 'C:\\work\\plan.gantt.json', autocomplete: 'off', spellcheck: 'false' });
  const open = async (path) => {
    try {
      const data = await post('/api/open', { path });
      app.selected = null;
      app.picked = new Set();
      app.panelKey = '';
      applyState(data.state);
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  ui.start.replaceChildren(
    h(
      'div',
      { class: 'card' },
      h('h1', {}, t('app.name')),
      h('p', { class: 'lead' }, t('start.lead')),
      h(
        'form',
        {
          onsubmit: (event) => {
            event.preventDefault();
            if (input.value.trim()) open(input.value.trim());
          },
        },
        h('label', { for: 'open-path' }, t('start.pathLabel')),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, t('start.open'))),
      ),
      app.state.recent.length
        ? h(
            'div',
            {},
            h('h2', {}, t('start.recent')),
            h('ul', { class: 'recent' }, ...app.state.recent.map((item) => h('li', {}, h('button', { type: 'button', onclick: () => open(item.path) }, h('span', { class: 'rn' }, item.path.split(/[\\/]/).pop()), h('span', { class: 'rp' }, item.path))))),
          )
        : null,
    ),
  );
}

async function setTheme(theme) {
  if (theme === app.theme) return;
  app.theme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    await post('/api/theme', { theme });
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Switches the language and draws everything again in it. */
async function setLocalePref(locale) {
  if (locale === app.locale) return;
  app.locale = locale;
  applyLocale();
  relocalize();
  syncLocale();
}

/** Tells the server which language is chosen and which one the page resolved it to (its messages follow it). */
async function syncLocale() {
  try {
    await post('/api/locale', { locale: app.locale, resolved: resolvedLocale() });
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Draws the texts again after the language changed. */
function relocalize() {
  formatters.clear();
  buildToolbar();
  app.panelKey = '';
  app.startKey = null;
  if (app.state) render();
}

function openSettingsMenu(event) {
  const radio = (choices, current, label, run, iconOf) => choices.map((value) => ({ label: label(value), icon: iconOf?.(value), checked: value === current, run: () => run(value) }));
  showMenu(event.currentTarget, [
    { label: t('menu.versions'), icon: 'history', run: openVersions },
    { label: t('menu.export'), icon: 'download', run: () => document.getElementById('export-link')?.click() },
    { separator: true },
    { heading: t('menu.language') },
    ...radio(LOCALE_PREFS, app.locale, (value) => (value === 'auto' ? t('locale.auto') : LOCALE_LABEL[value]), setLocalePref),
    { separator: true },
    { heading: t('menu.theme') },
    ...radio(THEMES, app.theme, (value) => t(`theme.${value}`), setTheme, (value) => THEME_ICON[value]),
  ]);
}

/** Renames the project from the title in the top bar: double-click to edit, Enter or leaving the field to save, Esc to cancel. */
function startTitleEdit() {
  app.editingTitle = true;
  app.titleText = app.state.doc.project.name;
  renderTop();
  const input = ui.topbar.querySelector('.title-input');
  input?.focus();
  input?.select();
}

function finishTitleEdit(commit) {
  if (!app.editingTitle) return;
  const text = app.titleText.trim();
  app.editingTitle = false;
  renderTop();
  if (commit && text !== app.state.doc.project.name) send([{ op: 'project', name: text }]);
}

function renderTop() {
  const { file, doc } = app.state;
  // The title is a text field while it is being edited; a redraw in the middle (a change from outside) keeps what was typed.
  const typing = ui.topbar.querySelector('.title-input');
  const caret = typing && document.activeElement === typing ? [typing.selectionStart, typing.selectionEnd] : null;
  const shown = doc.project.name || file.name;
  const title = app.editingTitle
    ? h('input', {
        class: 'title-input',
        type: 'text',
        value: app.titleText,
        maxlength: '200',
        placeholder: file.name,
        'aria-label': t('project.name'),
        oninput: (event) => {
          app.titleText = event.target.value;
        },
        onkeydown: (event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') finishTitleEdit(true);
          else if (event.key === 'Escape') finishTitleEdit(false);
        },
        onblur: () => {
          if (!app.titleRedraw) finishTitleEdit(true);
        },
      })
    : h('span', { class: 'title', title: t('top.rename', { name: shown }), ondblclick: startTitleEdit }, shown);
  // Taking the old field out of the page blurs it; that must not count as leaving it.
  app.titleRedraw = true;
  ui.topbar.replaceChildren(
    h(
      'button',
      {
        class: 'btn flat tbtn',
        type: 'button',
        'aria-label': t('top.back'),
        title: t('top.back'),
        onclick: async () => {
          try {
            applyState((await post('/api/open', { path: null })).state);
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      },
      '←',
      h('span', { class: 'label' }, t('top.backLabel')),
    ),
    h(
      'div',
      { class: 'ttl' },
      h('div', { class: 'tname' }, title, h('button', { id: 'project-settings', class: 'btn flat square', type: 'button', title: t('project.title'), 'aria-label': t('project.title'), onclick: openProject }, icon('sliders'))),
      h('span', { class: 'file', title: file.path }, file.name),
    ),
    h('span', { class: 'spacer' }),
    h('span', { id: 'save', class: 'save', 'aria-live': 'polite' }),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': t('unit.group') },
      ...UNITS.map((zoom) =>
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            title: t('unit.title', { label: t(`unit.${zoom}`) }),
            'aria-pressed': String(app.zoom === zoom),
            onclick: () => setScale(PPD[zoom], ROW_STD),
          },
          t(`unit.${zoom}`),
        ),
      ),
    ),
    h('button', { class: 'btn square', type: 'button', title: t('menu.title'), 'aria-label': t('menu.title'), 'aria-haspopup': 'menu', onclick: openSettingsMenu }, icon('menu')),
    h('a', { id: 'export-link', hidden: true, href: '/api/export', download: file.name }),
  );
  app.titleRedraw = false;
  if (app.editingTitle) {
    const input = ui.topbar.querySelector('.title-input');
    input?.focus();
    if (caret) input?.setSelectionRange(caret[0], caret[1]);
  }
  setSaving(app.saving);
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/**
 * Sets the scale (pixels per day, row height) and picks the day / week / month unit that suits it. The date and the
 * row under `anchor` (a point on the screen; the center of the view when omitted) stay where they are.
 */
function setScale(ppd, rowHeight, anchor = null) {
  const nextPpd = clamp(ppd, PPD_MIN, PPD_MAX);
  const nextRow = Math.round(clamp(rowHeight, ROW_MIN, ROW_MAX));
  if (nextPpd === app.ppd && nextRow === ROW_H) return;
  const sc = ui.scroller;
  const rect = sc.getBoundingClientRect();
  const px = anchor ? clamp(anchor.x - rect.left, listW(), sc.clientWidth) : listW() + (sc.clientWidth - listW()) / 2;
  const py = anchor ? clamp(anchor.y - rect.top, HEAD_H, sc.clientHeight) : HEAD_H + (sc.clientHeight - HEAD_H) / 2;
  const old = app.range;
  const day = old ? old.start + (sc.scrollLeft + px - listW()) / old.ppd : null;
  const rowAt = (sc.scrollTop + py - HEAD_H) / ROW_H;
  const unit = unitFor(nextPpd);
  const unitChanged = unit !== app.zoom;
  app.ppd = nextPpd;
  app.zoom = unit;
  ROW_H = nextRow;
  BAR_H = nextRow - 10;
  // Start the new range around the anchor date (the tasks and today are added to it), then put that date back under the pointer.
  if (day !== null) {
    const margin = marginDays(nextPpd);
    app.view = { start: Math.floor(day) - margin, end: Math.ceil(day) + margin };
  }
  if (unitChanged) renderTop();
  renderChart();
  if (day !== null) sc.scrollLeft = Math.max(0, (day - app.range.start) * app.range.ppd + listW() - px);
  sc.scrollTop = Math.max(0, rowAt * ROW_H + HEAD_H - py);
}

const zoomBy = (factor, anchor) => setScale(app.ppd * factor, ROW_H * factor, anchor);

// Ctrl+scroll (and a trackpad pinch, which arrives as Ctrl+scroll) zooms both axes at once. Events are folded into one
// update per frame, and the browser's own page zoom is held back.
let wheelZoom = null;
document.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey || ui.editor.hidden || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    // A mouse wheel moves in steps of about 100; a pinch sends many small values.
    const factor = Math.exp(-delta * (Math.abs(delta) < 50 ? 0.01 : 0.002));
    const rect = ui.scroller.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const anchor = inside ? { x: event.clientX, y: event.clientY } : null;
    if (wheelZoom) {
      wheelZoom.factor *= factor;
      wheelZoom.anchor = anchor;
      return;
    }
    wheelZoom = { factor, anchor };
    requestAnimationFrame(() => {
      const { factor: total, anchor: at } = wheelZoom;
      wheelZoom = null;
      zoomBy(total, at);
    });
  },
  { passive: false },
);

function renderBanner() {
  const error = app.state.error;
  ui.banner.hidden = !error;
  ui.banner.textContent = error ? t('banner.fileError', { message: error.message }) : '';
}

function buildToolbar() {
  const button = (id, name, label, onclick) => h('button', { id, class: 'btn square', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
  const colorButton = h('button', { id: 'tb-color', class: 'btn colorbtn', type: 'button', 'aria-haspopup': 'menu', onclick: (event) => openColorMenu(event.currentTarget) }, h('i', { class: 'dot c-blue' }), icon('chevron'));
  ui.toolbar.replaceChildren(
    h(
      'button',
      {
        id: 'tb-list',
        class: 'btn square',
        type: 'button',
        title: t('tb.list'),
        'aria-label': t('tb.list'),
        onclick: toggleList,
      },
      icon('sidebar'),
    ),
    button('tb-labels', 'text', t('tb.labels'), toggleLabels),
    h('span', { class: 'sep' }),
    button('tb-undo', 'undo', t('tb.undo'), () => stepHistory('undo')),
    button('tb-redo', 'redo', t('tb.redo'), () => stepHistory('redo')),
    h('span', { class: 'sep' }),
    button('tb-add', 'plus', t('tb.add'), onAdd),
    button('tb-del', 'trash', t('tb.delete'), onDelete),
    h('span', { class: 'sep' }),
    button('tb-indent', 'indent', t('tb.indent'), () => app.selected && indentTask(app.selected)),
    button('tb-outdent', 'outdent', t('tb.outdent'), () => operate('outdent')),
    button('tb-up', 'up', t('tb.up'), () => operate('shift', { direction: 'up' })),
    button('tb-down', 'down', t('tb.down'), () => operate('shift', { direction: 'down' })),
    h('span', { class: 'sep' }),
    colorButton,
  );
}

/** The menu of color labels for the selected tasks, each with its swatch. */
function openColorMenu(anchor) {
  const ids = [...app.picked];
  if (!ids.length) return;
  const chosen = chosenColor(rowById(app.selected ?? ids[0]));
  const inherit = inheritItem(ids, chosen);
  showMenu(anchor, [
    ...PALETTE.map((color) => ({ label: colorName(color), swatch: color, checked: color === chosen, run: () => setColor(ids, color) })),
    ...(inherit ? [{ separator: true }, inherit] : []),
  ]);
}

/** The "Same as parent" entry of a color menu, offered when a selected task has a parent to take the color from. */
const inheritItem = (ids, chosen) =>
  ids.some((id) => rowById(id)?.parent >= 0) ? { label: colorName('inherit'), checked: chosen === 'inherit', run: () => setColor(ids, 'inherit') } : null;

const setColor = (ids, color) => send(ids.map((id) => ({ op: 'update', id, color })));

/** Sets the width of a list column, within its limits and so that the timeline keeps some room. */
function setColWidth(key, width) {
  const others = listW() - colWidth(key);
  const room = Math.max(others + colSpec(key).min, ui.scroller.clientWidth - LIST_MARGIN);
  const spec = colSpec(key);
  app.colW[key] = Math.round(clamp(width, spec.min, Math.min(spec.max, room - others)));
}

/** Puts the column widths into the grid (the list is one sticky column of the grid; its rows share the same columns). */
function applyCols() {
  ui.grid.style.setProperty('--leftW', `${listW()}px`);
  ui.grid.style.setProperty('--cols', app.listOpen ? `${COL_NO}px ${colKeys().map((key) => `${colWidth(key) * app.listF}px`).join(' ')}` : `${COL_NO}px`);
}

/** The drag handle of a column (looked up by its key, which can hold any character). */
const splitEl = (key) => [...ui.splits.children].find((el) => el.dataset.key === key);

/** Moves the drag handles to the right edge of their columns. */
function placeSplits() {
  let x = COL_NO;
  for (const key of colKeys()) {
    x += colWidth(key);
    const el = splitEl(key);
    if (el) el.style.left = `${x - 4}px`;
  }
}

/**
 * The draggable lines at the right edge of each list column, as tall as the chart. Dragging one sets the width of the
 * column on its left (the list grows or shrinks with it); a double-click puts it back to its standard width.
 */
function renderSplits() {
  // No handles while the list is folded or still sliding.
  const shown = app.listOpen && app.listF === 1;
  ui.splits.hidden = !shown;
  if (!shown) return ui.splits.replaceChildren();
  ui.splits.style.setProperty('--sb-h', `${ui.scroller.offsetHeight - ui.scroller.clientHeight}px`);
  // A state update during a drag must not replace the handle that holds the pointer.
  if (app.colDrag) return placeSplits();
  ui.splits.replaceChildren(
    ...colKeys().map((key) => {
      const label = t('col.resize', { name: colTitle(key) });
      const el = h('div', { class: 'split', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'data-key': key, title: label, 'aria-label': label });
      el.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        el.setPointerCapture(event.pointerId);
        app.colDrag = { key, x0: event.clientX, w0: colWidth(key), moved: false };
        el.classList.add('dragging');
      });
      el.addEventListener('pointermove', (event) => {
        const drag = app.colDrag;
        if (!drag) return;
        if (Math.abs(event.clientX - drag.x0) > 3) drag.moved = true;
        setColWidth(drag.key, drag.w0 + event.clientX - drag.x0);
        applyCols();
        placeSplits();
      });
      // A double-click (counted by isDoubleClick, as the press is handled here) puts the column back to its standard width.
      const release = (event) => {
        const drag = app.colDrag;
        if (!drag) return;
        app.colDrag = null;
        if (event.type === 'pointerup' && !drag.moved && isDoubleClick(event, `split:${key}`)) setColWidth(key, colSpec(key).std);
        renderChart();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setColWidth(key, colWidth(key) + (event.key === 'ArrowRight' ? 16 : -16));
        renderChart();
        splitEl(key)?.focus();
      });
      return el;
    }),
  );
  placeSplits();
}

/** Narrows the name column (down to its minimum) so that a list opened in a small canvas does not take most of it. */
function fitList() {
  if (app.listFitted || ui.scroller.clientWidth === 0) return;
  app.listFitted = true;
  const over = COL_NO + colKeys().reduce((sum, key) => sum + colWidth(key), 0) - ui.scroller.clientWidth * LIST_SHARE;
  if (over > 0) app.colW.name = Math.max(COL_WIDTH.name.min, app.colW.name - Math.ceil(over));
}

const LIST_SLIDE_MS = 180;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rememberView = (change) => post('/api/view', change).catch(() => {});

/**
 * Opens or folds the list. The columns slide in or out (the timeline moves with them and keeps its own scroll position,
 * so what was in view stays in view), instead of the chart jumping.
 */
function setList(open) {
  if (open === app.listWant) return;
  app.listWant = open;
  cancelAnimationFrame(app.listAnim);
  app.listAnim = 0;
  if (!open) app.editing = null;
  rememberView({ list: open });
  const from = app.listF;
  const to = open ? 1 : 0;
  // The cells must exist while they slide, so the list is "open" for the whole move.
  app.listOpen = true;
  const done = () => {
    app.listAnim = 0;
    app.listF = to;
    app.listOpen = open;
    renderChart();
    renderToolbar();
  };
  if (reducedMotion() || from === to) return done();
  const t0 = performance.now();
  app.listF = from;
  renderToolbar();
  renderChart();
  const step = (now) => {
    const p = Math.min(1, Math.max(0, now - t0) / LIST_SLIDE_MS);
    app.listF = from + (to - from) * (1 - (1 - p) ** 3);
    if (p === 1) return done();
    applyCols();
    app.listAnim = requestAnimationFrame(step);
  };
  app.listAnim = requestAnimationFrame(step);
}

const toggleList = () => setList(!app.listWant);

function toggleLabels() {
  app.labels = !app.labels;
  rememberView({ labels: app.labels });
  renderToolbar();
  renderBody();
}

function siblingExists(list, i, direction) {
  const level = list[i].level;
  if (direction === 'up') {
    let j = i - 1;
    while (j >= 0 && list[j].level > level) j--;
    return j >= 0 && list[j].level === level;
  }
  const end = subtreeEnd(list, i);
  return end < list.length && list[end].level === level;
}

/** Which of indent / outdent / move up / move down apply to the task at index i. */
function moveState(list, i) {
  return {
    indent: i > 0 && list[i - 1].level >= list[i].level,
    outdent: list[i].level > 0,
    up: siblingExists(list, i, 'up'),
    down: siblingExists(list, i, 'down'),
  };
}

function renderToolbar() {
  const list = tasks();
  // The operations act on one task; with several selected they wait until the selection is back to one.
  const row = app.picked.size > 1 ? undefined : selectedRow();
  const can = row ? moveState(list, row.index) : { indent: false, outdent: false, up: false, down: false };
  const set = (id, disabled) => {
    $(id).disabled = disabled;
  };
  const label = (id, text) => {
    $(id).title = text;
    $(id).setAttribute('aria-label', text);
  };
  const history = app.state.history ?? {};
  set('tb-undo', !history.undo);
  set('tb-redo', !history.redo);
  label('tb-undo', history.undo ? t('tb.undoWith', { label: historyName(history.undo) }) : t('tb.undo'));
  label('tb-redo', history.redo ? t('tb.redoWith', { label: historyName(history.redo) }) : t('tb.redo'));
  set('tb-add', false);
  set('tb-del', app.picked.size === 0 && !app.selLink);
  set('tb-indent', !can.indent);
  set('tb-outdent', !can.outdent);
  set('tb-up', !can.up);
  set('tb-down', !can.down);
  const color = $('tb-color');
  const shown = selectedRow() ? colorOf(selectedRow()) : 'blue';
  color.disabled = app.picked.size === 0;
  color.firstChild.className = `dot c-${shown}`;
  color.title = t('tb.colorWith', { name: colorName(shown) });
  color.setAttribute('aria-label', color.title);
  $('tb-list').setAttribute('aria-pressed', String(app.listWant));
  $('tb-labels').setAttribute('aria-pressed', String(app.labels));
}

async function onAdd() {
  const row = selectedRow();
  const results = await send([row ? { op: 'add', after: row.id } : { op: 'add' }]);
  focusNewTask(results?.[0]?.id);
}

/** Selects a task that was just added so its name can be typed. */
function focusNewTask(id) {
  if (!id) return;
  select(id);
  if (app.listOpen) return startEdit(id);
  // Without the name column the name is typed in the detail panel.
  showDetail(id);
  const input = ui.panel.querySelector('[data-field="name"]');
  input?.focus();
  input?.select();
}

/**
 * Adds a task above or below a row, from the + buttons in the row number column. Below an expanded parent the task
 * becomes its first child (that is where the new line appears on screen); otherwise it takes the level of the row.
 */
async function insertTask(where, id) {
  const list = tasks();
  const i = list.findIndex((task) => task.id === id);
  if (i < 0) return;
  let op = { op: 'add', before: id };
  if (where === 'after') op = rowById(id).summary && !list[i].collapsed ? { op: 'add', before: list[i + 1].id } : { op: 'add', after: id };
  const results = await send([op]);
  focusNewTask(results?.[0]?.id);
}

/** Deletes tasks together with their children; asks first when more than the one task that was pointed at goes. */
async function deleteTasks(ids) {
  const list = tasks();
  const indexes = ids.map((id) => list.findIndex((task) => task.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
  // A task inside another selected task goes with it.
  const top = [];
  let until = -1;
  for (const i of indexes) {
    if (i < until) continue;
    top.push(i);
    until = subtreeEnd(list, i);
  }
  if (!top.length) return;
  const total = top.reduce((sum, i) => sum + subtreeEnd(list, i) - i, 0);
  if (total > 1) {
    const message = top.length === 1 ? t('del.confirmTree', { name: list[top[0]].name }) : total > top.length ? t('del.confirmManyTrees', { count: top.length, total }) : t('del.confirmMany', { count: top.length });
    if (!(await confirmDialog(message, t('del.ok')))) return;
  }
  await send(top.map((i) => ({ op: 'delete', id: list[i].id })));
}

async function onDelete() {
  if (app.selLink) return deleteLink();
  await deleteTasks([...app.picked]);
}

async function operate(op, extra = {}) {
  const row = selectedRow();
  if (row) await send([{ op, id: row.id, ...extra }]);
}

/** Copies the tasks (each with its children) right after themselves and selects the copies. */
async function duplicateTasks(ids) {
  const list = tasks();
  const indexes = ids.map((id) => list.findIndex((task) => task.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
  const top = [];
  let until = -1;
  for (const i of indexes) {
    if (i < until) continue;
    top.push(list[i].id);
    until = subtreeEnd(list, i);
  }
  if (!top.length) return;
  const results = await send(top.map((id) => ({ op: 'duplicate', id })));
  if (results) pick(results.map((result) => result.copy), results[0].copy);
}

/**
 * Asks before a task that has predecessors (or is a milestone) becomes a parent: a parent takes its dates from its
 * children, so it loses both. Resolves to whether to go on.
 */
async function confirmParent(id) {
  const task = taskById(id);
  if (!task || rowById(id)?.summary) return true;
  const losses = [];
  if (task.predecessors.length) losses.push(t('parent.losesPreds', { count: task.predecessors.length }));
  if (task.milestone) losses.push(t('parent.losesMilestone'));
  if (!losses.length) return true;
  return confirmDialog([t('parent.lead', { name: task.name }), ...losses, t('parent.follows'), t('parent.ask')].join('\n'), t('parent.ok'));
}

/** Indents a task. When the task above it is at the same level, that one becomes its parent. */
async function indentTask(id) {
  const list = tasks();
  const i = list.findIndex((task) => task.id === id);
  if (i > 0 && list[i - 1].level === list[i].level && !(await confirmParent(list[i - 1].id))) return;
  await send([{ op: 'indent', id }]);
}

/** Adds a task as the last child of a task (opening it when it is folded). */
async function addChild(id) {
  if (!(await confirmParent(id))) return;
  const ops = [];
  if (taskById(id)?.collapsed) ops.push({ op: 'update', id, collapsed: false });
  ops.push({ op: 'add', parent: id });
  const results = await send(ops);
  focusNewTask(results?.at(-1)?.id);
}

// ---- Menus (the right-click menu and the buttons that open a list) -------------------------------------------------

function hideMenu() {
  ui.ctx.hidden = true;
  if (app.menuCell) {
    app.menuCell.classList.remove('target');
    app.menuCell = null;
    markCell(null);
  }
}

/**
 * Shows a menu at the pointer (`at` is a mouse event) or under a button (`at` is the element). An item is one of
 * { label, run, icon?, swatch?, checked?, danger?, disabled?, hint? }, { separator: true }, { heading }, or
 * { swatches: colors, current, run(color) } for a row of color dots. It closes on a click, Esc, scrolling or leaving the window.
 */
function showMenu(at, items) {
  const pointer = typeof at.clientX === 'number';
  if (pointer) at.preventDefault();
  const choose = (run, ...args) => () => {
    hideMenu();
    run(...args);
  };
  const entry = (item) => {
    if (item.separator) return h('div', { class: 'ctx-sep', role: 'separator' });
    if (item.heading) return h('div', { class: 'ctx-head' }, item.heading);
    if (item.swatches) {
      return h(
        'div',
        { class: 'ctx-swatches', role: 'group' },
        ...item.swatches.map((color) => h('button', { class: `sw c-${color}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(color === item.current), title: colorName(color), 'aria-label': colorName(color), onclick: choose(item.run, color) }, h('i', { class: `dot c-${color}` }))),
      );
    }
    const lead = item.swatch ? h('i', { class: `dot c-${item.swatch}` }) : item.checked ? icon('check') : item.icon ? icon(item.icon) : h('span', { class: 'ctx-gap' });
    return h(
      'button',
      { class: `ctx-item${item.danger ? ' danger' : ''}${item.checked ? ' on' : ''}`, type: 'button', role: item.checked !== undefined ? 'menuitemradio' : 'menuitem', 'aria-checked': item.checked === undefined ? null : String(item.checked), disabled: item.disabled, onclick: choose(item.run) },
      lead,
      h('span', { class: 'ctx-label' }, item.label),
      item.hint ? h('span', { class: 'ctx-hint' }, item.hint) : null,
    );
  };
  ui.ctx.replaceChildren(...items.map(entry));
  ui.ctx.hidden = false;
  const rect = pointer ? null : at.getBoundingClientRect();
  const x = pointer ? at.clientX : rect.left;
  const y = pointer ? at.clientY : rect.bottom + 4;
  ui.ctx.style.left = `${Math.max(4, Math.min(x, window.innerWidth - ui.ctx.offsetWidth - 4))}px`;
  ui.ctx.style.top = `${Math.max(4, Math.min(y, window.innerHeight - ui.ctx.offsetHeight - 4))}px`;
  ui.ctx.querySelector('button:not(:disabled)')?.focus();
}

/** Ids of the tasks that wait for these tasks, directly or through others: what moves along when they are pushed later. */
function followersOf(ids) {
  const list = tasks();
  const found = new Set();
  const stack = [...ids];
  while (stack.length) {
    const current = stack.pop();
    for (const task of list) {
      if (found.has(task.id) || ids.includes(task.id) || !task.predecessors.some((pred) => pred.task === current)) continue;
      found.add(task.id);
      stack.push(task.id);
    }
  }
  return [...found];
}

/** Puts the tasks on the first day their predecessors allow, and says how many moved. */
async function tightenTasks(ids) {
  const results = await send([{ op: 'tighten', ids }]);
  const count = results?.[0]?.count;
  if (count === undefined) return;
  toast(count ? t('toast.tightened', { count }) : t('toast.tightenedNone'), 'info', count ? { label: t('toast.undo'), run: () => stepHistory('undo') } : null);
}

/** Folds a parent task (hides its children) or unfolds it. */
const toggleFold = (id) => send([{ op: 'update', id, collapsed: !taskById(id).collapsed }]);

/** The menu for a task: the right-clicked task is selected first, unless it is already part of the selection. */
function taskMenu(event, id) {
  if (!app.picked.has(id)) select(id);
  const ids = [...app.picked];
  const several = ids.length > 1;
  const list = tasks();
  const i = list.findIndex((task) => task.id === id);
  const row = rowById(id);
  const can = moveState(list, i);
  const items = [];
  if (!several) {
    items.push(
      { label: t('ctx.insertAbove'), icon: 'plus', run: () => insertTask('before', id) },
      { label: t('ctx.insertBelow'), icon: 'plus', run: () => insertTask('after', id) },
      { label: t('ctx.addChild'), icon: 'indent', run: () => addChild(id) },
    );
    if (row.summary) items.push({ label: list[i].collapsed ? t('ctx.unfold') : t('ctx.fold'), icon: 'chevron', hint: t('ctx.dblclick'), run: () => toggleFold(id) });
  }
  items.push({ label: several ? t('ctx.duplicateMany', { count: ids.length }) : t('ctx.duplicate'), icon: 'copy', hint: 'Ctrl+D', run: () => duplicateTasks(ids) });
  if (!several) {
    items.push(
      { separator: true },
      { label: t('tb.indentShort'), icon: 'indent', disabled: !can.indent, run: () => indentTask(id) },
      { label: t('tb.outdent'), icon: 'outdent', disabled: !can.outdent, run: () => send([{ op: 'outdent', id }]) },
      { label: t('tb.up'), icon: 'up', hint: 'Alt+↑', disabled: !can.up, run: () => send([{ op: 'shift', id, direction: 'up' }]) },
      { label: t('tb.down'), icon: 'down', hint: 'Alt+↓', disabled: !can.down, run: () => send([{ op: 'shift', id, direction: 'down' }]) },
      { separator: true },
      { label: row.milestone ? t('ctx.makeTask') : t('ctx.makeMilestone'), icon: 'milestone', disabled: row.summary, run: () => send([{ op: 'update', id, milestone: !row.milestone }]) },
    );
  }
  const following = several ? [] : followersOf([id, ...leavesOf([id])]);
  const dependency = [];
  if (following.length) dependency.push({ label: t('ctx.selectFollowing'), icon: 'down', run: () => pick([id, ...following], id) });
  if (leavesOf(ids).some((leaf) => taskById(leaf).predecessors.length)) {
    const slack = previewOps([{ op: 'tighten', ids }])?.results[0].count ?? 0;
    dependency.push({ label: several ? t('ctx.tightenMany', { count: ids.length }) : t('ctx.tighten'), icon: 'tighten', disabled: !slack, run: () => tightenTasks(ids) });
  }
  if (dependency.length) items.push({ separator: true }, ...dependency);
  const chosen = chosenColor(row);
  const inherit = inheritItem(ids, chosen);
  // A task with something before it and something after it can be deleted without cutting the chain.
  const bridges = !several && !row.summary && list[i].predecessors.length > 0 && list.some((task) => task.predecessors.some((pred) => pred.task === id));
  items.push(
    { separator: true },
    { heading: t('tb.color') },
    { swatches: PALETTE, current: chosen, run: (color) => setColor(ids, color) },
    ...(inherit ? [inherit] : []),
    { separator: true },
    ...(bridges ? [{ label: t('ctx.deleteReconnect'), icon: 'trash', run: () => send([{ op: 'delete', id, reconnect: true }]) }] : []),
    { label: several ? t('ctx.deleteMany', { count: ids.length }) : t('ctx.deleteOne'), icon: 'trash', hint: 'Del', danger: true, run: () => deleteTasks(ids) },
  );
  showMenu(event, items);
}

/** The task whose row is under a pointer event in the chart body. */
const rowUnder = (event) => app.visible[Math.floor((event.clientY - ui.bt.getBoundingClientRect().top) / ROW_H)];

// Anywhere on the row of a task counts, not only its bar; the menu of an arrow (which shows its own) is left alone.
ui.bt.addEventListener('contextmenu', (event) => {
  if (event.defaultPrevented) return;
  const id = event.target.closest('.bar, .sbar')?.dataset.id ?? rowUnder(event)?.id;
  if (id) taskMenu(event, id);
});
// Double-clicking the bar of a parent task folds or unfolds it: see isDoubleClick and endDrag.
ui.bl.addEventListener('contextmenu', (event) => {
  // While a name is being typed the browser's own menu (copy, paste) is more useful.
  if (isTyping(event.target)) return;
  const el = event.target.closest('.lrow');
  if (el) taskMenu(event, el.dataset.id);
});
// Right-clicking a day in the timeline header switches it between a working day and a day off.
ui.ht.addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('.hc[data-day]');
  if (cell) dayMenu(event, Number(cell.dataset.day), cell);
});

/** The menu of a day in the timeline header. The cell stays marked while the menu is open, so it is clear which day it is about. */
function dayMenu(event, day, cell) {
  const date = formatDate(day);
  showMenu(event, [{ label: t(app.cal.isWorkday(day) ? 'ctx.dayOff' : 'ctx.dayWork', { date }), icon: 'calendar', run: () => toggleWorkday(day) }]);
  app.menuCell = cell;
  cell.classList.add('target');
  markCell(cell);
}

// ---- The date header: hovering marks the days a cell stands for, clicking zooms to them --------------------------

/** The marked span across the chart body (see renderBody, which puts it back after a redraw). */
const hband = h('div', { class: 'hband', hidden: true });

/** Marks a header cell, and the days it stands for across the chart; null clears the mark. */
function markCell(cell) {
  if (app.bandCell === cell) return;
  app.bandCell = cell;
  hband.hidden = !cell || !app.range;
  if (hband.hidden) return;
  const from = Number(cell.dataset.from);
  hband.style.left = `${(from - app.range.start) * app.range.ppd}px`;
  hband.style.width = `${(Number(cell.dataset.to) - from + 1) * app.range.ppd}px`;
}

ui.ht.addEventListener('pointermove', (event) => {
  if (!app.menuCell) markCell(event.target.closest?.('.hc[data-from]') ?? null);
});
ui.ht.addEventListener('pointerleave', () => {
  if (!app.menuCell) markCell(null);
});
// A cell that covers more than a day (a year, a month, a week) zooms the chart to fill the width with it.
ui.ht.addEventListener('click', (event) => {
  const cell = event.target.closest?.('.hc.fit');
  if (cell) fitDays(Number(cell.dataset.from), Number(cell.dataset.to));
});

/**
 * Switches a day between working and off. A day is as the week says (see the weekly days off) unless the project lists
 * it: in the holidays when it would be worked, in the extra workdays when it would be off.
 */
function toggleWorkday(day) {
  const { holidays, extraWorkdays } = app.state.doc.project;
  const date = formatDate(day);
  const nextHolidays = holidays.filter((item) => item !== date);
  const nextExtra = extraWorkdays.filter((item) => item !== date);
  const toWork = !app.cal.isWorkday(day);
  if (toWork && !app.cal.isRegular(day)) nextExtra.push(date);
  else if (!toWork && app.cal.isRegular(day)) nextHolidays.push(date);
  return send([{ op: 'project', holidays: nextHolidays.sort(), extraWorkdays: nextExtra.sort() }]);
}
document.addEventListener(
  'pointerdown',
  (event) => {
    if (!ui.ctx.hidden && !ui.ctx.contains(event.target)) hideMenu();
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (ui.ctx.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key === 'Escape' || event.key === 'Tab') hideMenu();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const buttons = [...ui.ctx.querySelectorAll('button:not(:disabled)')];
      const at = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  },
  true,
);
window.addEventListener('blur', hideMenu);
ui.scroller.addEventListener('scroll', hideMenu, { passive: true });

// Timeline geometry

/** Days of room kept on each side of the tasks (at least a screen), so that the chart scrolls past the first and last task and bars can be dragged there. */
function marginDays(ppd) {
  const viewport = Math.ceil((ui.scroller.clientWidth - listW()) / ppd);
  return Math.ceil(Math.max(viewport, 28) / 7) * 7;
}

/**
 * The range only grows (app.view remembers it), so the date a screen position stands for does not change
 * while tasks are moved. It is reset when the file or the zoom changes.
 */
function computeRange(rows) {
  const ppd = app.ppd;
  const today = todayDay();
  const margin = marginDays(ppd);
  // Today is always inside the range, so the chart can open on it and "today" has somewhere to go back to.
  const first = Math.min(today, ...rows.map((row) => row.startDay));
  const last = Math.max(today, ...rows.map((row) => row.endDay));
  const view = app.view ?? { start: Infinity, end: -Infinity };
  const start = Math.max(MIN_START, weekStartOnOrBefore(Math.min(view.start, first - margin), weekStartDay()));
  const end = Math.min(MAX_END, Math.max(view.end, last + margin, start + MIN_DAYS[app.zoom] - 1));
  const days = Math.ceil((end - start + 1) / 7) * 7;
  app.view = { start, end: start + days - 1 };
  return { start, days, end: start + days - 1, ppd, width: days * ppd, today };
}

/** Scrolls sideways to today, a quarter of the way in from the left edge of the timeline. */
function scrollToToday() {
  const { start, ppd, today } = app.range;
  const viewport = ui.scroller.clientWidth - listW();
  ui.scroller.scrollLeft = Math.max(0, (today - start) * ppd - viewport / 4);
}

/** Zooms so that the days from..to fill the width of the view (as far as the scale allows), keeping the row height, and scrolls them to the middle. */
function fitDays(from, to) {
  const view = ui.scroller.clientWidth - listW();
  const days = to - from + 1;
  setScale(view / days, ROW_H);
  const { start, ppd } = app.range;
  ui.scroller.scrollLeft = Math.max(0, (from - start) * ppd - (view - days * ppd) / 2);
}

/** Zooms so that the whole project fits the width of the view, and scrolls to its start. */
function fitAll() {
  const project = app.sched?.project;
  if (!project || project.startDay === null) return;
  const view = ui.scroller.clientWidth - listW();
  const days = project.endDay - project.startDay + 1;
  setScale(clamp((view - 48) / days, PPD_MIN, PPD_MAX), ROW_STD);
  const { start, ppd } = app.range;
  ui.scroller.scrollLeft = Math.max(0, (project.startDay - start) * ppd - 24);
}

/** A hint with a button in the middle of the chart while there are no tasks. */
function renderEmpty() {
  const empty = Boolean(app.state?.file && app.state.doc && app.state.doc.tasks.length === 0);
  ui.empty.hidden = !empty;
  if (!empty) return;
  ui.empty.replaceChildren(h('p', { class: 'empty-title' }, t('empty.title')), h('p', { class: 'empty-hint' }, t('empty.hint')), h('button', { class: 'btn primary', type: 'button', onclick: onAdd }, icon('plus'), t('empty.add')));
}

/**
 * Scrolls sideways so that a task is in view with room around it. A task off to the left is brought in with its end
 * date in view and room after it (what comes next); one off to the right with its start date in view and room before it.
 * The whole task is shown when it fits. A task already in view, or one that spans the whole view, does not move the chart.
 */
function revealTask(id) {
  const row = rowById(id);
  const range = app.range;
  if (!row || row.hidden || !range) return;
  const sc = ui.scroller;
  const view = sc.clientWidth - listW();
  const a = (row.startDay - range.start) * range.ppd;
  const b = (row.endDay + 1 - range.start) * range.ppd;
  const width = b - a;
  const edge = 8;
  const room = clamp(view * 0.15, 48, 200);
  const left = sc.scrollLeft;
  const cutLeft = a < left + edge;
  const cutRight = b > left + view - edge;
  if (cutLeft === cutRight) return;
  const next = cutLeft ? b - Math.min(view - room, Math.max(width + edge, room)) : a - Math.max(room, Math.min(view - edge - width, view - room));
  sc.scrollLeft = clamp(next, 0, sc.scrollWidth - sc.clientWidth);
}

const monthStart = (y, m) => parseDate(`${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`);
/** The whole month that a segment of the range belongs to (the range may cut a month off at its ends). */
const monthSpan = (seg) => [monthStart(seg.y, seg.m), monthStart(seg.y, seg.m + 1) - 1];

function monthSegments(start, end) {
  const segments = [];
  for (let day = start; day <= end; ) {
    const { y, m } = ymd(day);
    const to = Math.min(monthStart(y, m + 1) - 1, end);
    segments.push({ from: day, to, y, m });
    day = to + 1;
  }
  return segments;
}

/** Sizes of a parent task's bar (thickness), how far the triangle on each end sticks out above and below it, its width, and the label; for the current row height. */
function summarySize() {
  const bar = Math.max(6, Math.round(ROW_H * 0.28));
  const over = Math.max(2, Math.round(bar * 0.3));
  const height = bar + 2 * over;
  return { bar, over, height, wide: Math.round(height * 0.7), label: clamp(Math.round(BAR_H * 0.6), 10, 14) + 3 };
}

/** Fills the scroller with grid lines even when there are few rows. */
function updateBodyMin() {
  ui.grid.style.setProperty('--body-min', `${Math.max(app.visible.length * ROW_H, ui.scroller.clientHeight - HEAD_H)}px`);
}

function renderChart() {
  if (!app.sched) return;
  if (app.listOpen) fitList();
  const rows = app.sched.rows;
  app.visible = rows.filter((row) => !row.hidden);
  if (app.viewPath !== app.state.file.path) {
    app.view = null;
    app.viewPath = app.state.file.path;
  }
  const prev = app.range;
  const fresh = app.view === null;
  app.range = computeRange(rows);
  ui.grid.style.setProperty('--row-h', `${ROW_H}px`);
  ui.grid.style.setProperty('--bar-h', `${BAR_H}px`);
  ui.grid.style.setProperty('--k', String(linkScale()));
  ui.grid.style.setProperty('--bar-fs', `${clamp(Math.round(BAR_H * 0.6), 10, 14)}px`);
  const sum = summarySize();
  ui.grid.style.setProperty('--sbar-h', `${sum.bar}px`);
  ui.grid.style.setProperty('--sbar-ov', `${sum.over}px`);
  ui.grid.style.setProperty('--sbar-w', `${sum.wide}px`);
  ui.grid.style.setProperty('--sum-lh', `${sum.label}px`);
  applyCols();
  ui.grid.style.setProperty('--tlW', `${app.range.width}px`);
  updateBodyMin();
  renderTimelineHeader();
  renderLeftHeader();
  renderLeft();
  renderBody();
  renderSplits();
  const { start, ppd } = app.range;
  // The range grew to the left: shift the scroll position so the days in view stay where they were.
  if (prev && prev.ppd === ppd && prev.start !== start) ui.scroller.scrollLeft += (prev.start - start) * ppd;
  // A file just opened: show today.
  if (fresh) scrollToToday();
}

let scrollFrame = 0;
ui.scroller.addEventListener(
  'scroll',
  () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      growRange();
    });
  },
  { passive: true },
);

/** Extends the timeline when the view reaches one of its ends, so it can be scrolled as far as the dates go. */
function growRange() {
  const range = app.range;
  if (!range || !app.sched || app.drag || ui.editor.hidden) return;
  const sc = ui.scroller;
  const edge = 14 * range.ppd;
  const left = sc.scrollLeft < edge && range.start > MIN_START;
  const right = sc.scrollWidth - sc.clientWidth - sc.scrollLeft < edge && range.end < MAX_END;
  if (!left && !right) return;
  const margin = marginDays(range.ppd);
  app.view = { start: range.start - (left ? margin : 0), end: range.end + (right ? margin : 0) };
  renderChart();
}

function renderLeftHeader() {
  const cell = (text, align) => h('div', align ? { style: { textAlign: align } } : {}, text);
  // Only the row numbers while the list is folded; the name and the chosen columns follow when it is open.
  if (!app.listOpen) return ui.hl.replaceChildren(h('div', { class: 'cols' }, cell('#', 'center')));
  // The button at the end of the name opens the menu of columns (so does a right-click anywhere on the header).
  const name = h(
    'div',
    { class: 'h-name' },
    h('span', {}, t('col.name')),
    h('button', { class: 'btn flat square col-menu', type: 'button', title: t('col.menu'), 'aria-label': t('col.menu'), 'aria-haspopup': 'menu', onclick: (event) => columnsMenu(event.currentTarget) }, icon('sliders')),
  );
  ui.hl.replaceChildren(h('div', { class: 'cols' }, cell('#', 'center'), name, ...colKeys().slice(1).map((key) => cell(colTitle(key), key === 'dur' || propOfCol(key)?.type === 'number' ? 'right' : undefined))));
}

ui.hl.addEventListener('contextmenu', (event) => {
  if (app.listOpen) columnsMenu(event);
});

/** The menu of the columns of the list: the name is always there, the others (duration, assignee, the properties) are switched on and off. */
function columnsMenu(at) {
  const props = properties();
  showMenu(at, [
    { heading: t('col.menu') },
    { label: t('col.name'), checked: true, disabled: true, run: () => {} },
    ...OPTIONAL_COLS.map((key) => ({ label: t(`col.${key}`), checked: app.cols.has(key), run: () => toggleCol(key) })),
    ...(props.length ? [{ separator: true }, { heading: t('col.props') }, ...props.map((prop) => ({ label: prop.name, checked: app.cols.has(propCol(prop)), run: () => toggleCol(propCol(prop)) }))] : []),
    { separator: true },
    { label: t('col.manage'), icon: 'sliders', run: openProject },
  ]);
}

/** A property was renamed (`to` is its new name) or deleted (`to` is null): its column in the list follows, or goes. */
function renameCol(from, to) {
  const old = `p:${from}`;
  if (!app.cols.has(old)) return;
  app.cols.delete(old);
  if (to !== null) app.cols.add(`p:${to}`);
  rememberCols();
  renderChart();
}

/** Tells the server which optional columns are chosen (it keeps them with the other view settings). */
const rememberCols = () => rememberView({ cols: [...app.cols] });

/** Shows or hides an optional column. The timeline keeps its place on the screen while the list gets wider or narrower. */
function toggleCol(key) {
  const before = listW();
  if (!app.cols.delete(key)) app.cols.add(key);
  rememberCols();
  renderChart();
  ui.scroller.scrollLeft += listW() - before;
}

function renderTimelineHeader() {
  const { start, end, ppd, today } = app.range;
  const top = h('div', { class: 'hrow' });
  const bottom = h('div', { class: 'hrow' });
  // The cell that holds today is tinted, so the date in view that is today stands out. `span` is the days the cell stands
  // for (a whole month or year even where the range cuts it off): what a click on it zooms to.
  const cell = (parent, from, to, text, cls = '', title = '', span = [from, to]) => {
    const here = parent === bottom && from <= today && today <= to;
    const fits = span[1] > span[0];
    parent.append(h('div', { class: `hc ${cls}${fits ? ' fit' : ''}${here ? ' is-today' : ''}`.trim().replace(/\s+/g, ' '), 'data-from': String(span[0]), 'data-to': String(span[1]), style: { left: `${(from - start) * ppd}px`, width: `${(to - from + 1) * ppd}px` }, title: here ? `${t('chart.today', { date: formatDate(today) })}` : title }, text));
  };
  const fmt = (day, options) => dateFormat(options).format(dayDate(day));
  const monthLong = { year: 'numeric', month: 'long' };
  const withYear = { year: 'numeric', month: 'short', day: 'numeric' };
  const noYear = { month: 'short', day: 'numeric' };
  // "Dec 7 – Dec 13, 2026" in English, but "2026年12月7日 – 12月13日" in Japanese, where the year comes first, with the start.
  const weekLabel = (from, to) => {
    const same = ymd(from).y === ymd(to).y;
    return getLocale() === 'ja' ? `${fmt(from, withYear)} – ${fmt(to, same ? noYear : withYear)}` : `${fmt(from, same ? noYear : withYear)} – ${fmt(to, withYear)}`;
  };
  if (app.zoom === 'day') {
    for (let first = start; first <= end; first += 7) cell(top, first, first + 6, weekLabel(first, first + 6), 'grp');
    // Below 40px a day column has no room for the weekday.
    for (let day = start; day <= end; day++) {
      cell(bottom, day, day, ppd >= 40 ? `${ymd(day).d} (${fmt(day, { weekday: 'short' })})` : String(ymd(day).d), app.cal.isWorkday(day) ? '' : 'off', formatDate(day));
      bottom.lastElementChild.dataset.day = String(day);
    }
  } else if (app.zoom === 'week') {
    for (const seg of monthSegments(start, end)) cell(top, seg.from, seg.to, fmt(seg.from, monthLong), 'grp', '', monthSpan(seg));
    for (let first = start; first <= end; first += 7) cell(bottom, first, first + 6, fmt(first, { month: 'numeric', day: 'numeric' }), '', formatDate(first));
  } else {
    const months = monthSegments(start, end);
    for (let i = 0; i < months.length; ) {
      let j = i;
      while (j + 1 < months.length && months[j + 1].y === months[i].y) j++;
      cell(top, months[i].from, months[j].to, fmt(months[i].from, { year: 'numeric' }), 'grp', '', [monthStart(months[i].y, 1), monthStart(months[i].y + 1, 1) - 1]);
      i = j + 1;
    }
    for (const seg of months) cell(bottom, seg.from, seg.to, fmt(seg.from, { month: 'short' }), '', fmt(seg.from, monthLong), monthSpan(seg));
  }
  ui.ht.replaceChildren(top, bottom);
}

/** The + shown above / below a row number while the pointer is on it. */
function insertButton(where, row) {
  const label = where === 'before' ? t('ins.above', { row: row.row }) : t('ins.below', { row: row.row });
  const stop = (event) => event.stopPropagation();
  return h('button', {
    class: `ins ins-${where}`,
    type: 'button',
    tabindex: '-1',
    title: label,
    'aria-label': label,
    onclick: (event) => {
      event.stopPropagation();
      insertTask(where, row.id);
    },
    ondblclick: stop,
  }, '+');
}

/** A number for the screen: at most two decimals, in the language of the page. */
const numberText = (value) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value);

/** The text a value of a property is shown as; '' for no value. */
function formatValue(prop, value) {
  if (value === null || value === undefined) return '';
  switch (prop.type) {
    case 'number':
      return `${numberText(value)}${prop.unit ?? ''}`;
    case 'tags':
      return value.join(', ');
    case 'checkbox':
      return value ? '✓' : '';
    default:
      return String(value);
  }
}

/** The cell of a property column: the value of the task, or what a parent worked out from the tasks under it. */
function propCell(prop, row) {
  const value = row.props[prop.name];
  const text = formatValue(prop, value);
  const link = prop.type === 'url' && value ? h('a', { href: value, target: '_blank', rel: 'noopener noreferrer', title: value, onclick: (event) => event.stopPropagation(), ondblclick: (event) => event.stopPropagation() }, text.replace(/^https?:\/\//i, '')) : null;
  return h('div', { class: `c-prop pt-${prop.type}${row.summary && prop.aggregate ? ' derived' : ''}`, role: 'gridcell', title: link ? value : text }, link ?? text);
}

function leftRow(row) {
  const task = taskById(row.id);
  const selected = app.picked.has(row.id);
  const caret = row.summary
    ? h(
        'button',
        {
          class: 'caret',
          type: 'button',
          tabindex: '-1',
          'aria-label': task.collapsed ? t('list.expand') : t('list.collapse'),
          onclick: (event) => {
            event.stopPropagation();
            send([{ op: 'update', id: row.id, collapsed: !task.collapsed }]);
          },
        },
        task.collapsed ? '▸' : '▾',
      )
    : h('span', { class: 'caret-space' });
  const name =
    app.editing === row.id
      ? h('input', {
          class: 'name-input',
          type: 'text',
          value: app.editText,
          maxlength: '200',
          'aria-label': t('panel.name'),
          oninput: (event) => {
            app.editText = event.target.value;
          },
          onkeydown: (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') finishEdit(true);
            else if (event.key === 'Escape') finishEdit(false);
          },
          onblur: () => finishEdit(true),
        })
      : h('span', { class: 'name', title: task.name }, task.name || t('list.unnamed'));
  const resources = task.resources.join(', ');
  const attrs = { class: `cols lrow tc-${colorOf(row)}${selected ? ' sel' : ''}${row.summary ? ' summary' : ''}`, role: 'row', 'aria-level': row.level + 1, 'aria-selected': String(selected), 'data-id': row.id };
  if (row.summary) attrs['aria-expanded'] = String(!task.collapsed);
  const el = h(
    'div',
    { ...attrs, onclick: (event) => clickTask(event, row.id), ondblclick: () => startEdit(row.id) },
    h('div', { class: 'c-no', role: 'gridcell' }, String(row.row), insertButton('before', row), insertButton('after', row)),
    app.listOpen ? h('div', { class: 'c-name', role: 'gridcell', style: { paddingLeft: `${6 + row.level * 16}px` } }, caret, name) : null,
    app.listOpen && app.cols.has('dur') ? h('div', { class: 'c-dur', role: 'gridcell' }, formatDuration(row.duration)) : null,
    app.listOpen && app.cols.has('res') ? h('div', { class: 'c-res', role: 'gridcell', title: resources }, resources) : null,
    ...(app.listOpen ? colKeys().filter((key) => propOfCol(key)).map((key) => propCell(propOfCol(key), row)) : []),
  );
  return el;
}

function renderLeft() {
  ui.bl.replaceChildren(...app.visible.map(leftRow));
  if (app.editing) {
    const input = ui.bl.querySelector('.name-input');
    input?.focus();
    input?.select();
  }
}

function startEdit(id) {
  const task = taskById(id);
  if (!task || !app.listOpen) return;
  app.editing = id;
  app.editText = task.name;
  renderLeft();
}

function finishEdit(commit) {
  const id = app.editing;
  if (!id) return;
  const text = app.editText.trim();
  app.editing = null;
  renderLeft();
  ui.bl.focus({ preventScroll: true });
  if (commit && text && text !== taskById(id)?.name) send([{ op: 'update', id, name: text }]);
}

function renderBody() {
  cancelLink();
  const { start, days, ppd, today } = app.range;
  const named = app.labels;
  const parts = [];
  const rowTop = new Map(app.visible.map((row, i) => [row.id, i * ROW_H]));
  app.rowTop = rowTop;

  // The header cells are drawn again, so a mark on one of them is dropped (the pointer sets it again when it moves).
  app.bandCell = null;
  hband.hidden = true;
  parts.push(hband);
  parts.push(h('div', { class: 'rowsel', hidden: true }));
  if (app.zoom !== 'month') {
    for (let day = start; day < start + days; day++) {
      if (!app.cal.isWorkday(day)) parts.push(h('div', { class: 'off-col', style: { left: `${(day - start) * ppd}px`, width: `${ppd}px` } }));
    }
  }
  const step = app.zoom === 'day' ? 1 : 7;
  if (app.zoom === 'month') {
    for (const seg of monthSegments(start, start + days - 1).slice(1)) parts.push(h('div', { class: 'vl', style: { left: `${(seg.from - start) * ppd}px` } }));
  } else {
    for (let day = start + step; day < start + days; day += step) parts.push(h('div', { class: 'vl', style: { left: `${(day - start) * ppd}px` } }));
  }
  if (today >= start && today < start + days) {
    parts.push(h('div', { class: 'today', style: { left: `${(today - start) * ppd + (app.zoom === 'day' ? ppd / 2 - 1 : 0)}px` } }));
  }

  // The ground under a parent task: a light rectangle in its color, from its row to the row of its last child.
  const pad = 6 * linkScale();
  app.visible.forEach((row, i) => {
    if (!row.summary) return;
    let last = i;
    while (last + 1 < app.visible.length && app.visible[last + 1].level > row.level) last++;
    if (last === i) return;
    const top = rowTop.get(row.id) + 1;
    const height = rowTop.get(app.visible[last].id) + ROW_H - 1 - top;
    parts.push(h('div', { class: `area c-${colorOf(row)}`, 'data-area': row.id, style: { left: `${(row.startDay - start) * ppd - pad}px`, width: `${(row.endDay - row.startDay + 1) * ppd + pad * 2}px`, top: `${top}px`, height: `${height}px` } }));
  });

  for (const row of app.visible) {
    const task = taskById(row.id);
    const left = (row.startDay - start) * ppd;
    const width = (row.endDay - row.startDay + 1) * ppd;
    const top = rowTop.get(row.id);
    const percent = Math.round(row.progress);
    const label = t('bar.label', { name: task.name, start: formatDate(row.startDay), end: formatDate(row.endDay), duration: formatDuration(row.duration), progress: percent });
    const selected = app.picked.has(row.id);
    // A deadline shows as a flag at the end of its day; a task that ends after it is late.
    const dueDay = task.due ? parseDate(task.due) : null;
    const lateDays = dueDay !== null && row.endDay > dueDay ? row.endDay - dueDay : 0;
    const late = lateDays ? ' late' : '';
    const lateTag = () => (lateDays ? h('span', { class: 'late-tag' }, t('due.tag', { count: lateDays })) : null);
    if (dueDay !== null) parts.push(h('div', { class: `due${late}`, 'data-due': row.id, title: t('due.marker', { date: task.due }), style: { left: `${(dueDay - start + 1) * ppd - 1}px`, top: `${top + 2}px`, height: `${ROW_H - 4}px` } }));
    if (row.summary) {
      // A parent is a bar with a triangle on each end and, when the names are shown, its name on top: the name starts
      // after the left triangle, so that triangle can stick up beside it. The block is centered in the row.
      const { bar, over, height: sb, wide, label: lh } = summarySize();
      const block = named ? lh + bar + over : sb;
      const y = top + Math.max(0, Math.round((ROW_H - block) / 2));
      const sbar = h('div', { class: `sbar c-${colorOf(row)}${selected ? ' sel' : ''}${late}`, 'data-id': row.id, role: 'img', 'aria-label': label, title: label, style: { left: `${left}px`, width: `${width}px`, top: `${y + (named ? lh - over : 0)}px` } });
      wireBar(sbar, row);
      parts.push(sbar);
      // A folded parent shows ▸ before its name: with the list hidden this is the only sign that tasks are tucked away under it.
      if (named) parts.push(h('div', { class: `sum-label tc-${colorOf(row)}`, style: { left: `${left + Math.min(wide, width / 2)}px`, top: `${y}px` } }, `${task.collapsed ? '▸ ' : ''}${task.name}  ${percent}%`, lateTag()));
      else parts.push(h('div', { class: `after-label tc-${colorOf(row)}`, style: { left: `${left + width}px`, top: `${top + 5}px` } }, `${percent}%`, lateTag()));
      continue;
    }
    if (row.milestone) {
      // A milestone is a diamond centered on its day, with its name after it.
      const size = BAR_H;
      const cx = left + ppd / 2;
      const diamond = h('div', { class: `bar ms c-${colorOf(row)}${selected ? ' sel' : ''}${late}`, 'data-id': row.id, role: 'img', 'aria-label': label, title: label, style: { left: `${cx - size / 2}px`, width: `${size}px`, top: `${top + 5}px` } });
      wireBar(diamond, row);
      parts.push(diamond);
      if (named || lateDays) parts.push(h('div', { class: `after-label tc-${colorOf(row)}`, style: { left: `${cx + size / 2}px`, top: `${top + 5}px` } }, named ? task.name : null, lateTag()));
      continue;
    }
    // The name goes inside the bar when it fits, otherwise after it; without names only the progress is shown.
    const inside = named ? width >= 80 : width >= 40 && app.zoom === 'day';
    const bar = h(
      'div',
      { class: `bar c-${colorOf(row)}${selected ? ' sel' : ''}${late}`, 'data-id': row.id, role: 'img', 'aria-label': label, title: label, style: { left: `${left}px`, width: `${width}px`, top: `${top + 5}px` } },
      h('div', { class: 'fill', style: { width: `${percent}%` } }),
      inside ? h('span', { class: `pct${named ? ' named' : ''}` }, named ? `${task.name}  ${percent}%` : `${percent}%`) : null,
      h('div', { class: 'grip' }),
    );
    wireBar(bar, row);
    parts.push(bar);
    const after = named ? !inside : !inside || app.zoom !== 'day';
    if (after || lateDays) parts.push(h('div', { class: `after-label tc-${colorOf(row)}`, style: { left: `${left + width}px`, top: `${top + 5}px` } }, after ? (named ? `${task.name}  ${percent}%` : `${percent}%`) : null, lateTag()));
  }

  parts.push(linksLayer(rowTop));
  ui.bt.replaceChildren(...parts);
  updateSelection();
}

/** Scale of the links (line width, arrow head, gaps and legs): they follow the row height, so they zoom with the bars. */
const linkScale = () => ROW_H / ROW_STD;

function linksLayer(rowTop) {
  const { start, ppd, width } = app.range;
  const k = linkScale();
  const svg = svgEl('svg', { class: 'links', width, height: Math.max(app.visible.length * ROW_H, 1), 'aria-hidden': 'true' });
  svg.style.setProperty('--lw', `${(1.2 * k).toFixed(2)}px`);
  const defs = svgEl('defs');
  // The head takes the color of the task it points at, and is its own shape so that the arrows of the selected task can
  // be highlighted (see updateLinks). Its size is in screen units, not in multiples of the line width, so a thicker
  // (highlighted) line does not blow it up.
  for (const color of PALETTE) {
    for (const [id, cls, size] of [['arrow', 'head', 8 * k], ['arrow-hi', 'head hi', 10 * k]]) {
      const marker = svgEl('marker', { id: `${id}-${color}`, viewBox: '0 0 8 8', refX: 8, refY: 4, markerUnits: 'userSpaceOnUse', markerWidth: size.toFixed(2), markerHeight: size.toFixed(2), orient: 'auto' });
      marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: `${cls} c-${color}` }));
      defs.append(marker);
    }
  }
  svg.append(defs);
  layoutLinks(rowTop, start, ppd).forEach((link, i) => {
    // The line runs from the color of the task it leaves to the color of the task it enters.
    const [from, to] = [colorOf(link.from), colorOf(link.to)];
    const gradient = svgEl('linearGradient', { id: `lg-${i}`, gradientUnits: 'userSpaceOnUse', x1: link.x1, y1: link.sy, x2: link.x2, y2: link.ey });
    gradient.append(svgEl('stop', { offset: 0, class: `c-${from}` }), svgEl('stop', { offset: 1, class: `c-${to}` }));
    defs.append(gradient);
    const path = svgEl('path', { class: 'link', d: link.d, stroke: `url(#lg-${i})`, 'marker-end': `url(#arrow-${to})`, 'data-from': link.from.id, 'data-to': link.to.id, 'data-end': to });
    // A wider invisible stroke on top makes the thin arrow easy to point at.
    const hit = svgEl('path', { class: 'hit', d: link.d, 'data-from': link.from.id, 'data-to': link.to.id });
    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectLink(link.from.id, link.to.id);
    });
    hit.addEventListener('pointerenter', () => path.classList.add('hover'));
    hit.addEventListener('pointerleave', () => path.classList.remove('hover'));
    hit.addEventListener('contextmenu', (event) => {
      selectLink(link.from.id, link.to.id);
      showMenu(event, [{ label: t('ctx.deleteLink'), icon: 'trash', danger: true, hint: 'Del', run: deleteLink }]);
    });
    svg.append(path, hit);
  });
  return svg;
}

/**
 * Routes every dependency arrow. A link leaves its predecessor to the right and enters its successor from the
 * left. Links that share a task are spread (start and end heights, and the columns where they turn) so that
 * they do not run on top of each other.
 */
function layoutLinks(rowTop, start, ppd) {
  const links = [];
  for (const row of app.visible) {
    for (const pred of taskById(row.id).predecessors) {
      const from = rowById(pred.task);
      if (from && !from.hidden) links.push({ from, to: row });
    }
  }
  const byTask = (key) => {
    const groups = new Map();
    for (const link of links) {
      if (!groups.has(link[key].id)) groups.set(link[key].id, []);
      groups.get(link[key].id).push(link);
    }
    return groups;
  };
  // Every distance below is in multiples of k, so the routing keeps its shape when the chart is zoomed.
  const k = linkScale();
  const leg = LINK_LEG * k;
  const gap = (n) => Math.min(3.5 * k, (14 * k) / Math.max(n - 1, 1));
  const centered = (i, n) => (i - (n - 1) / 2) * gap(n);
  const dy = (link) => rowTop.get(link.to.id) - rowTop.get(link.from.id);
  // Heights. Leaving a task: links going up start above those going down. Entering a task: from above first
  // (top to bottom), then from below. Each also gets its own height for the horizontal run in the gap next to the row.
  for (const group of byTask('from').values()) {
    const up = group.filter((link) => dy(link) < 0).sort((a, b) => dy(a) - dy(b));
    const down = group.filter((link) => dy(link) > 0).sort((a, b) => dy(a) - dy(b));
    [...up, ...down].forEach((link, i, all) => {
      link.y1 = centered(i, all.length);
    });
  }
  for (const group of byTask('to').values()) {
    const above = group.filter((link) => dy(link) > 0).sort((a, b) => rowTop.get(a.from.id) - rowTop.get(b.from.id));
    const below = group.filter((link) => dy(link) < 0).sort((a, b) => rowTop.get(a.from.id) - rowTop.get(b.from.id));
    [...above, ...below].forEach((link, i, all) => {
      link.y2 = centered(i, all.length);
    });
    for (const side of [above, below]) {
      side.forEach((link, i) => {
        link.turn = (i - (side.length - 1) / 2) * 2.5 * k;
      });
    }
  }
  for (const link of links) {
    // A milestone is a diamond in the middle of its day, so a link meets its tip rather than the edge of the day.
    const half = BAR_H / 2;
    link.x1 = link.from.milestone ? (link.from.startDay - start + 0.5) * ppd + half : (link.from.endDay - start + 1) * ppd;
    link.x2 = link.to.milestone ? (link.to.startDay - start + 0.5) * ppd - half : (link.to.startDay - start) * ppd;
    link.sy = rowTop.get(link.from.id) + ROW_H / 2 + link.y1;
    link.ey = rowTop.get(link.to.id) + ROW_H / 2 + link.y2;
    // The arrow head covers the end of the line, so the last leg must be longer than it or only the head is left.
    // When there is no room, turn in the gap next to the target row instead, so the line never cuts through the
    // bars between the two rows.
    link.direct = link.x2 - (link.x1 + 6 * k) >= leg;
    link.ym = (link.ey > link.sy ? rowTop.get(link.to.id) : rowTop.get(link.to.id) + ROW_H) + link.turn;
  }
  // Columns. Each vertical stretch takes the first column where it does not lie on another one. The ones with the
  // farthest to go are placed first, so they end up on the outside and the arrows do not cross.
  const placed = [];
  const free = (x, a, b) => !placed.some((v) => Math.abs(v.x - x) < 3 * k && Math.min(v.b, Math.max(a, b)) - Math.max(v.a, Math.min(a, b)) > 1);
  const farthest = (a, b) => Math.abs(dy(b)) - Math.abs(dy(a));
  for (const link of [...links].sort(farthest)) {
    const top = link.direct ? link.ey : link.ym;
    // A direct arrow must leave room for its last leg; one that turns in the gap may go as far right as it needs.
    const room = link.direct ? link.x2 - link.x1 - leg : (6 + 5 * 10) * k;
    let out = 6 * k;
    while (!free(link.x1 + out, link.sy, top) && out + 5 * k <= room) out += 5 * k;
    link.out = out;
    placed.push({ x: link.x1 + out, a: Math.min(link.sy, top), b: Math.max(link.sy, top) });
  }
  for (const link of [...links].filter((item) => !item.direct).sort((a, b) => farthest(b, a))) {
    let into = leg;
    while (!free(link.x2 - into, link.ym, link.ey) && into < leg + 4 * 10 * k) into += 4 * k;
    link.into = into;
    placed.push({ x: link.x2 - into, a: Math.min(link.ym, link.ey), b: Math.max(link.ym, link.ey) });
  }
  for (const link of links) {
    const out = link.x1 + link.out;
    link.d = link.direct ? `M${link.x1},${link.sy} H${out} V${link.ey} H${link.x2}` : `M${link.x1},${link.sy} H${out} V${link.ym} H${link.x2 - link.into} V${link.ey} H${link.x2}`;
  }
  return links;
}

// ---- Selecting a dependency -----------------------------------------------------------------------------------------

const hasLink = (from, to) => Boolean(taskById(to)?.predecessors.some((pred) => pred.task === from));

/** Selects one dependency arrow; its details (the lag) open in the panel and it can be deleted there. */
function selectLink(from, to) {
  pick([], null);
  app.selLink = { from, to };
  app.detailOpen = true;
  updateSelection();
  renderToolbar();
  renderPanel();
  renderStatus();
}

function clearLink() {
  if (!app.selLink) return;
  app.selLink = null;
  updateSelection();
  renderToolbar();
  renderPanel();
  renderStatus();
}

async function deleteLink() {
  const link = app.selLink;
  if (!link || !hasLink(link.from, link.to)) return;
  const task = taskById(link.to);
  await send([{ op: 'update', id: link.to, predecessors: task.predecessors.filter((pred) => pred.task !== link.from) }]);
}

// Highlights the arrows into and out of the selected task, or the selected arrow, and fades the rest.
function updateLinks() {
  const svg = ui.bt.querySelector('.links');
  if (!svg) return;
  const link = app.selLink;
  const related = [...svg.querySelectorAll('path.link')].filter((path) => (link ? path.dataset.from === link.from && path.dataset.to === link.to : app.picked.has(path.dataset.from) || app.picked.has(path.dataset.to)));
  svg.classList.toggle('focus', related.length > 0);
  for (const path of svg.querySelectorAll('path.link')) {
    const on = related.includes(path);
    path.classList.toggle('rel', on);
    path.classList.toggle('picked', on && Boolean(link));
    path.setAttribute('marker-end', `url(#arrow${on ? '-hi' : ''}-${path.dataset.end})`);
  }
  // Later elements are drawn on top, so move the highlighted arrows to the end.
  svg.append(...related);
}

function updateSelection() {
  for (const el of ui.bl.children) {
    const selected = app.picked.has(el.dataset.id);
    el.classList.toggle('sel', selected);
    el.setAttribute('aria-selected', String(selected));
  }
  for (const el of ui.bt.querySelectorAll('.bar, .sbar')) el.classList.toggle('sel', app.picked.has(el.dataset.id));
  const band = ui.bt.querySelector('.rowsel');
  const top = app.selected ? app.rowTop?.get(app.selected) : undefined;
  if (band) {
    band.hidden = top === undefined;
    if (top !== undefined) band.style.top = `${top}px`;
    band.className = `rowsel tc-${selectedRow() ? colorOf(selectedRow()) : 'blue'}`;
  }
  updateLinks();
  renderConnectors();
}

/** Makes `ids` the selection; `primary` is the task the toolbar and the detail panel act on. */
function pick(ids, primary = ids[0] ?? null, { notify = true } = {}) {
  app.picked = new Set(ids);
  app.selected = primary;
  app.selLink = null;
  updateSelection();
  renderToolbar();
  renderPanel();
  renderStatus();
  if (notify) post('/api/select', { id: app.selected, ids: [...app.picked] }).catch(() => {});
}

function select(id) {
  if (app.selected === id && app.picked.size === 1) return;
  pick([id], id);
}

function togglePick(id) {
  const ids = new Set(app.picked);
  if (ids.delete(id)) pick([...ids], app.selected === id ? ([...ids].pop() ?? null) : app.selected);
  else pick([...ids, id], id);
}

// Shift selects every row between the task last picked and this one.
function rangePick(id) {
  const from = app.visible.findIndex((row) => row.id === app.selected);
  const to = app.visible.findIndex((row) => row.id === id);
  if (from < 0 || to < 0) return showDetail(id);
  pick(app.visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id), app.selected);
}

function clickTask(event, id) {
  if (event.ctrlKey || event.metaKey) return togglePick(id);
  if (event.shiftKey) return rangePick(id);
  showDetail(id);
}

// Clicking a task also opens its details; while the panel is open it follows the selection, including keyboard moves.
// The chart scrolls to the task when it is not in view (but not while a bar is being pressed, which may become a drag).
function showDetail(id, { reveal = true } = {}) {
  select(id);
  app.detailOpen = true;
  renderPanel();
  if (reveal) revealTask(id);
}

function closeDetail() {
  app.detailOpen = false;
  if (app.selLink) {
    app.selLink = null;
    updateSelection();
    renderToolbar();
    renderStatus();
  }
  renderPanel();
}

/** After the panel appears or goes, the scroller changes height: refill the grid lines and keep the selected row in view. */
function afterPanelToggle() {
  updateBodyMin();
  const i = app.visible.findIndex((row) => row.id === app.selected);
  if (i < 0) return;
  const sc = ui.scroller;
  const top = HEAD_H + i * ROW_H;
  if (top + ROW_H > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + ROW_H - sc.clientHeight;
  else if (top < sc.scrollTop + HEAD_H) sc.scrollTop = top - HEAD_H;
}

function renderStatus() {
  if (!app.sched) return;
  const project = app.sched.project;
  const slash = (day) => formatDate(day).replaceAll('-', '/');
  // The properties that add up are totalled for the whole project.
  const totals = properties().filter((prop) => prop.aggregate).map((prop) => t('status.total', { name: prop.name, value: project.totals[prop.name] == null ? '-' : formatValue(prop, project.totals[prop.name]) }));
  const parts = [
    t('status.tasks', { value: project.count }),
    ...totals,
    t('status.duration', { value: project.count ? formatDuration(project.duration) : '-' }),
    t('status.progress', { value: project.count ? `${project.progress.toFixed(2)}%` : '-' }),
  ];
  const figures = parts.length;
  const row = selectedRow();
  const late = app.sched.rows.filter((item) => {
    const due = taskById(item.id)?.due;
    return due && item.endDay > parseDate(due);
  }).length;
  if (app.selLink) parts.push(t('status.linkSelected'));
  else if (app.picked.size > 1) parts.push(t('status.selectedMany', { count: app.picked.size }));
  else if (row) parts.push(`${taskById(row.id).name}  ${slash(row.startDay)} – ${slash(row.endDay)} (${formatDuration(row.duration)})`);
  const spans = parts.map((text) => h('span', {}, text));
  // The count of late tasks sits right after the project figures, in red.
  if (late) spans.splice(figures, 0, h('span', { class: 'late' }, t('status.late', { value: late })));
  ui.status.replaceChildren(...spans);
}

// ---- Dragging bars --------------------------------------------------------------------------------------------

/** The leaf tasks under the given ids (a parent stands for its children). */
function leavesOf(ids) {
  const list = tasks();
  const leaves = new Set();
  for (const id of ids) {
    const i = list.findIndex((task) => task.id === id);
    if (i < 0) continue;
    for (let j = i, end = subtreeEnd(list, i); j < end; j++) if (!isSummary(list, j)) leaves.add(list[j].id);
  }
  return [...leaves];
}

function wireBar(el, row) {
  el.addEventListener('pointerdown', (event) => beginDrag(event, row, el));
  el.addEventListener('pointermove', onDragMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}

function beginDrag(event, row, bar) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (app.link) return completeLink(row.id);
  const resize = event.target.classList.contains('grip');
  const modifier = (event.ctrlKey || event.metaKey || event.shiftKey) && !resize;
  if (modifier) {
    clickTask(event, row.id);
    if (!app.picked.has(row.id)) return;
  } else if (resize || app.picked.size <= 1 || !app.picked.has(row.id)) {
    showDetail(row.id, { reveal: false });
  }
  // Pressing one of several selected bars keeps the group for a drag; a click without a drag then selects just that one.
  const collapse = !modifier && !resize && app.picked.size > 1;
  const group = resize ? [row.id] : [...app.picked];
  const leaves = leavesOf(group);
  const els = new Map([...group, ...leaves].map((id) => [id, ui.bt.querySelector(`[data-id="${id}"].bar, [data-id="${id}"].sbar`)]));
  bar.setPointerCapture(event.pointerId);
  bar.classList.add('dragging');
  ui.bt.classList.add('busy');
  app.drag = {
    row,
    bar,
    mode: resize ? 'resize' : 'move',
    group,
    leaves,
    els,
    maxLeft: resize ? 0 : maxSlideEarlier(app.state.doc, group),
    days: 0,
    // The tasks the dependencies would push if the drag ended now, by id (see previewPush).
    pushed: new Map(),
    pushKey: null,
    collapse,
    modifier,
    moved: false,
    x0: event.clientX,
    scroll0: ui.scroller.scrollLeft,
    cx: event.clientX,
    cy: event.clientY,
    delta: 0,
    width: bar.offsetWidth,
  };
}

/** Working days to move the dragged tasks by for the pointer's position, cut down to what their predecessors allow. */
function slideDays(drag) {
  const wanted = app.cal.diff(drag.row.startDay, app.cal.next(drag.row.startDay + drag.delta));
  return { days: Math.max(wanted, -drag.maxLeft), limited: wanted < -drag.maxLeft };
}

/** Shows what the drag would push: the tasks that wait for the dragged ones move ahead, marked, as they would when it ends. */
function previewPush(drag, key, ops) {
  if (drag.pushKey !== key) {
    drag.pushKey = key;
    const next = new Map((previewOps(ops)?.shifted ?? []).map((item) => [item.id, item]));
    const bar = (id) => ui.bt.querySelector(`[data-id="${id}"].bar, [data-id="${id}"].sbar`);
    for (const id of drag.pushed.keys()) {
      if (next.has(id)) continue;
      const el = bar(id);
      if (el) {
        el.style.transform = '';
        el.classList.remove('pushed');
      }
    }
    for (const [id, item] of next) {
      const el = bar(id);
      const from = rowById(id)?.startDay;
      if (!el || from === undefined) continue;
      el.style.transform = `translateX(${(app.cal.add(from, item.days) - from) * app.range.ppd}px)`;
      el.classList.add('pushed');
    }
    drag.pushed = next;
  }
  const pushed = [...drag.pushed.values()];
  return pushed.length ? ` → ${shiftText('drag.pushes', pushed)}` : '';
}

function resizeTarget(drag) {
  const end = app.cal.prev(drag.row.endDay + drag.delta);
  return { start: drag.row.startDay, end: Math.max(end, drag.row.startDay) };
}

// The bar lives in the scrolled content, so the distance moved includes how far the view has scrolled since the drag began.
function updateDrag(drag) {
  const ppd = app.range.ppd;
  const moved = drag.cx - drag.x0 + ui.scroller.scrollLeft - drag.scroll0;
  drag.delta = Math.round(moved / ppd);
  if (Math.abs(moved) > 3) drag.moved = true;
  let start;
  let end;
  let note = '';
  if (drag.mode === 'move') {
    const { days, limited } = slideDays(drag);
    drag.days = days;
    // Every bar of the group moves by the same number of working days, so each is shifted from its own start.
    for (const id of drag.group) {
      const el = drag.els.get(id);
      const from = rowById(id)?.startDay;
      if (el && from !== undefined) el.style.transform = `translateX(${(app.cal.add(from, days) - from) * ppd}px)`;
    }
    for (const id of drag.leaves) {
      const el = drag.els.get(id);
      const from = rowById(id)?.startDay;
      if (el && !drag.group.includes(id) && from !== undefined) el.style.transform = `translateX(${(app.cal.add(from, days) - from) * ppd}px)`;
    }
    start = app.cal.add(drag.row.startDay, days);
    end = app.cal.add(drag.row.endDay, days);
    if (drag.leaves.length > 1) note += ` ${t('drag.moveTogether', { count: drag.leaves.length })}`;
    if (limited) note += ` ${t('drag.limited')}`;
    if (days) note += previewPush(drag, days, [{ op: 'slide', ids: drag.group, days }]);
  } else {
    drag.bar.style.width = `${Math.max(ppd, drag.width + drag.delta * ppd)}px`;
    ({ start, end } = resizeTarget(drag));
    if (end !== drag.row.endDay) note += previewPush(drag, end, [{ op: 'update', id: drag.row.id, end: formatDate(end) }]);
  }
  ui.tip.hidden = false;
  ui.tip.textContent = `${formatDate(start)} – ${formatDate(end)}（${formatDuration(app.cal.count(start, end))}）${note}`;
  ui.tip.style.left = `${drag.cx + 14}px`;
  ui.tip.style.top = `${drag.cy + 16}px`;
}

function onDragMove(event) {
  const drag = app.drag;
  if (!drag) return;
  drag.cx = event.clientX;
  drag.cy = event.clientY;
  updateDrag(drag);
  autoScroll();
}

const AUTO_SCROLL_ZONE = 48;
const AUTO_SCROLL_SPEED = 24;

// Scrolls the timeline while the pointer is held near its left or right edge during a drag.
function autoScroll() {
  if (app.autoScrolling) return;
  app.autoScrolling = true;
  const step = () => {
    const drag = app.drag;
    const sc = ui.scroller;
    const rect = sc.getBoundingClientRect();
    const left = rect.left + listW() + AUTO_SCROLL_ZONE;
    const right = rect.left + sc.clientWidth - AUTO_SCROLL_ZONE;
    const speed = !drag ? 0 : drag.cx < left ? -Math.min(1, (left - drag.cx) / AUTO_SCROLL_ZONE) : drag.cx > right ? Math.min(1, (drag.cx - right) / AUTO_SCROLL_ZONE) : 0;
    if (!speed) {
      app.autoScrolling = false;
      return;
    }
    const before = sc.scrollLeft;
    sc.scrollLeft += speed * AUTO_SCROLL_SPEED;
    if (sc.scrollLeft !== before) updateDrag(drag);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Whether this click on a bar is the second of a double-click. The browser's own dblclick event does not reach the bars
 * (a press is handled as the start of a drag, with the pointer captured), so two clicks close together are counted here.
 */
const DOUBLE_CLICK_MS = 500;
function isDoubleClick(event, id) {
  const last = app.lastClick;
  const again = Boolean(last) && last.id === id && event.timeStamp - last.time < DOUBLE_CLICK_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8;
  app.lastClick = again ? null : { id, time: event.timeStamp, x: event.clientX, y: event.clientY };
  return again;
}

async function endDrag(event) {
  const drag = app.drag;
  if (!drag) return;
  app.drag = null;
  ui.tip.hidden = true;
  ui.bt.classList.remove('busy');
  drag.bar.classList.remove('dragging');
  let ops = null;
  if (event.type === 'pointerup') {
    if (drag.mode === 'move' && drag.days) ops = [{ op: 'slide', ids: drag.group, days: drag.days }];
    else if (drag.mode === 'resize' && drag.delta && resizeTarget(drag).end !== drag.row.endDay) ops = [{ op: 'update', id: drag.row.id, end: formatDate(resizeTarget(drag).end) }];
    else if (drag.mode === 'move' && !drag.moved && !drag.modifier && drag.row.summary && isDoubleClick(event, drag.row.id)) ops = [{ op: 'update', id: drag.row.id, collapsed: !taskById(drag.row.id).collapsed }];
    else if (drag.collapse && !drag.moved) showDetail(drag.row.id);
  }
  if (ops) await send(ops);
  else if (app.sched) renderChart();
  // A click (no drag) on a bar brings the task into view.
  if (!ops && event.type === 'pointerup' && drag.mode === 'move' && !drag.moved && !drag.modifier && !drag.collapse) revealTask(drag.row.id);
  if (app.pendingRender) {
    app.pendingRender = false;
    render();
  }
  growRange();
}

// ---- Panning with the right button ---------------------------------------------------------------------------------

/**
 * Dragging with the right button moves the view in both directions. The pointer is captured only once it has moved,
 * so a plain right-click keeps its target; the menu that comes with the button release is dropped after a pan.
 */
const PAN_SLOP = 4;
let pan = null;
let panned = false;

ui.scroller.addEventListener('pointerdown', (event) => {
  panned = false;
  if (event.button !== 2 || !(ui.bt.contains(event.target) || ui.ht.contains(event.target)) || app.drag || app.marquee || app.link) return;
  pan = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, moved: false };
});

ui.scroller.addEventListener('pointermove', (event) => {
  if (!pan || event.pointerId !== pan.id) return;
  if (!(event.buttons & 2)) return endPan();
  if (!pan.moved) {
    if (Math.hypot(event.clientX - pan.x0, event.clientY - pan.y0) < PAN_SLOP) return;
    pan.moved = true;
    hideMenu();
    markCell(null);
    ui.scroller.setPointerCapture(event.pointerId);
    ui.scroller.classList.add('panning');
  }
  // Relative steps: the chart can grow at its left end while panning, which moves scrollLeft by itself.
  ui.scroller.scrollLeft += pan.x - event.clientX;
  ui.scroller.scrollTop += pan.y - event.clientY;
  pan.x = event.clientX;
  pan.y = event.clientY;
});

function endPan() {
  if (!pan) return;
  panned = pan.moved;
  if (pan.moved && ui.scroller.hasPointerCapture(pan.id)) ui.scroller.releasePointerCapture(pan.id);
  ui.scroller.classList.remove('panning');
  pan = null;
}

ui.scroller.addEventListener('pointerup', (event) => event.button === 2 && endPan());
ui.scroller.addEventListener('pointercancel', endPan);
ui.scroller.addEventListener(
  'contextmenu',
  (event) => {
    if (!panned && !pan?.moved) return;
    panned = false;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

// ---- Selecting with a rectangle ------------------------------------------------------------------------------------

ui.bt.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.bar, .sbar, .conn-h')) return;
  if (app.link) return cancelLink();
  const additive = event.ctrlKey || event.metaKey;
  app.marquee = { x0: event.clientX, y0: event.clientY, additive, base: additive ? new Set(app.picked) : new Set(), moved: false, el: null };
  ui.bt.setPointerCapture(event.pointerId);
});

ui.bt.addEventListener('pointermove', (event) => {
  if (app.marquee) return moveMarquee(app.marquee, event);
  if (app.link?.sticky) updateLink(event);
  revealConnectors(event);
  hoverToday(event);
});

/**
 * The line of today is too thin to carry a title. While the pointer rests on it, a red dot marks the spot on the line
 * and a red box above the dot names the day.
 */
const todayPin = h('div', { class: 'today-pin', hidden: true }, h('span'));
document.body.append(todayPin);

function hoverToday(event) {
  const line = ui.bt.querySelector('.today');
  const x = line ? line.getBoundingClientRect().left + 1 : null;
  const near = x !== null && !app.drag && !app.link && !app.marquee && !event.target.closest?.('.bar, .sbar, .conn-h, .hit') && Math.abs(event.clientX - x) <= 4;
  if (near) {
    app.todayTip = true;
    const label = todayPin.firstElementChild;
    label.textContent = t('chart.today', { date: formatDate(app.range.today) });
    todayPin.hidden = false;
    todayPin.style.left = `${x}px`;
    todayPin.style.top = `${event.clientY}px`;
    // The box is centered on the dot, kept inside the window.
    const width = label.offsetWidth;
    label.style.left = `${clamp(x - width / 2, 4, window.innerWidth - width - 4) - x}px`;
  } else if (app.todayTip) {
    hideTodayPin();
  }
}

function hideTodayPin() {
  app.todayTip = false;
  todayPin.hidden = true;
}

ui.bt.addEventListener('pointerup', endMarquee);
ui.bt.addEventListener('pointercancel', endMarquee);
ui.bt.addEventListener('pointerleave', () => {
  if (!app.link) ui.bt.querySelector('.conn')?.classList.remove('show');
  if (app.todayTip) hideTodayPin();
});

function moveMarquee(marquee, event) {
  if (!marquee.moved && Math.hypot(event.clientX - marquee.x0, event.clientY - marquee.y0) < 4) return;
  marquee.moved = true;
  const box = ui.bt.getBoundingClientRect();
  const left = Math.min(marquee.x0, event.clientX) - box.left;
  const right = Math.max(marquee.x0, event.clientX) - box.left;
  const top = Math.min(marquee.y0, event.clientY) - box.top;
  const bottom = Math.max(marquee.y0, event.clientY) - box.top;
  if (!marquee.el) {
    marquee.el = h('div', { class: 'marquee' });
    ui.bt.append(marquee.el);
  }
  Object.assign(marquee.el.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  const { start, ppd } = app.range;
  const hits = app.visible
    .filter((row, i) => i * ROW_H + 5 < bottom && i * ROW_H + 5 + BAR_H > top && (row.startDay - start) * ppd < right && (row.endDay + 1 - start) * ppd > left)
    .map((row) => row.id);
  const ids = [...new Set([...marquee.base, ...hits])];
  pick(ids, hits[0] ?? [...marquee.base].pop() ?? null, { notify: false });
}

function endMarquee(event) {
  const marquee = app.marquee;
  if (!marquee) return;
  app.marquee = null;
  marquee.el?.remove();
  if (marquee.moved) {
    post('/api/select', { id: app.selected, ids: [...app.picked] }).catch(() => {});
  } else if (event.type === 'pointerup' && !marquee.additive) {
    // A plain click on empty space selects the row under it, or clears the selection below the last row.
    const row = app.visible[Math.floor((event.clientY - ui.bt.getBoundingClientRect().top) / ROW_H)];
    if (row) showDetail(row.id);
    else pick([], null);
  }
}

// ---- Linking tasks with the mouse ----------------------------------------------------------------------------------

// Two arrows sit above and below the selected bar (the sides are left free for resizing). The top one is for
// a task that comes before this one, the bottom one for a task that comes after it; they differ in color and label.
const LINK_DIRECTION = { top: 'in', bottom: 'out' };
const linkTitle = (dir) => t(dir === 'in' ? 'link.titleIn' : 'link.titleOut');
// Short, always visible text next to each arrow, so the two are told apart without relying on color.
const linkTag = (dir) => t(dir === 'in' ? 'link.tagIn' : 'link.tagOut');
const linkHint = (dir) => t(dir === 'in' ? 'link.hintIn' : 'link.hintOut');

function renderConnectors() {
  ui.bt.querySelector('.conn')?.remove();
  const row = app.picked.size === 1 ? selectedRow() : null;
  const el = row && ui.bt.querySelector(`[data-id="${row.id}"].bar, [data-id="${row.id}"].sbar`);
  if (!el) return;
  // A parent task takes its dates from its children, so it cannot follow another task.
  const sides = row.summary ? ['bottom'] : ['top', 'bottom'];
  ui.bt.append(
    h(
      'div',
      { class: `conn tc-${colorOf(row)}${app.link ? ' show' : ''}`, style: { left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`, '--cx': `${el.offsetWidth / 2}px` } },
      ...sides.flatMap((side) => {
        const dir = LINK_DIRECTION[side];
        return [
          h('button', { class: `conn-h conn-${side} dir-${dir}`, type: 'button', tabindex: '-1', title: linkTitle(dir), 'aria-label': linkTitle(dir), onpointerdown: (event) => beginLink(event, row, side), onpointermove: updateLink, onpointerup: releaseLink, onpointercancel: cancelLink }),
          h('span', { class: `conn-tag conn-tag-${side} dir-${dir}` }, linkTag(dir)),
        ];
      }),
    ),
  );
}

/** Shows the arrows while the pointer is on the selected bar or in the gap next to it; they follow the pointer along the bar. */
function revealConnectors(event) {
  const conn = ui.bt.querySelector('.conn');
  if (!conn || app.drag || app.marquee) return;
  if (app.link) return conn.classList.add('show');
  if (event.target.closest?.('.conn-h')) return;
  const box = conn.getBoundingClientRect();
  const near = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top - 10 && event.clientY <= box.bottom + 10;
  conn.classList.toggle('show', near);
  if (near) conn.style.setProperty('--cx', `${Math.min(Math.max(event.clientX - box.left, 12), Math.max(box.width - 12, 12))}px`);
}

function beginLink(event, row, side) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  cancelLink();
  event.currentTarget.setPointerCapture(event.pointerId);
  const el = ui.bt.querySelector(`[data-id="${row.id}"].bar, [data-id="${row.id}"].sbar`);
  const conn = ui.bt.querySelector('.conn');
  const x = el.offsetLeft + (parseFloat(conn.style.getPropertyValue('--cx')) || el.offsetWidth / 2);
  const y = side === 'top' ? el.offsetTop : el.offsetTop + el.offsetHeight;
  const dir = LINK_DIRECTION[side];
  const line = svgEl('line', { x1: x, y1: y, x2: x, y2: y });
  const dot = svgEl('circle', { cx: x, cy: y, r: 4 });
  const svg = svgEl('svg', { class: `rubber dir-${dir} tc-${colorOf(row)}`, width: ui.bt.offsetWidth, height: ui.bt.offsetHeight, 'aria-hidden': 'true' });
  svg.append(line, dot);
  ui.bt.append(svg);
  app.link = { id: row.id, dir, x0: event.clientX, y0: event.clientY, moved: false, sticky: false, target: null, svg, line, dot };
  conn.classList.add('show');
}

/** Why `targetId` cannot be connected to the task being linked, or '' when it can. */
function linkProblem(targetId) {
  const link = app.link;
  if (targetId === link.id) return t('link.errSelf');
  const [pred, succ] = link.dir === 'out' ? [link.id, targetId] : [targetId, link.id];
  if (rowById(succ)?.summary) return t('link.errParent');
  if (taskById(succ).predecessors.some((item) => item.task === pred)) return t('link.errDup');
  if (dependsOn(pred, succ)) return t('link.errCycle');
  return '';
}

/** Whether `id` needs `wanted` to finish first: through predecessors, or, for a parent, through its children. */
function dependsOn(id, wanted) {
  const list = tasks();
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (current === wanted) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const i = list.findIndex((task) => task.id === current);
    stack.push(...list[i].predecessors.map((item) => item.task));
    for (let j = i + 1, end = subtreeEnd(list, i); j < end; j = subtreeEnd(list, j)) stack.push(list[j].id);
  }
  return false;
}

/** The tasks that would be pushed later if the arrow being dragged were connected to `targetId` (remembered while the pointer stays on it). */
function linkPushes(targetId) {
  const link = app.link;
  if (link.probeId !== targetId) {
    const [pred, succ] = link.dir === 'out' ? [link.id, targetId] : [targetId, link.id];
    link.probeId = targetId;
    link.probe = previewOps([{ op: 'update', id: succ, predecessors: [...taskById(succ).predecessors, { task: pred, lag: 0 }] }], { own: true })?.shifted ?? [];
  }
  return link.probe;
}

function updateLink(event) {
  const link = app.link;
  if (!link) return;
  const box = ui.bt.getBoundingClientRect();
  link.line.setAttribute('x2', event.clientX - box.left);
  link.line.setAttribute('y2', event.clientY - box.top);
  link.dot.setAttribute('cx', event.clientX - box.left);
  link.dot.setAttribute('cy', event.clientY - box.top);
  if (Math.hypot(event.clientX - link.x0, event.clientY - link.y0) > 4) link.moved = true;
  const over = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.matches?.('.bar, .sbar'));
  for (const el of ui.bt.querySelectorAll('.link-ok, .link-bad, .link-push')) el.classList.remove('link-ok', 'link-bad', 'link-push');
  ui.tip.hidden = true;
  link.target = null;
  if (!over || over.dataset.id === link.id) return;
  const ok = !linkProblem(over.dataset.id);
  over.classList.add(ok ? 'link-ok' : 'link-bad');
  if (!ok) return;
  link.target = over.dataset.id;
  // Say what connecting would do to the dates, before it is done.
  const pushes = linkPushes(over.dataset.id);
  if (!pushes.length) return;
  over.classList.add('link-push');
  ui.tip.hidden = false;
  ui.tip.textContent = shiftText('link.pushes', pushes);
  ui.tip.style.left = `${event.clientX + 14}px`;
  ui.tip.style.top = `${event.clientY + 16}px`;
}

// Dragging an arrow onto a task connects them; clicking an arrow waits for the next click on a task.
function releaseLink(event) {
  const link = app.link;
  if (!link || link.sticky) return;
  updateLink(event);
  if (!link.moved) {
    link.sticky = true;
    toast(linkHint(link.dir));
    return;
  }
  const over = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.matches?.('.bar, .sbar'));
  if (over && over.dataset.id !== link.id) completeLink(over.dataset.id);
  else cancelLink();
}

function cancelLink() {
  const link = app.link;
  if (!link) return;
  app.link = null;
  link.svg.remove();
  ui.tip.hidden = true;
  for (const el of ui.bt.querySelectorAll('.link-ok, .link-bad, .link-push')) el.classList.remove('link-ok', 'link-bad', 'link-push');
  ui.bt.querySelector('.conn')?.classList.remove('show');
}

async function completeLink(targetId) {
  const link = app.link;
  if (!link) return;
  const problem = linkProblem(targetId);
  cancelLink();
  if (problem) return toast(problem, 'error');
  const source = taskById(link.id);
  const target = taskById(targetId);
  const [follower, before] = link.dir === 'out' ? [target, source] : [source, target];
  await send([{ op: 'update', id: follower.id, predecessors: [...follower.predecessors, { task: before.id, lag: 0 }] }]);
}

// ---- Detail panel -----------------------------------------------------------------------------------------------

/** The tallest the detail panel may be: the chart above it keeps room for the header and a few rows. */
const panelMax = () => Math.max(120, window.innerHeight - 380);
const PANEL_MIN = 90;

/** Fits the panel to what the user dragged (or to its content when they have not); the chart above takes the rest. */
function applyPanelHeight() {
  if (app.panelH === null) {
    ui.panel.style.height = '';
    ui.panel.style.maxHeight = '';
    return;
  }
  app.panelH = Math.round(clamp(app.panelH, PANEL_MIN, panelMax()));
  ui.panel.style.height = `${app.panelH}px`;
  ui.panel.style.maxHeight = 'none';
}

/** Dragging the top edge of the detail panel (or ↑ ↓ on it) sets its height; a double-click goes back to fitting the content. */
function wirePanelSplit() {
  const el = ui.psplit;
  let drag = null;
  const setHeight = (height) => {
    app.panelH = height;
    applyPanelHeight();
    updateBodyMin();
  };
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    drag = { y0: event.clientY, h0: ui.panel.offsetHeight, moved: false };
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (Math.abs(event.clientY - drag.y0) > 3) drag.moved = true;
    setHeight(drag.h0 + drag.y0 - event.clientY);
  });
  // A double-click (counted by isDoubleClick, as the press is handled here) goes back to fitting the content.
  const release = (event) => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    el.classList.remove('dragging');
    if (event.type === 'pointerup' && !moved && isDoubleClick(event, 'psplit')) {
      app.panelH = null;
      applyPanelHeight();
    }
    updateBodyMin();
    afterPanelToggle();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setHeight(ui.panel.offsetHeight + (event.key === 'ArrowUp' ? 16 : -16));
    afterPanelToggle();
  });
}

function renderPanel() {
  if (!app.sched || !app.state.file) return;
  const row = selectedRow();
  const several = app.picked.size > 1;
  const link = app.selLink;
  const open = app.detailOpen && (several || Boolean(row) || Boolean(link));
  if (open === ui.panel.hidden) {
    ui.panel.hidden = !open;
    ui.psplit.hidden = !open;
    applyPanelHeight();
    afterPanelToggle();
  }
  // The panel takes the color of the task it shows (the first of several), so that it reads as that task's.
  const shown = row ?? (several ? rowById([...app.picked][0]) : null);
  ui.panel.className = `panel${shown && !link ? ` tc-${colorOf(shown)}` : ''}`;
  if (!open) {
    hideSuggest();
    app.panelKey = '';
    return;
  }
  const brief = tasks().map((task) => [task.id, task.name]);
  const key = link
    ? JSON.stringify(['link', link.from, link.to, taskById(link.to).predecessors, rowById(link.from)?.endDay, rowById(link.to)?.startDay, brief])
    : several
      ? JSON.stringify(['several', [...app.picked], brief])
      : JSON.stringify([taskById(row.id), row.startDay, row.endDay, row.duration, row.progress, row.summary, row.row, colorOf(row), brief, app.state.file.path, app.moreOpen, row.props, properties()]);
  if (key === app.panelKey) return;
  app.panelKey = key;
  // The list of suggestions belongs to a field of the panel that is about to be built again; one that stays keeps its list.
  hideSuggest();

  const active = document.activeElement;
  const field = ui.panel.contains(active) ? active.getAttribute('data-field') : null;
  const caret = field && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scrollTop = ui.panel.querySelector('.pbody')?.scrollTop ?? 0;

  const close = h('button', { class: 'btn flat square', type: 'button', 'aria-label': t('panel.close'), title: t('panel.closeTitle'), onclick: closeDetail }, '×');
  if (link) {
    ui.panel.replaceChildren(h('div', { class: 'ph' }, h('span', { class: 'pt' }, t('panel.linkTitle', { from: `#${rowById(link.from).row} ${taskById(link.from).name}`, to: `#${rowById(link.to).row} ${taskById(link.to).name}` })), close), h('div', { class: 'pbody' }, linkForm(link)));
    ui.panel.querySelector('.pbody').scrollTop = scrollTop;
  } else if (several) {
    const names = [...app.picked].map((id) => taskById(id)?.name).filter(Boolean);
    ui.panel.replaceChildren(
      h('div', { class: 'ph' }, h('span', { class: 'pt' }, t('panel.several', { count: names.length })), close),
      h(
        'div',
        { class: 'pbody' },
        h('p', { class: 'hint' }, t('panel.severalHint')),
        h('ul', { class: 'picked' }, ...names.map((name) => h('li', {}, name))),
      ),
    );
  } else {
    const task = taskById(row.id);
    const { nameInput, quick, more } = taskForm(row);
    const toggle = h('button', { class: 'btn more-btn', type: 'button', 'aria-expanded': String(app.moreOpen), title: t('panel.moreTitle'), onclick: toggleMore }, `${app.moreOpen ? '▾' : '▸'} ${t('panel.more')}`);
    ui.panel.replaceChildren(h('div', { class: 'ph' }, h('span', { class: 'pno', title: task.name }, `#${row.row}`), nameInput, toggle, close), h('div', { class: 'pbody' }, quick, app.moreOpen ? more : null));
    ui.panel.querySelector('.pbody').scrollTop = scrollTop;
  }

  if (field) {
    const el = ui.panel.querySelector(`[data-field="${field}"]`);
    if (el) {
      el.focus();
      if (caret && caret[0] !== null) el.setSelectionRange?.(caret[0], caret[1]);
    }
  }
  // The panel's height depends on what it shows, and so does the room left for the chart.
  updateBodyMin();
}

/** Shows or hides the less used fields (dates, assignee, color, predecessors) under the progress, the properties and the note. */
function toggleMore() {
  app.moreOpen = !app.moreOpen;
  app.panelKey = '';
  renderPanel();
}

function linkForm(link) {
  const from = taskById(link.from);
  const to = taskById(link.to);
  const pred = to.predecessors.find((item) => item.task === link.from);
  const rowFrom = rowById(link.from);
  const rowTo = rowById(link.to);
  const commit = (lag) => send([{ op: 'update', id: link.to, predecessors: to.predecessors.map((item) => (item.task === link.from ? { task: item.task, lag } : item)) }]);
  const revert = (message) => {
    toast(message, 'error');
    app.panelKey = '';
    renderPanel();
  };
  return h(
    'div',
    { class: 'form' },
    labeled(
      t('linkForm.lag'),
      h('input', {
        type: 'number',
        min: '0',
        max: '999',
        step: '1',
        value: String(pred.lag),
        'data-field': 'link-lag',
        onchange: (event) => {
          const lag = Number(event.target.value);
          if (event.target.value !== '' && Number.isInteger(lag) && lag >= 0 && lag <= 999) commit(lag);
          else revert(t('linkForm.errLag'));
        },
      }),
    ),
    h('div', { class: 'lbl' }, t('linkForm.predEnd'), h('span', { class: 'path' }, `${formatDate(rowFrom.endDay)} (${from.name})`)),
    h('div', { class: 'lbl' }, t('linkForm.succStart'), h('span', { class: 'path' }, `${formatDate(rowTo.startDay)} (${to.name})`)),
    h('p', { class: 'hint wide' }, t('linkForm.hint')),
    h(
      'div',
      { class: 'wide row-actions' },
      h('button', { class: 'btn danger', type: 'button', onclick: deleteLink }, t('linkForm.delete')),
      h('button', { class: 'btn', type: 'button', onclick: () => showDetail(link.from) }, t('linkForm.openPred')),
      h('button', { class: 'btn', type: 'button', onclick: () => showDetail(link.to) }, t('linkForm.openSucc')),
    ),
  );
}

ui.panel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
});

const labeled = (text, control, className) => h('label', className ? { class: className } : {}, text, control);

// ---- Tag input (assignees: pick from what the chart already uses, or create) ---------------------------------------------

/** For comparing names: width, case and surrounding spaces do not matter. */
const norm = (text) => text.normalize('NFKC').trim().toLowerCase();
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

/** Every word the tasks use in a list of tags (`pick` takes it from a task) with the number of tasks that use it, the most used first. */
function knownTags(pick) {
  const counts = new Map();
  for (const task of tasks()) for (const name of pick(task)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, getLocale()));
}
/** Every assignee used in the chart. */
const knownResources = () => knownTags((task) => task.resources);

function hideSuggest() {
  ui.suggest.hidden = true;
  ui.suggest.replaceChildren();
  app.suggestOwner = null;
  app.suggestPlace = null;
}

/**
 * A field of chips, in the style of a tag picker. Typing searches the values the chart already has; the last row offers
 * to create what was typed when nothing matches it exactly. Enter or a click picks the highlighted row, "," (or "、")
 * takes the text as it is, Backspace on an empty field removes the last chip, and Esc closes the list.
 * `onChange(values)` is called after every change.
 */
function tagInput({ values, ariaLabel, placeholder, onChange, field = 'resources', known = knownResources }) {
  let tags = [...values];
  // What was being typed survives the redraw that follows a change (the panel is built again from the saved chart).
  const setDraft = (text) => {
    app.tagDraft = text;
    app.tagDraftField = text ? field : '';
  };
  let query = app.tagDraftField === field ? app.tagDraft : '';
  let active = 0;
  let open = false;
  let list = [];
  const box = h('div', { class: 'tags' });
  const input = h('input', { class: 'tag-input', 'data-field': field, role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-controls': 'suggest', 'aria-label': ariaLabel, autocomplete: 'off', spellcheck: 'false', maxlength: String(MAX_TAG_LENGTH) });
  box.append(input);
  input.value = query;

  const options = () => {
    const q = norm(query);
    const taken = new Set(tags.map(norm));
    const free = known().filter((item) => !taken.has(norm(item.name)));
    const found = q ? free.filter((item) => norm(item.name).includes(q)).sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q))) : free;
    const rows = found.map((item) => ({ kind: 'existing', name: item.name, count: item.count }));
    // Nothing is offered to create when the text is already a chip or already exists.
    if (q && !taken.has(q) && !free.some((item) => norm(item.name) === q) && tags.length < MAX_TAGS) rows.push({ kind: 'create', name: query.trim().slice(0, MAX_TAG_LENGTH) });
    return rows;
  };

  const highlight = () => {
    [...ui.suggest.children].forEach((row, i) => {
      row.classList.toggle('on', i === active);
      row.setAttribute('aria-selected', String(i === active));
    });
    ui.suggest.children[active]?.scrollIntoView({ block: 'nearest' });
    if (list.length) input.setAttribute('aria-activedescendant', `sg-${active}`);
  };

  /** Puts the list under the field, or above it when the panel is at the bottom of the window and there is no room below. */
  const place = () => {
    const rect = box.getBoundingClientRect();
    const s = ui.suggest;
    s.style.width = `${Math.max(rect.width, 220)}px`;
    s.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - s.offsetWidth - 4))}px`;
    s.style.maxHeight = '240px';
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const up = s.offsetHeight > below && above > below;
    s.style.maxHeight = `${Math.max(80, Math.min(240, up ? above : below))}px`;
    s.style.top = `${up ? rect.top - s.offsetHeight - 4 : rect.bottom + 4}px`;
  };

  const draw = () => {
    list = open ? options() : [];
    if (!list.length) {
      if (app.suggestOwner === input) hideSuggest();
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    active = Math.min(active, list.length - 1);
    ui.suggest.replaceChildren(
      ...list.map((item, i) =>
        h(
          'div',
          { class: `sg-item${item.kind === 'create' ? ' create' : ''}`, id: `sg-${i}`, role: 'option', 'aria-selected': 'false', onmousedown: (event) => event.preventDefault(), onmousemove: () => { if (active !== i) { active = i; highlight(); } }, onclick: () => choose(i) },
          item.kind === 'create' ? [icon('plus'), h('span', { class: 'sg-name' }, t('tags.create', { name: item.name }))] : [h('span', { class: 'sg-name' }, item.name), h('span', { class: 'sg-count' }, t('tags.used', { count: item.count }))],
        ),
      ),
    );
    ui.suggest.hidden = false;
    app.suggestOwner = input;
    app.suggestPlace = place;
    input.setAttribute('aria-expanded', 'true');
    place();
    highlight();
  };

  const paint = () => {
    box.querySelectorAll('.chip').forEach((chip) => chip.remove());
    tags.forEach((name, i) =>
      box.insertBefore(
        h('span', { class: 'chip' }, h('span', { class: 'chip-name', title: name }, name), h('button', { class: 'chip-x', type: 'button', tabindex: '-1', 'aria-label': t('tags.remove', { name }), onmousedown: (event) => event.preventDefault(), onclick: () => remove(i) }, '×')),
        input,
      ),
      );
    input.placeholder = tags.length ? '' : placeholder;
    draw();
  };

  /** Adds names (ones that are already chips are skipped; one that exists keeps its spelling) and reports the change once. */
  const add = (names) => {
    const have = known();
    let changed = false;
    for (const raw of names) {
      const name = raw.trim().slice(0, MAX_TAG_LENGTH);
      if (!name || tags.length >= MAX_TAGS || tags.some((tag) => norm(tag) === norm(name))) continue;
      tags = [...tags, have.find((item) => norm(item.name) === norm(name))?.name ?? name];
      changed = true;
    }
    query = '';
    setDraft('');
    input.value = '';
    active = 0;
    paint();
    if (changed) onChange(tags);
  };

  const remove = (i) => {
    tags = tags.filter((_, j) => j !== i);
    paint();
    onChange(tags);
  };

  const choose = (i) => {
    const item = list[i];
    if (item) add([item.name]);
  };

  input.addEventListener('focus', () => {
    open = true;
    draw();
  });
  // A click on a field that already has the focus (the panel gave it back after a redraw) opens the list as well.
  input.addEventListener('click', () => {
    if (app.suggestOwner === input) return;
    open = true;
    draw();
  });
  input.addEventListener('blur', () => {
    // What was typed but not picked is dropped.
    open = false;
    query = '';
    setDraft('');
    input.value = '';
    if (app.suggestOwner === input) hideSuggest();
  });
  input.addEventListener('input', (event) => {
    open = true;
    active = 0;
    if (!event.isComposing && /[,、]/.test(input.value)) {
      const parts = input.value.split(/[,、]/);
      const rest = parts.pop();
      add(parts);
      query = rest;
      setDraft(rest);
      input.value = rest;
      return draw();
    }
    query = input.value;
    setDraft(query);
    draw();
  });
  input.addEventListener('keydown', (event) => {
    // While an IME is converting text, Enter and the arrows belong to it.
    if (event.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (list.length) choose(active);
        else if (query.trim()) add([query]);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        open = true;
        if (!list.length) return draw();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        highlight();
        break;
      case 'Backspace':
        if (input.value === '' && tags.length) {
          event.preventDefault();
          remove(tags.length - 1);
        }
        break;
      case 'Escape':
        // The first Esc closes the list; the next one is left to the panel.
        if (list.length) {
          event.preventDefault();
          event.stopPropagation();
          open = false;
          draw();
        }
        break;
      default:
    }
  });
  box.addEventListener('click', (event) => {
    if (event.target === box) input.focus();
  });
  paint();
  return box;
}

// The list follows the field when the panel scrolls (focusing a field near the edge scrolls it into view).
ui.panel.addEventListener('scroll', () => app.suggestPlace?.(), true);
window.addEventListener('resize', hideSuggest);

/** The control for one property in the detail panel. A parent shows, for a number that adds up, the figure from its children (and cannot change it). */
function propertyField(prop, index, row, task, commit, revert) {
  const field = `prop-${index}`;
  const derived = row.summary && Boolean(prop.aggregate);
  const value = derived ? row.props[prop.name] : task.props[prop.name];
  const label = prop.unit ? `${prop.name} (${prop.unit})` : prop.name;
  const title = derived ? t('props.fromChildren') : null;
  const set = (next) => commit({ props: { [prop.name]: next } });
  switch (prop.type) {
    case 'number':
      return labeled(
        label,
        h('input', {
          type: 'number',
          step: 'any',
          value: value === null || value === undefined ? '' : String(value),
          disabled: derived,
          title,
          'data-field': field,
          onchange: (event) => {
            const text = event.target.value.trim();
            if (text === '') return set(null);
            return Number.isFinite(Number(text)) ? set(Number(text)) : revert(t('panel.errNumber'));
          },
        }),
      );
    case 'text':
      return labeled(label, h('input', { type: 'text', maxlength: '500', value: value ?? '', 'data-field': field, onchange: (event) => set(event.target.value.trim() ? event.target.value : null) }), 'wide');
    case 'url':
      return h(
        'label',
        { class: 'wide' },
        h('span', {}, label, value ? h('a', { class: 'plink', href: value, target: '_blank', rel: 'noopener noreferrer', title: t('col.open') }, ' ↗') : null),
        h('input', {
          type: 'text',
          maxlength: '2000',
          placeholder: 'https://',
          value: value ?? '',
          'data-field': field,
          onchange: (event) => {
            const text = event.target.value.trim();
            if (text === '') return set(null);
            return /^https?:\/\/\S+$/i.test(text) ? set(text) : revert(t('panel.errUrl'));
          },
        }),
      );
    case 'date':
      return labeled(label, h('input', { type: 'date', value: value ?? '', 'data-field': field, onchange: (event) => set(event.target.value || null) }));
    case 'select':
      return labeled(
        label,
        h('select', { 'data-field': field, onchange: (event) => set(event.target.value || null) }, h('option', { value: '' }, t('panel.selectNone')), ...prop.options.map((option) => h('option', { value: option, selected: option === value }, option))),
      );
    case 'tags':
      return h('div', { class: 'lbl wide' }, label, tagInput({ values: value ?? [], ariaLabel: prop.name, placeholder: t('tags.placeholder'), onChange: set, field, known: () => knownTags((item) => item.props[prop.name] ?? []) }));
    case 'checkbox':
      return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(value), 'data-field': field, onchange: (event) => set(event.target.checked ? true : null) }), prop.name);
    default:
      return null;
  }
}

function taskForm(row) {
  const task = taskById(row.id);
  const parent = row.summary;
  const commit = (patch) => send([{ op: 'update', id: task.id, ...patch }]);
  const revert = (message) => {
    toast(message, 'error');
    app.panelKey = '';
    renderPanel();
  };
  const percent = Math.round(row.progress);
  const output = h('output', {}, `${percent}%`);
  const rangeInput = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(percent),
    style: { '--p': `${percent}%` },
    disabled: parent,
    'data-field': 'progress',
    'aria-label': t('panel.progress'),
    oninput: (event) => {
      output.textContent = `${event.target.value}%`;
      event.target.style.setProperty('--p', `${event.target.value}%`);
    },
    onchange: (event) => commit({ progress: Number(event.target.value) }),
  });

  const predecessors = task.predecessors.map((pred, i) => {
    const from = rowById(pred.task);
    const label = from ? `#${from.row} ${taskById(pred.task).name}` : pred.task;
    return h(
      'div',
      { class: 'pred' },
      h('span', { class: 'pred-name', title: label }, label),
      h('input', {
        type: 'number',
        min: '0',
        max: '999',
        step: '1',
        value: String(pred.lag),
        'data-field': `lag-${i}`,
        'aria-label': t('panel.predLagAria', { label }),
        onchange: (event) => commit({ predecessors: task.predecessors.map((item, j) => (j === i ? { task: item.task, lag: Math.trunc(Number(event.target.value)) || 0 } : item)) }),
      }),
      h('button', { class: 'btn flat square', type: 'button', 'aria-label': t('panel.predRemove', { label }), onclick: () => commit({ predecessors: task.predecessors.filter((_, j) => j !== i) }) }, '×'),
    );
  });
  const candidates = tasks().filter((item) => item.id !== task.id && !task.predecessors.some((pred) => pred.task === item.id));
  const pick = h('select', { 'data-field': 'pred-pick', 'aria-label': t('panel.predPickAria') }, h('option', { value: '' }, t('panel.predPick')), ...candidates.map((item) => h('option', { value: item.id }, `#${rowById(item.id).row} ${item.name}`)));
  const lag = h('input', { type: 'number', min: '0', max: '999', step: '1', value: '0', 'data-field': 'pred-lag', 'aria-label': t('panel.predLagAddAria') });

  const nameInput = h('input', {
    class: 'pname',
    type: 'text',
    value: task.name,
    maxlength: '200',
    'data-field': 'name',
    'aria-label': t('panel.name'),
    onchange: (event) => (event.target.value.trim() ? commit({ name: event.target.value }) : revert(t('panel.errName'))),
  });
  // What is entered day to day (progress, the project's properties, note) is always at hand; the rest opens with the button in the header.
  const quick = h(
    'div',
    { class: 'quick form' },
    h('div', { class: 'lbl' }, t('panel.progress'), h('div', { class: 'range' }, rangeInput, output)),
    ...properties().map((prop, i) => propertyField(prop, i, row, task, commit, revert)),
    labeled(t('panel.note'), h('textarea', { 'data-field': 'note', maxlength: '2000', onchange: (event) => commit({ note: event.target.value }) }, task.note), 'note'),
    parent ? h('p', { class: 'hint note-hint' }, t('panel.parentHint')) : null,
  );
  const milestone = row.milestone;
  const more = h(
    'div',
    { class: 'form more' },
    h(
      'div',
      { class: 'pair wide' },
      labeled(t('panel.start'), h('input', { type: 'date', value: formatDate(row.startDay), disabled: parent, 'data-field': 'start', onchange: (event) => (event.target.value ? commit({ start: event.target.value }) : revert(t('panel.errStart'))) })),
      labeled(t('panel.end'), h('input', { type: 'date', value: formatDate(row.endDay), disabled: parent || milestone, 'data-field': 'end', onchange: (event) => (event.target.value ? commit({ end: event.target.value }) : revert(t('panel.errEnd'))) })),
    ),
    labeled(
      t('panel.duration'),
      h('input', {
        type: 'text',
        value: formatDuration(row.duration),
        disabled: parent || milestone,
        'data-field': 'duration',
        onchange: (event) => (parseDuration(event.target.value) !== null ? commit({ duration: event.target.value }) : revert(t('panel.errDuration'))),
      }),
    ),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: milestone, disabled: parent, 'data-field': 'milestone', onchange: (event) => commit({ milestone: event.target.checked }) }), t('panel.milestone')),
    labeled(t('panel.due'), h('input', { type: 'date', value: task.due ?? '', 'data-field': 'due', onchange: (event) => commit({ due: event.target.value || null }) }), 'wide'),
    h('div', { class: 'lbl wide' }, t('panel.resources'), tagInput({ values: task.resources, ariaLabel: t('panel.resources'), placeholder: t('tags.placeholder'), onChange: (resources) => commit({ resources }) })),
    h(
      'div',
      { class: 'lbl wide' },
      t('tb.color'),
      h('div', { class: 'swatches', role: 'group', 'aria-label': t('tb.color') }, ...PALETTE.map((color) => h('button', { class: `swatch c-${color}`, type: 'button', 'aria-pressed': String(chosenColor(row) === color), onclick: () => commit({ color }) }, h('i'), colorName(color))), row.parent >= 0 ? h('button', { class: 'swatch', type: 'button', 'aria-pressed': String(chosenColor(row) === 'inherit'), onclick: () => commit({ color: 'inherit' }) }, colorName('inherit')) : null),
      parent
        ? h('span', {}, t('panel.colorParent'))
        : task.color === 'inherit' && row.parent >= 0
          ? h('span', {}, t('panel.colorInherited', { name: colorName(colorOf(row)) }))
          : null,
    ),
    parent ? null : h('div', { class: 'lbl wide' }, t('panel.predecessors'), ...predecessors, h('div', { class: 'pred-add' }, pick, lag, h('button', { class: 'btn', type: 'button', onclick: () => pick.value && commit({ predecessors: [...task.predecessors, { task: pick.value, lag: Math.trunc(Number(lag.value)) || 0 }] }) }, t('panel.predAdd')))),
  );
  return { nameInput, quick, more };
}

// ---- Project settings -----------------------------------------------------------------------------------------

function openProject() {
  const { project } = app.state.doc;
  const error = h('p', { class: 'err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', value: project.name, maxlength: '200', 'aria-label': t('project.name') });
  const weekStart = h('select', { 'aria-label': t('project.weekStart'), 'data-field': 'weekStart' }, ...WEEK_STARTS.map((value) => h('option', { value }, t(value === 'sun' ? 'project.weekSun' : 'project.weekMon'))));
  weekStart.value = project.weekStart;
  const holidays = h('textarea', { spellcheck: 'false', placeholder: '2026-11-23', 'aria-label': t('project.holidaysAria') }, project.holidays.join('\n'));
  const extraWorkdays = h('textarea', { spellcheck: 'false', placeholder: '2026-11-21', 'aria-label': t('project.extraWorkdaysAria') }, project.extraWorkdays.join('\n'));
  // One toggle per weekday, in the order the weeks start in; a pressed one is off every week.
  const weekdays = h('div', { class: 'swatches', role: 'group', 'aria-label': t('project.weeklyOffAria') });
  const drawWeekdays = (saved) => {
    const order = saved.weekStart === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    weekdays.replaceChildren(
      ...order.map((index) => {
        const key = WEEKDAYS[index];
        const off = saved.weeklyOff.includes(key);
        const next = off ? saved.weeklyOff.filter((item) => item !== key) : [...saved.weeklyOff, key];
        return h('button', { class: 'swatch', type: 'button', 'data-weekday': key, 'aria-pressed': String(off), onclick: () => save({ weeklyOff: next }) }, dateFormat({ weekday: 'short' }).format(dayDate(SUNDAY + index)));
      }),
    );
  };
  // The properties: a card for each (its name, its type, what its type has to set), and a row to add one.
  const propsBox = h('div', { class: 'props' });
  let drawn = '';
  const propRow = (prop) => {
    const nameInput = h('input', { type: 'text', maxlength: '50', value: prop.name, 'aria-label': t('props.nameAria'), 'data-field': 'prop-name' });
    nameInput.addEventListener('change', async () => {
      const next = nameInput.value.trim();
      if (!next || next === prop.name) return show();
      if (await run({ op: 'update_property', name: prop.name, newName: next })) renameCol(prop.name, next);
    });
    const del = h('button', { class: 'btn flat square danger', type: 'button', title: t('props.delete'), 'aria-label': t('props.deleteAria', { name: prop.name }) }, '×');
    del.addEventListener('click', async () => {
      const count = tasks().filter((task) => task.props[prop.name] !== undefined).length;
      if (!(await confirmDialog(t('props.deleteConfirm', { name: prop.name, count }), t('props.delete')))) return;
      if (await run({ op: 'delete_property', name: prop.name })) renameCol(prop.name, null);
    });
    const body = [];
    const sync = [() => (nameInput.value = prop.name)];
    if (prop.type === 'select') {
      const options = h('textarea', { spellcheck: 'false', 'aria-label': t('props.options'), 'data-field': 'prop-options' });
      options.addEventListener('change', () => run({ op: 'update_property', name: prop.name, options: options.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }));
      sync.push(() => (options.value = (prop.options ?? []).join('\n')));
      body.push(labeled(t('props.options'), options));
    }
    if (prop.type === 'number') {
      const unit = h('input', { type: 'text', maxlength: '10', 'aria-label': t('props.unit'), 'data-field': 'prop-unit' });
      unit.addEventListener('change', () => run({ op: 'update_property', name: prop.name, unit: unit.value.trim() || null }));
      const aggregate = h('select', { 'aria-label': t('props.aggregate'), 'data-field': 'prop-aggregate' }, h('option', { value: '' }, t('props.agg.none')), ...AGGREGATES.map((kind) => h('option', { value: kind }, t(`props.agg.${kind}`))));
      aggregate.addEventListener('change', () => run({ op: 'update_property', name: prop.name, aggregate: aggregate.value || null }));
      sync.push(() => (unit.value = prop.unit ?? ''), () => (aggregate.value = prop.aggregate ?? ''));
      body.push(labeled(t('props.unit'), unit), labeled(t('props.aggregate'), aggregate));
    }
    const el = h('div', { class: 'prop-row' }, h('div', { class: 'prop-head' }, nameInput, h('span', { class: 'prop-type' }, t(`props.type.${prop.type}`)), del), body.length ? h('div', { class: 'prop-body' }, ...body) : null);
    el.sync = (saved) => {
      for (const key of Object.keys(prop)) delete prop[key];
      Object.assign(prop, saved);
      for (const fn of sync) fn();
    };
    return el;
  };
  const drawProps = () => {
    const list = properties();
    const shape = JSON.stringify(list.map((prop) => [prop.name, prop.type]));
    if (shape === drawn) return [...propsBox.querySelectorAll('.prop-row')].forEach((el, i) => el.sync(list[i]));
    drawn = shape;
    propsBox.replaceChildren(...(list.length ? list.map((prop) => propRow({ ...prop })) : [h('p', { class: 'hint' }, t('props.empty'))]));
    [...propsBox.querySelectorAll('.prop-row')].forEach((el, i) => el.sync(list[i]));
  };
  const addName = h('input', { type: 'text', maxlength: '50', placeholder: t('props.addName'), 'aria-label': t('props.addName'), 'data-field': 'prop-add-name' });
  const addType = h('select', { 'aria-label': t('props.typeAria'), 'data-field': 'prop-add-type' }, ...PROPERTY_TYPES.map((type) => h('option', { value: type }, t(`props.type.${type}`))));
  const addProp = async () => {
    const wanted = addName.value.trim();
    if (!wanted) {
      error.textContent = t('props.errName');
      error.hidden = false;
      return;
    }
    if (await run({ op: 'add_property', name: wanted, type: addType.value })) addName.value = '';
  };
  addName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addProp();
    }
  });
  const addRow = h('div', { class: 'prop-add' }, addName, addType, h('button', { class: 'btn', type: 'button', onclick: addProp }, icon('plus'), t('props.add')));
  // Shows what was saved (the server trims and sorts), or what is still saved when the edit was refused.
  const show = () => {
    const saved = app.state.doc.project;
    name.value = saved.name;
    weekStart.value = saved.weekStart;
    holidays.value = saved.holidays.join('\n');
    extraWorkdays.value = saved.extraWorkdays.join('\n');
    drawWeekdays(saved);
    drawProps();
  };
  const run = async (op) => {
    error.hidden = true;
    const result = await send([op], (message) => {
      error.textContent = message;
      error.hidden = false;
    });
    show();
    return result;
  };
  const save = (op) => run({ op: 'project', ...op });
  const dates = (field) => field.value.split(/[\s,]+/).filter(Boolean);
  name.addEventListener('change', () => save({ name: name.value }));
  weekStart.addEventListener('change', () => save({ weekStart: weekStart.value }));
  holidays.addEventListener('change', () => save({ holidays: dates(holidays) }));
  extraWorkdays.addEventListener('change', () => save({ extraWorkdays: dates(extraWorkdays) }));
  drawWeekdays(project);
  drawProps();
  ui.project.replaceChildren(
    h('div', { class: 'dh' }, h('span', { id: 'project-title' }, t('project.title')), h('button', { class: 'btn flat square', type: 'button', 'aria-label': t('dlg.close'), onclick: () => ui.project.close() }, '×')),
    h(
      'div',
      { class: 'db' },
      h(
        'div',
        { class: 'form', style: { padding: '0' } },
        labeled(t('project.name'), name),
        labeled(t('project.weekStart'), weekStart),
        h('div', { class: 'lbl' }, t('project.weeklyOff'), weekdays),
        labeled(t('project.holidays'), holidays),
        labeled(t('project.extraWorkdays'), extraWorkdays),
        h('div', { class: 'lbl props-section' }, t('project.props'), h('p', { class: 'hint' }, t('props.hint')), propsBox, addRow),
        error,
        h('p', { class: 'hint' }, t('project.hint')),
        h('div', { class: 'lbl' }, t('project.file'), h('span', { class: 'path' }, app.state.file.path)),
      ),
    ),
  );
  if (!ui.project.open) ui.project.showModal();
}

// ---- Versions -----------------------------------------------------------------------------------------------------

function openVersions() {
  renderVersions();
  if (!ui.versions.open) ui.versions.showModal();
}

function renderVersions() {
  const name = h('input', { type: 'text', maxlength: '200', placeholder: t('versions.namePlaceholder'), 'aria-label': t('versions.nameAria') });
  const list = app.state.versions.length
    ? h(
        'ul',
        { class: 'versions' },
        ...[...app.state.versions].reverse().map((version) =>
          h(
            'li',
            {},
            h('div', { class: 'info' }, h('div', { class: 'vname', title: version.name }, version.name), h('div', { class: 'vmeta' }, t('versions.meta', { date: new Date(version.createdAt).toLocaleString(getLocale()), count: version.taskCount }))),
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog(t('versions.restoreConfirm', { name: version.name }), t('versions.restore'))) {
                    await send([{ op: 'restore_version', id: version.id }]);
                    ui.versions.close();
                  }
                },
              },
              t('versions.restore'),
            ),
            h('button', { class: 'btn danger', type: 'button', 'aria-label': t('versions.deleteAria', { name: version.name }), onclick: () => send([{ op: 'delete_version', id: version.id }]) }, t('versions.delete')),
          ),
        ),
      )
    : h('p', { class: 'hint', style: { padding: '0' } }, t('versions.none'));
  ui.versions.replaceChildren(
    h('div', { class: 'dh' }, h('span', { id: 'versions-title' }, t('versions.title')), h('button', { class: 'btn flat square', type: 'button', 'aria-label': t('dlg.close'), onclick: () => ui.versions.close() }, '×')),
    h(
      'div',
      { class: 'db' },
      h(
        'form',
        {
          class: 'add',
          onsubmit: async (event) => {
            event.preventDefault();
            await send([{ op: 'save_version', ...(name.value.trim() ? { name: name.value.trim() } : {}) }]);
          },
        },
        name,
        h('button', { class: 'btn primary', type: 'submit' }, t('versions.save')),
      ),
      list,
    ),
  );
}

// ---- Keyboard and boot -------------------------------------------------------------------------------------------

ui.bl.addEventListener('keydown', (event) => {
  if (event.target !== ui.bl || !app.visible.length || event.ctrlKey || event.metaKey || event.altKey) return;
  const index = app.visible.findIndex((row) => row.id === app.selected);
  const go = (i) => {
    const row = app.visible[Math.max(0, Math.min(i, app.visible.length - 1))];
    select(row.id);
    ui.bl.querySelector(`[data-id="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
    revealTask(row.id);
  };
  const row = app.visible[index];
  switch (event.key) {
    case 'ArrowDown': go(index + 1); break;
    case 'ArrowUp': go(index < 0 ? 0 : index - 1); break;
    case 'Home': go(0); break;
    case 'End': go(app.visible.length - 1); break;
    case 'ArrowLeft': if (row?.summary && !taskById(row.id).collapsed) send([{ op: 'update', id: row.id, collapsed: true }]); break;
    case 'ArrowRight': if (row?.summary && taskById(row.id).collapsed) send([{ op: 'update', id: row.id, collapsed: false }]); break;
    case 'Enter': case 'F2': if (row) (app.listOpen ? startEdit(row.id) : showDetail(row.id)); break;
    case 'Delete': onDelete(); break;
    default: return;
  }
  event.preventDefault();
});

const isTyping = (el) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

document.addEventListener('keydown', (event) => {
  if (ui.editor.hidden || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    if (app.link) {
      cancelLink();
      event.preventDefault();
    } else if (app.selLink && !isTyping(event.target)) {
      clearLink();
    } else if (app.picked.size > 1 && !isTyping(event.target)) {
      pick(app.selected ? [app.selected] : [], app.selected);
    }
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && app.selLink && !isTyping(event.target)) {
    event.preventDefault();
    deleteLink();
    return;
  }
  if (isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  const command = (event.ctrlKey || event.metaKey) && !event.altKey;
  // Undo / redo (a text field keeps its own undo), duplicate, and moving the selected task up or down.
  if (command && key === 'z') {
    event.preventDefault();
    stepHistory(event.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (command && key === 'y') {
    event.preventDefault();
    stepHistory('redo');
    return;
  }
  if (command && key === 'd' && !event.shiftKey && app.picked.size) {
    event.preventDefault();
    duplicateTasks([...app.picked]);
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && app.picked.size === 1) {
    event.preventDefault();
    operate('shift', { direction: event.key === 'ArrowUp' ? 'up' : 'down' });
    return;
  }
  // Ctrl+Up / Ctrl+Down zoom in / out by a step, for the keyboard (Ctrl+scroll does the same with the pointer as the center).
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  zoomBy(event.key === 'ArrowUp' ? 1.25 : 0.8, null);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (app.panelH !== null) applyPanelHeight();
    if (app.sched && !ui.editor.hidden) renderChart();
  }, 120);
});

ui.today.append(icon('today'));
ui.today.addEventListener('click', scrollToToday);
ui.fit.append(icon('fit'));
ui.fit.addEventListener('click', fitAll);
wirePanelSplit();

applyLocale();
syncLocale();
buildToolbar();
try {
  applyState(await (await fetch('/api/state')).json());
} catch {
  toast(t('net.offline'), 'error');
}
new EventSource('/events').addEventListener('state', (event) => applyState(JSON.parse(event.data)));
