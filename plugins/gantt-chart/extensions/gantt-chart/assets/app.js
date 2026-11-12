import { COLORS, FIRST_DAY, dayOfWeek, formatDate, formatDuration, isSummary, makeCalendar, maxSlideEarlier, mondayOnOrBefore, parseDate, parseDuration, schedule, subtreeEnd, todayDay, ymd } from '/model.mjs';

const ROW_H = 28;
const LINK_LEG = 14;
const HEAD_H = 56;
const PPD = { day: 48, week: 18, month: 5 };
const MIN_DAYS = { day: 35, week: 140, month: 365 };
// The timeline never starts before the first Monday of 1970 or ends after 2200 (the range of dates the model accepts).
const MIN_START = FIRST_DAY;
const MAX_END = parseDate('2200-12-31');
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const COLOR_NAME = { none: 'なし', green: '緑', orange: 'オレンジ', red: '赤', purple: '紫', teal: '青緑', gray: 'グレー' };
const ZOOM_NAME = { day: '日', week: '週', month: '月' };
const THEME_NAME = { auto: '自動（OS に合わせる）', light: 'ライト', dark: 'ダーク' };
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
  sliders: 'M4 6h10M18 6h2M16 4v4M4 12h2M10 12h10M8 10v4M4 18h9M17 18h3M15 16v4',
  history: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
};
// Columns of the task list besides the name, in display order.
const COLS = {
  no: { label: '#', width: 36, align: 'right' },
  dur: { label: '期間', width: 56, align: 'right' },
  res: { label: '担当', width: 88 },
};
const COLS_WIDTH = Object.values(COLS).reduce((sum, col) => sum + col.width, 0);

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
  link: null,
  marquee: null,
  zoom: 'day',
  listOpen: false,
  detailOpen: false,
  editing: null,
  editText: '',
  drag: null,
  pendingRender: false,
  saving: 'saved',
  leftW: Math.max(240, Math.min(360, Math.round(window.innerWidth * 0.4))),
  panelKey: '',
  startKey: null,
  theme: document.documentElement.dataset.theme in THEME_NAME ? document.documentElement.dataset.theme : 'auto',
};

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['start', 'editor', 'topbar', 'toolbar', 'banner', 'scroller', 'grid', 'hl', 'ht', 'bl', 'bt', 'panel', 'status', 'project', 'versions', 'confirm', 'toast', 'tip'].map((id) => [id, $(id)]));
// Width of the task list in the scroller; the list is not shown by default.
const listW = () => (app.listOpen ? app.leftW : 0);

// ---- DOM helpers --------------------------------------------------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
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
function toast(message, kind = 'info') {
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 5000);
}

function confirmDialog(message, okLabel) {
  return new Promise((resolve) => {
    const dialog = ui.confirm;
    const done = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      h('div', { class: 'db' }, h('p', { id: 'confirm-text', style: { margin: '0' } }, message)),
      h('div', { class: 'df' }, h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'キャンセル'), h('button', { class: 'btn primary', type: 'button', onclick: () => done(true) }, okLabel)),
    );
    dialog.addEventListener('cancel', () => resolve(false), { once: true });
    dialog.showModal();
  });
}

// ---- Data access ----------------------------------------------------------------------------------------------

const tasks = () => app.state?.doc?.tasks ?? [];
const taskById = (id) => tasks().find((task) => task.id === id);
const rowById = (id) => app.sched?.byId.get(id);
const selectedRow = () => (app.selected ? rowById(app.selected) : undefined);

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('サーバーに接続できません。キャンバスを開き直してください。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `通信に失敗しました（${response.status}）`);
  return data;
}

/**
 * Sends edit operations; the server saves them and answers with the new state.
 * An error goes to onError when given (a modal dialog covers the toast), otherwise to the toast.
 */
async function send(ops, onError) {
  setSaving('saving');
  try {
    const data = await post('/api/ops', { ops });
    applyState(data.state);
    setSaving('saved');
    const moved = data.results.find((result) => result.adjusted?.start);
    if (moved) {
      toast(`先行タスクの終了後（${moved.adjusted.start}）が最も早い開始日のため、開始日を補正しました。`, 'info');
      app.panelKey = '';
      renderPanel();
    }
    return data.results;
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

function setSaving(value) {
  app.saving = value;
  const el = document.getElementById('save');
  if (el) {
    el.textContent = { saved: '保存済み', saving: '保存中…', error: '保存できませんでした' }[value];
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
      toast(`チャートを計算できません: ${error.message}`, 'error');
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
      h('h1', {}, 'ガントチャート'),
      h('p', { class: 'lead' }, 'チャートは JSON ファイル（例: plan.gantt.json）に保存されます。ファイルのパスを指定して開くか、存在しないパスを指定して新しく作成します。エージェントに「ガントチャートを作って」と頼むこともできます。'),
      h(
        'form',
        {
          onsubmit: (event) => {
            event.preventDefault();
            if (input.value.trim()) open(input.value.trim());
          },
        },
        h('label', { for: 'open-path' }, 'JSON ファイルのパス'),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, '開く（なければ作成）')),
      ),
      app.state.recent.length
        ? h(
            'div',
            {},
            h('h2', {}, '最近使ったファイル'),
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
  renderTop();
  try {
    await post('/api/theme', { theme });
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderTop() {
  const { file, doc } = app.state;
  ui.topbar.replaceChildren(
    h(
      'button',
      {
        class: 'btn flat tbtn',
        type: 'button',
        'aria-label': 'ファイル選択に戻る',
        title: 'ファイル選択に戻る',
        onclick: async () => {
          try {
            applyState((await post('/api/open', { path: null })).state);
          } catch (error) {
            toast(error.message, 'error');
          }
        },
      },
      '←',
      h('span', { class: 'label' }, 'ファイル選択'),
    ),
    h('div', { class: 'ttl' }, h('span', { class: 'title', title: doc.project.name || file.name }, doc.project.name || file.name), h('span', { class: 'file', title: file.path }, file.name)),
    h('span', { class: 'spacer' }),
    h('span', { id: 'save', class: 'save', 'aria-live': 'polite' }),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': '表示の単位' },
      ...Object.entries(ZOOM_NAME).map(([zoom, label]) =>
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            title: `${label}表示（Ctrl+↑ / Ctrl+↓ で日・週・月を切り替え）`,
            'aria-pressed': String(app.zoom === zoom),
            onclick: () => setZoom(zoom),
          },
          label,
        ),
      ),
    ),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': '表示テーマ' },
      ...Object.entries(THEME_NAME).map(([theme, label]) =>
        h('button', { class: 'btn square', type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(app.theme === theme), onclick: () => setTheme(theme) }, icon(THEME_ICON[theme])),
      ),
    ),
    h('button', { class: 'btn tbtn', type: 'button', title: 'プロジェクト設定（名前・休日）', 'aria-label': 'プロジェクト設定', onclick: openProject }, icon('sliders'), h('span', { class: 'label' }, 'プロジェクト')),
    h('button', { class: 'btn tbtn', type: 'button', title: 'バージョン', 'aria-label': 'バージョン', onclick: openVersions }, icon('history'), h('span', { class: 'label' }, 'バージョン')),
    h('a', { class: 'btn tbtn', href: '/api/export', download: file.name, target: '_blank', title: 'JSON エクスポート', 'aria-label': 'JSON エクスポート' }, icon('download'), h('span', { class: 'label' }, 'JSON エクスポート')),
  );
  setSaving(app.saving);
}

const ZOOMS = Object.keys(ZOOM_NAME);

function setZoom(zoom) {
  if (zoom === app.zoom) return;
  const viewport = ui.scroller.clientWidth - listW();
  const center = app.range ? app.range.start + (ui.scroller.scrollLeft + viewport / 2) / app.range.ppd : null;
  app.zoom = zoom;
  // Start the new range around the date at the center of the view, then put that date back in the middle.
  const margin = marginDays(PPD[zoom]);
  app.view = center === null ? null : { start: Math.floor(center) - margin, end: Math.ceil(center) + margin };
  renderTop();
  renderChart();
  if (center !== null) ui.scroller.scrollLeft = Math.max(0, (center - app.range.start) * app.range.ppd - viewport / 2);
}

function renderBanner() {
  const error = app.state.error;
  ui.banner.hidden = !error;
  ui.banner.textContent = error ? `ファイルを読み込めません: ${error.message} ファイルを直すと自動で読み込み直します。直るまで編集はできません。` : '';
}

function buildToolbar() {
  const button = (id, name, label, onclick) => h('button', { id, class: 'btn square', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
  const colorSelect = h(
    'select',
    {
      id: 'tb-color',
      'aria-label': '色ラベル',
      title: '色ラベル',
      onchange: (event) => {
        const row = selectedRow();
        if (row) send([{ op: 'update', id: row.id, color: event.target.value }]);
      },
    },
    ...COLORS.map((color) => h('option', { value: color }, COLOR_NAME[color])),
  );
  ui.toolbar.replaceChildren(
    h(
      'button',
      {
        id: 'tb-list',
        class: 'btn square',
        type: 'button',
        title: 'タスク一覧の表示 / 非表示',
        'aria-label': 'タスク一覧の表示 / 非表示',
        onclick: toggleList,
      },
      icon('sidebar'),
    ),
    h('span', { class: 'sep' }),
    button('tb-add', 'plus', 'タスクを追加', onAdd),
    button('tb-del', 'trash', 'タスクを削除', onDelete),
    h('span', { class: 'sep' }),
    button('tb-indent', 'indent', 'インデント（直前のタスクの子にする）', () => operate('indent')),
    button('tb-outdent', 'outdent', 'アウトデント', () => operate('outdent')),
    button('tb-up', 'up', '上へ移動', () => operate('shift', { direction: 'up' })),
    button('tb-down', 'down', '下へ移動', () => operate('shift', { direction: 'down' })),
    h('span', { class: 'sep' }),
    colorSelect,
  );
}

const clampLeftWidth = (width) => Math.max(COLS_WIDTH + 40, Math.min(width, 720, ui.scroller.clientWidth - 160));

// The list is drawn over the left of the scroller, so the first day in view stays the same either way.
function toggleList() {
  app.listOpen = !app.listOpen;
  if (!app.listOpen) app.editing = null;
  renderToolbar();
  renderChart();
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

function renderToolbar() {
  const list = tasks();
  // The operations act on one task; with several selected they wait until the selection is back to one.
  const row = app.picked.size > 1 ? undefined : selectedRow();
  const i = row ? row.index : -1;
  const set = (id, disabled) => {
    $(id).disabled = disabled;
  };
  set('tb-add', false);
  set('tb-del', !row);
  set('tb-indent', !row || i === 0 || list[i - 1].level < list[i].level);
  set('tb-outdent', !row || list[i].level === 0);
  set('tb-up', !row || !siblingExists(list, i, 'up'));
  set('tb-down', !row || !siblingExists(list, i, 'down'));
  const color = $('tb-color');
  color.disabled = !row;
  color.value = row ? list[i].color : 'none';
  $('tb-list').setAttribute('aria-pressed', String(app.listOpen));
}

async function onAdd() {
  const row = selectedRow();
  const results = await send([row ? { op: 'add', after: row.id } : { op: 'add' }]);
  const id = results?.[0]?.id;
  if (!id) return;
  select(id);
  if (app.listOpen) return startEdit(id);
  // Without the list the name is typed in the detail panel.
  showDetail(id);
  const input = ui.panel.querySelector('[data-field="name"]');
  input?.focus();
  input?.select();
}

async function onDelete() {
  const row = app.picked.size > 1 ? undefined : selectedRow();
  if (!row) return;
  const task = taskById(row.id);
  if (row.summary && !(await confirmDialog(`「${task.name}」と、その子タスクをすべて削除します。`, '削除'))) return;
  await send([{ op: 'delete', id: row.id }]);
}

async function operate(op, extra = {}) {
  const row = selectedRow();
  if (row) await send([{ op, id: row.id, ...extra }]);
}

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
  const ppd = PPD[app.zoom];
  const today = todayDay();
  const margin = marginDays(ppd);
  const first = rows.length ? Math.min(...rows.map((row) => row.startDay)) : today;
  const last = rows.length ? Math.max(...rows.map((row) => row.endDay)) : today;
  const view = app.view ?? { start: Infinity, end: -Infinity };
  const start = Math.max(MIN_START, mondayOnOrBefore(Math.min(view.start, first - margin)));
  const end = Math.min(MAX_END, Math.max(view.end, last + margin, start + MIN_DAYS[app.zoom] - 1));
  const days = Math.ceil((end - start + 1) / 7) * 7;
  app.view = { start, end: start + days - 1 };
  return { start, days, end: start + days - 1, ppd, width: days * ppd, today, first };
}

const monthStart = (y, m) => parseDate(`${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`);

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

/** Fills the scroller with grid lines even when there are few rows. */
function updateBodyMin() {
  ui.grid.style.setProperty('--body-min', `${Math.max(app.visible.length * ROW_H, ui.scroller.clientHeight - HEAD_H)}px`);
}

function renderChart() {
  if (!app.sched) return;
  const rows = app.sched.rows;
  app.visible = rows.filter((row) => !row.hidden);
  if (app.viewPath !== app.state.file.path) {
    app.view = null;
    app.viewPath = app.state.file.path;
  }
  const prev = app.range;
  const fresh = app.view === null;
  app.range = computeRange(rows);
  ui.grid.classList.toggle('nolist', !app.listOpen);
  ui.hl.hidden = !app.listOpen;
  ui.bl.hidden = !app.listOpen;
  ui.grid.style.setProperty('--leftW', `${app.leftW}px`);
  ui.grid.style.setProperty('--tlW', `${app.range.width}px`);
  updateBodyMin();
  renderTimelineHeader();
  if (app.listOpen) {
    renderLeftHeader();
    renderLeft();
  } else {
    ui.hl.replaceChildren();
    ui.bl.replaceChildren();
  }
  renderBody();
  const { start, ppd, first } = app.range;
  // The range grew to the left: shift the scroll position so the days in view stay where they were.
  if (prev && prev.ppd === ppd && prev.start !== start) ui.scroller.scrollLeft += (prev.start - start) * ppd;
  // A file just opened: show its first task rather than the empty margin before it.
  if (fresh) ui.scroller.scrollLeft = Math.max(0, (first - start - 7) * ppd);
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
  const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': '一覧の幅', tabindex: '0' });
  const resize = (width) => {
    app.leftW = clampLeftWidth(width);
    ui.grid.style.setProperty('--leftW', `${app.leftW}px`);
  };
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const x0 = event.clientX;
    const w0 = app.leftW;
    const move = (e) => resize(w0 + e.clientX - x0);
    const up = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      renderChart();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });
  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resize(app.leftW + (event.key === 'ArrowRight' ? 16 : -16));
    renderChart();
    ui.hl.querySelector('.splitter')?.focus();
  });
  const head = (key) => h('div', COLS[key].align ? { style: { textAlign: COLS[key].align } } : {}, COLS[key].label);
  ui.hl.replaceChildren(h('div', { class: 'cols' }, head('no'), h('div', {}, 'タスク名'), head('dur'), head('res')), splitter);
}

function renderTimelineHeader() {
  const { start, end, ppd } = app.range;
  const top = h('div', { class: 'hrow' });
  const bottom = h('div', { class: 'hrow' });
  const cell = (parent, from, to, text, cls = '', title = '') =>
    parent.append(h('div', { class: `hc ${cls}`.trim(), style: { left: `${(from - start) * ppd}px`, width: `${(to - from + 1) * ppd}px` }, title }, text));
  if (app.zoom === 'day') {
    for (let monday = start; monday <= end; monday += 7) {
      const a = ymd(monday);
      const b = ymd(monday + 6);
      cell(top, monday, monday + 6, `${a.y}年${a.m}月${a.d}日 – ${a.y === b.y ? '' : `${b.y}年`}${b.m}月${b.d}日`, 'grp');
    }
    for (let day = start; day <= end; day++) cell(bottom, day, day, `${ymd(day).d} (${WEEKDAY[dayOfWeek(day)]})`, app.cal.isWorkday(day) ? '' : 'off', formatDate(day));
  } else if (app.zoom === 'week') {
    for (const seg of monthSegments(start, end)) cell(top, seg.from, seg.to, `${seg.y}年${seg.m}月`, 'grp');
    for (let monday = start; monday <= end; monday += 7) cell(bottom, monday, monday + 6, `${ymd(monday).m}/${ymd(monday).d}`, '', formatDate(monday));
  } else {
    const months = monthSegments(start, end);
    for (let i = 0; i < months.length; ) {
      let j = i;
      while (j + 1 < months.length && months[j + 1].y === months[i].y) j++;
      cell(top, months[i].from, months[j].to, `${months[i].y}年`, 'grp');
      i = j + 1;
    }
    for (const seg of months) cell(bottom, seg.from, seg.to, `${seg.m}月`, '', `${seg.y}年${seg.m}月`);
  }
  ui.ht.replaceChildren(top, bottom);
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
          'aria-label': task.collapsed ? '展開' : '折りたたむ',
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
          'aria-label': 'タスク名',
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
      : h('span', { class: 'name', title: task.name }, task.name || '（名称なし）');
  const resources = task.resources.join(', ');
  const attrs = { class: `cols lrow${selected ? ' sel' : ''}${row.summary ? ' summary' : ''}`, role: 'row', 'aria-level': row.level + 1, 'aria-selected': String(selected), 'data-id': row.id };
  if (row.summary) attrs['aria-expanded'] = String(!task.collapsed);
  const el = h(
    'div',
    { ...attrs, onclick: (event) => clickTask(event, row.id), ondblclick: () => startEdit(row.id) },
    h('div', { class: 'c-no', role: 'gridcell' }, String(row.row)),
    h('div', { class: 'c-name', role: 'gridcell', style: { paddingLeft: `${6 + row.level * 16}px` } }, caret, name),
    h('div', { class: 'c-dur', role: 'gridcell' }, formatDuration(row.duration)),
    h('div', { class: 'c-res', role: 'gridcell', title: resources }, resources),
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
  if (!task) return;
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
  const named = !app.listOpen;
  const parts = [];
  const rowTop = new Map(app.visible.map((row, i) => [row.id, i * ROW_H]));
  app.rowTop = rowTop;

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
    parts.push(h('div', { class: 'today', title: `今日（${formatDate(today)}）`, style: { left: `${(today - start) * ppd + (app.zoom === 'day' ? ppd / 2 - 1 : 0)}px` } }));
  }

  for (const row of app.visible) {
    const task = taskById(row.id);
    const left = (row.startDay - start) * ppd;
    const width = (row.endDay - row.startDay + 1) * ppd;
    const top = rowTop.get(row.id);
    const percent = Math.round(row.progress);
    const label = `${task.name}: ${formatDate(row.startDay)} – ${formatDate(row.endDay)}（${formatDuration(row.duration)}）進捗 ${percent}%`;
    const selected = app.picked.has(row.id);
    if (row.summary) {
      const sbar = h('div', { class: `sbar${selected ? ' sel' : ''}`, 'data-id': row.id, role: 'img', 'aria-label': label, title: label, style: { left: `${left}px`, width: `${width}px`, top: `${top + (named ? 14 : 8)}px` } });
      wireBar(sbar, row);
      parts.push(sbar);
      if (named) parts.push(h('div', { class: 'sum-label', style: { left: `${left}px`, top: `${top + 1}px` } }, `${task.name}  ${percent}%`));
      else parts.push(h('div', { class: 'after-label', style: { left: `${left + width}px`, top: `${top + 5}px` } }, `${percent}%`));
      continue;
    }
    // Without the list the name goes inside the bar when it fits, otherwise after it.
    const inside = named ? width >= 80 : width >= 40 && app.zoom === 'day';
    const bar = h(
      'div',
      { class: `bar c-${task.color}${selected ? ' sel' : ''}`, 'data-id': row.id, role: 'img', 'aria-label': label, title: label, style: { left: `${left}px`, width: `${width}px`, top: `${top + 5}px` } },
      h('div', { class: 'fill', style: { width: `${percent}%` } }),
      inside ? h('span', { class: `pct${named ? ' named' : ''}` }, named ? `${task.name}  ${percent}%` : `${percent}%`) : null,
      h('div', { class: 'grip' }),
    );
    wireBar(bar, row);
    parts.push(bar);
    if (named ? !inside : !inside || app.zoom !== 'day') parts.push(h('div', { class: 'after-label', style: { left: `${left + width}px`, top: `${top + 5}px` } }, `${task.name}  ${percent}%`));
  }

  parts.push(linksLayer(rowTop));
  ui.bt.replaceChildren(...parts);
  updateSelection();
}

function linksLayer(rowTop) {
  const { start, ppd, width } = app.range;
  const svg = svgEl('svg', { class: 'links', width, height: Math.max(app.visible.length * ROW_H, 1), 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  // The head is drawn in its own color so that the arrows of the selected task can be highlighted (see updateSelection).
  for (const [id, cls] of [['arrow', 'head'], ['arrow-hi', 'head hi']]) {
    const marker = svgEl('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
    marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: cls }));
    defs.append(marker);
  }
  svg.append(defs);
  for (const row of app.visible) {
    for (const pred of taskById(row.id).predecessors) {
      const from = rowById(pred.task);
      if (!from || from.hidden) continue;
      const x1 = (from.endDay - start + 1) * ppd;
      const y1 = rowTop.get(from.id) + ROW_H / 2;
      const x2 = (row.startDay - start) * ppd;
      const y2 = rowTop.get(row.id) + ROW_H / 2;
      // The arrow head is about 8px long and covers the end of the line, so the last leg must be longer than that
      // or only the head is left.
      let d;
      if (x2 - x1 >= 6 + LINK_LEG) {
        d = `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`;
      } else {
        // Turn in the gap next to the target row, so the line never cuts through the bars between the two rows
        // and the links into one task merge into a single line.
        const ym = y2 > y1 ? y2 - ROW_H / 2 : y2 + ROW_H / 2;
        d = `M${x1},${y1} H${x1 + 6} V${ym} H${x2 - LINK_LEG} V${y2} H${x2}`;
      }
      svg.append(svgEl('path', { class: 'link', d, 'marker-end': 'url(#arrow)', 'data-from': from.id, 'data-to': row.id }));
    }
  }
  return svg;
}

// Highlights the arrows into and out of the selected task and fades the rest.
function updateLinks() {
  const svg = ui.bt.querySelector('.links');
  if (!svg) return;
  const related = [...svg.querySelectorAll('path.link')].filter((path) => app.picked.has(path.dataset.from) || app.picked.has(path.dataset.to));
  svg.classList.toggle('focus', related.length > 0);
  for (const path of svg.querySelectorAll('path.link')) {
    const on = related.includes(path);
    path.classList.toggle('rel', on);
    path.setAttribute('marker-end', on ? 'url(#arrow-hi)' : 'url(#arrow)');
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
  }
  updateLinks();
  renderConnectors();
}

/** Makes `ids` the selection; `primary` is the task the toolbar and the detail panel act on. */
function pick(ids, primary = ids[0] ?? null, { notify = true } = {}) {
  app.picked = new Set(ids);
  app.selected = primary;
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
function showDetail(id) {
  select(id);
  app.detailOpen = true;
  renderPanel();
}

function closeDetail() {
  app.detailOpen = false;
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
  const parts = [
    `タスク: ${project.count}`,
    `工数: ${project.effort === null ? '-' : `${project.effort}h`}`,
    `期間: ${project.count ? formatDuration(project.duration) : '-'}`,
    `進捗: ${project.count ? `${project.progress.toFixed(2)}%` : '-'}`,
  ];
  const row = selectedRow();
  if (app.picked.size > 1) parts.push(`${app.picked.size} 件を選択中`);
  else if (row) parts.push(`${taskById(row.id).name}  ${slash(row.startDay)} – ${slash(row.endDay)} (${formatDuration(row.duration)})`);
  ui.status.replaceChildren(...parts.map((text) => h('span', {}, text)));
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
    showDetail(row.id);
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
    collapse,
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
    if (drag.leaves.length > 1) note += `（${drag.leaves.length} 件を一緒に移動）`;
    if (limited) note += ' 先行タスクの終了後が下限';
  } else {
    drag.bar.style.width = `${Math.max(ppd, drag.width + drag.delta * ppd)}px`;
    ({ start, end } = resizeTarget(drag));
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
    else if (drag.collapse && !drag.moved) showDetail(drag.row.id);
  }
  if (ops) await send(ops);
  else if (app.sched) renderChart();
  if (app.pendingRender) {
    app.pendingRender = false;
    render();
  }
  growRange();
}

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
});

ui.bt.addEventListener('pointerup', endMarquee);
ui.bt.addEventListener('pointercancel', endMarquee);
ui.bt.addEventListener('pointerleave', () => {
  if (!app.link) ui.bt.querySelector('.conn')?.classList.remove('show');
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
    .filter((row, i) => i * ROW_H + 5 < bottom && i * ROW_H + 5 + 18 > top && (row.startDay - start) * ppd < right && (row.endDay + 1 - start) * ppd > left)
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

// The arrows at the top and left of the selected bar make this task the successor of the one they are dragged to;
// the arrows at the bottom and right make it the predecessor.
const LINK_DIRECTION = { top: 'in', left: 'in', bottom: 'out', right: 'out' };
const LINK_TITLE = {
  in: '先行タスクにつなぐ（別のタスクへドラッグ、またはクリックしてからタスクを選ぶ）',
  out: '後続タスクにつなぐ（別のタスクへドラッグ、またはクリックしてからタスクを選ぶ）',
};

function renderConnectors() {
  ui.bt.querySelector('.conn')?.remove();
  const row = app.picked.size === 1 ? selectedRow() : null;
  const el = row && ui.bt.querySelector(`[data-id="${row.id}"].bar, [data-id="${row.id}"].sbar`);
  if (!el) return;
  // A parent task takes its dates from its children, so it cannot follow another task.
  const sides = row.summary ? ['bottom', 'right'] : ['top', 'left', 'bottom', 'right'];
  ui.bt.append(
    h(
      'div',
      { class: `conn${app.link ? ' show' : ''}`, style: { left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px` } },
      ...sides.map((side) => h('button', { class: `conn-h conn-${side}`, type: 'button', tabindex: '-1', title: LINK_TITLE[LINK_DIRECTION[side]], 'aria-label': LINK_TITLE[LINK_DIRECTION[side]], onpointerdown: (event) => beginLink(event, row, side), onpointermove: updateLink, onpointerup: releaseLink, onpointercancel: cancelLink })),
    ),
  );
}

/** Shows the arrows while the pointer is near the selected bar. */
function revealConnectors(event) {
  const conn = ui.bt.querySelector('.conn');
  if (!conn || app.drag || app.marquee) return;
  const box = conn.getBoundingClientRect();
  const near = event.clientX > box.left - 22 && event.clientX < box.right + 22 && event.clientY > box.top - 20 && event.clientY < box.bottom + 20;
  conn.classList.toggle('show', near || Boolean(app.link));
}

function beginLink(event, row, side) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  cancelLink();
  event.currentTarget.setPointerCapture(event.pointerId);
  const el = ui.bt.querySelector(`[data-id="${row.id}"].bar, [data-id="${row.id}"].sbar`);
  const x = side === 'left' ? el.offsetLeft : side === 'right' ? el.offsetLeft + el.offsetWidth : el.offsetLeft + el.offsetWidth / 2;
  const y = side === 'top' ? el.offsetTop : side === 'bottom' ? el.offsetTop + el.offsetHeight : el.offsetTop + el.offsetHeight / 2;
  const line = svgEl('line', { x1: x, y1: y, x2: x, y2: y });
  const dot = svgEl('circle', { cx: x, cy: y, r: 4 });
  const svg = svgEl('svg', { class: 'rubber', width: ui.bt.offsetWidth, height: ui.bt.offsetHeight, 'aria-hidden': 'true' });
  svg.append(line, dot);
  ui.bt.append(svg);
  app.link = { id: row.id, dir: LINK_DIRECTION[side], x0: event.clientX, y0: event.clientY, moved: false, sticky: false, target: null, svg, line, dot };
  ui.bt.querySelector('.conn')?.classList.add('show');
}

/** Why `targetId` cannot be connected to the task being linked, or '' when it can. */
function linkProblem(targetId) {
  const link = app.link;
  if (targetId === link.id) return '自分自身にはつなげません。';
  const [pred, succ] = link.dir === 'out' ? [link.id, targetId] : [targetId, link.id];
  if (rowById(succ)?.summary) return '子タスクを持つタスクは、先行タスクを持てません（日付が子タスクから決まるため）。';
  if (taskById(succ).predecessors.some((item) => item.task === pred)) return 'すでにつながっています。';
  if (dependsOn(pred, succ)) return 'つなぐと先行タスクが循環します。';
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
  for (const el of ui.bt.querySelectorAll('.link-ok, .link-bad')) el.classList.remove('link-ok', 'link-bad');
  link.target = null;
  if (!over || over.dataset.id === link.id) return;
  const ok = !linkProblem(over.dataset.id);
  over.classList.add(ok ? 'link-ok' : 'link-bad');
  if (ok) link.target = over.dataset.id;
}

// Dragging an arrow onto a task connects them; clicking an arrow waits for the next click on a task.
function releaseLink(event) {
  const link = app.link;
  if (!link || link.sticky) return;
  updateLink(event);
  if (!link.moved) {
    link.sticky = true;
    toast('つなぎたいタスクをクリックしてください（Esc で取り消し）');
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
  for (const el of ui.bt.querySelectorAll('.link-ok, .link-bad')) el.classList.remove('link-ok', 'link-bad');
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

function renderPanel() {
  if (!app.sched || !app.state.file) return;
  const row = selectedRow();
  const several = app.picked.size > 1;
  const open = app.detailOpen && (several || Boolean(row));
  if (open === ui.panel.hidden) {
    ui.panel.hidden = !open;
    afterPanelToggle();
  }
  if (!open) {
    app.panelKey = '';
    return;
  }
  const brief = tasks().map((task) => [task.id, task.name]);
  const key = several ? JSON.stringify(['several', [...app.picked], brief]) : JSON.stringify([taskById(row.id), row.startDay, row.endDay, row.duration, row.progress, row.summary, row.row, brief, app.state.file.path]);
  if (key === app.panelKey) return;
  app.panelKey = key;

  const active = document.activeElement;
  const field = ui.panel.contains(active) ? active.getAttribute('data-field') : null;
  const caret = field && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scrollTop = ui.panel.querySelector('.pbody')?.scrollTop ?? 0;

  const close = h('button', { class: 'btn flat square', type: 'button', 'aria-label': '詳細を閉じる', title: '閉じる（Esc）', onclick: closeDetail }, '×');
  if (several) {
    const names = [...app.picked].map((id) => taskById(id)?.name).filter(Boolean);
    ui.panel.replaceChildren(
      h('div', { class: 'ph' }, h('span', { class: 'pt' }, `${names.length} 件のタスクを選択中`), close),
      h(
        'div',
        { class: 'pbody' },
        h('p', { class: 'hint' }, 'いずれかのバーをドラッグすると、選択中のタスクを相対位置のまま一緒に動かせます。Esc で選択を 1 件に戻します。'),
        h('ul', { class: 'picked' }, ...names.map((name) => h('li', {}, name))),
      ),
    );
    return;
  }

  const task = taskById(row.id);
  ui.panel.replaceChildren(h('div', { class: 'ph' }, h('span', { class: 'pt', title: task.name }, `#${row.row}  ${task.name}`), close), h('div', { class: 'pbody' }, taskForm(row)));
  ui.panel.querySelector('.pbody').scrollTop = scrollTop;

  if (field) {
    const el = ui.panel.querySelector(`[data-field="${field}"]`);
    if (el) {
      el.focus();
      if (caret && caret[0] !== null) el.setSelectionRange?.(caret[0], caret[1]);
    }
  }
}

ui.panel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
});

const labeled = (text, control, className) => h('label', className ? { class: className } : {}, text, control);

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
    disabled: parent,
    'data-field': 'progress',
    'aria-label': '進捗',
    oninput: (event) => {
      output.textContent = `${event.target.value}%`;
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
        'aria-label': `${label} のラグ（稼働日）`,
        onchange: (event) => commit({ predecessors: task.predecessors.map((item, j) => (j === i ? { task: item.task, lag: Math.trunc(Number(event.target.value)) || 0 } : item)) }),
      }),
      h('button', { class: 'btn flat square', type: 'button', 'aria-label': `先行タスク ${label} を外す`, onclick: () => commit({ predecessors: task.predecessors.filter((_, j) => j !== i) }) }, '×'),
    );
  });
  const candidates = tasks().filter((item) => item.id !== task.id && !task.predecessors.some((pred) => pred.task === item.id));
  const pick = h('select', { 'data-field': 'pred-pick', 'aria-label': '先行タスクを選択' }, h('option', { value: '' }, 'タスクを選択'), ...candidates.map((item) => h('option', { value: item.id }, `#${rowById(item.id).row} ${item.name}`)));
  const lag = h('input', { type: 'number', min: '0', max: '999', step: '1', value: '0', 'data-field': 'pred-lag', 'aria-label': '追加する先行タスクのラグ（稼働日）' });

  return h(
    'div',
    { class: 'form' },
    labeled(
      'タスク名',
      h('input', {
        type: 'text',
        value: task.name,
        maxlength: '200',
        'data-field': 'name',
        onchange: (event) => (event.target.value.trim() ? commit({ name: event.target.value }) : revert('タスク名は空にできません。')),
      }),
      'wide',
    ),
    h('div', { class: 'lbl' }, '進捗', h('div', { class: 'range' }, rangeInput, output)),
    labeled(
      '工数 (h)',
      h('input', {
        type: 'number',
        min: '0',
        step: '0.5',
        value: task.effort === null ? '' : String(task.effort),
        disabled: parent,
        'data-field': 'effort',
        onchange: (event) => (event.target.value === '' ? commit({ effort: null }) : Number(event.target.value) >= 0 ? commit({ effort: Number(event.target.value) }) : revert('工数は 0 以上の数値で入力してください。')),
      }),
    ),
    h(
      'div',
      { class: 'pair wide' },
      labeled('開始', h('input', { type: 'date', value: formatDate(row.startDay), disabled: parent, 'data-field': 'start', onchange: (event) => (event.target.value ? commit({ start: event.target.value }) : revert('開始日を入力してください。')) })),
      labeled('終了', h('input', { type: 'date', value: formatDate(row.endDay), disabled: parent, 'data-field': 'end', onchange: (event) => (event.target.value ? commit({ end: event.target.value }) : revert('終了日を入力してください。')) })),
    ),
    labeled(
      '期間（稼働日。例: 3d, 2w）',
      h('input', {
        type: 'text',
        value: formatDuration(row.duration),
        disabled: parent,
        'data-field': 'duration',
        onchange: (event) => (parseDuration(event.target.value) !== null ? commit({ duration: event.target.value }) : revert('期間は「3d」「2w」のように入力してください。')),
      }),
    ),
    parent ? h('p', { class: 'hint wide' }, '子タスクを持つタスクの日付・進捗・工数は、子タスクから自動で決まります。') : null,
    labeled('担当（カンマ区切り）', h('input', { type: 'text', value: task.resources.join(', '), 'data-field': 'resources', onchange: (event) => commit({ resources: event.target.value }) })),
    h(
      'div',
      { class: 'lbl wide' },
      '色ラベル',
      h('div', { class: 'swatches', role: 'group', 'aria-label': '色ラベル' }, ...COLORS.map((color) => h('button', { class: `swatch c-${color}`, type: 'button', 'aria-pressed': String(task.color === color), onclick: () => commit({ color }) }, h('i'), COLOR_NAME[color]))),
    ),
    parent
      ? null
      : h('div', { class: 'lbl wide' }, '先行タスク（終了の翌稼働日 + ラグ）', ...predecessors, h('div', { class: 'pred-add' }, pick, lag, h('button', { class: 'btn', type: 'button', onclick: () => pick.value && commit({ predecessors: [...task.predecessors, { task: pick.value, lag: Math.trunc(Number(lag.value)) || 0 }] }) }, '追加'))),
    labeled('メモ', h('textarea', { 'data-field': 'note', maxlength: '2000', onchange: (event) => commit({ note: event.target.value }) }, task.note), 'wide'),
  );
}

// ---- Project settings -----------------------------------------------------------------------------------------

function openProject() {
  const { project } = app.state.doc;
  const error = h('p', { class: 'err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', value: project.name, maxlength: '200', 'aria-label': 'プロジェクト名' });
  const holidays = h('textarea', { spellcheck: 'false', placeholder: '2026-11-23', 'aria-label': '休日' }, project.holidays.join('\n'));
  // Shows what was saved (the server trims and sorts), or what is still saved when the edit was refused.
  const show = () => {
    const saved = app.state.doc.project;
    name.value = saved.name;
    holidays.value = saved.holidays.join('\n');
  };
  const save = async (op) => {
    error.hidden = true;
    await send([{ op: 'project', ...op }], (message) => {
      error.textContent = message;
      error.hidden = false;
    });
    show();
  };
  name.addEventListener('change', () => save({ name: name.value }));
  holidays.addEventListener('change', () => save({ holidays: holidays.value.split(/[\s,]+/).filter(Boolean) }));
  ui.project.replaceChildren(
    h('div', { class: 'dh' }, h('span', { id: 'project-title' }, 'プロジェクト設定'), h('button', { class: 'btn flat square', type: 'button', 'aria-label': '閉じる', onclick: () => ui.project.close() }, '×')),
    h(
      'div',
      { class: 'db' },
      h('div', { class: 'form', style: { padding: '0' } }, labeled('プロジェクト名', name), labeled('休日（1 行に 1 日、YYYY-MM-DD）', holidays), error, h('p', { class: 'hint' }, '土曜と日曜は休みです。期間は稼働日（土日と休日を除く日）で数えます。'), h('div', { class: 'lbl' }, 'ファイル', h('span', { class: 'path' }, app.state.file.path))),
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
  const name = h('input', { type: 'text', maxlength: '200', placeholder: '名前（省略すると日時）', 'aria-label': 'バージョンの名前' });
  const list = app.state.versions.length
    ? h(
        'ul',
        { class: 'versions' },
        ...[...app.state.versions].reverse().map((version) =>
          h(
            'li',
            {},
            h('div', { class: 'info' }, h('div', { class: 'vname', title: version.name }, version.name), h('div', { class: 'vmeta' }, `${new Date(version.createdAt).toLocaleString('ja-JP')} ・ ${version.taskCount} タスク`)),
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async () => {
                  if (await confirmDialog(`「${version.name}」の状態に戻します。現在の状態は「復元前（自動）」として残ります。`, '復元')) {
                    await send([{ op: 'restore', id: version.id }]);
                    ui.versions.close();
                  }
                },
              },
              '復元',
            ),
            h('button', { class: 'btn danger', type: 'button', 'aria-label': `${version.name} を削除`, onclick: () => send([{ op: 'delete_snapshot', id: version.id }]) }, '削除'),
          ),
        ),
      )
    : h('p', { class: 'hint', style: { padding: '0' } }, '保存したバージョンはまだありません。');
  ui.versions.replaceChildren(
    h('div', { class: 'dh' }, h('span', { id: 'versions-title' }, 'バージョン'), h('button', { class: 'btn flat square', type: 'button', 'aria-label': '閉じる', onclick: () => ui.versions.close() }, '×')),
    h(
      'div',
      { class: 'db' },
      h(
        'form',
        {
          class: 'add',
          onsubmit: async (event) => {
            event.preventDefault();
            await send([{ op: 'snapshot', ...(name.value.trim() ? { name: name.value.trim() } : {}) }]);
          },
        },
        name,
        h('button', { class: 'btn primary', type: 'submit' }, '現在の状態を保存'),
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
  };
  const row = app.visible[index];
  switch (event.key) {
    case 'ArrowDown': go(index + 1); break;
    case 'ArrowUp': go(index < 0 ? 0 : index - 1); break;
    case 'Home': go(0); break;
    case 'End': go(app.visible.length - 1); break;
    case 'ArrowLeft': if (row?.summary && !taskById(row.id).collapsed) send([{ op: 'update', id: row.id, collapsed: true }]); break;
    case 'ArrowRight': if (row?.summary && taskById(row.id).collapsed) send([{ op: 'update', id: row.id, collapsed: false }]); break;
    case 'Enter': case 'F2': if (row) startEdit(row.id); break;
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
    } else if (app.picked.size > 1 && !isTyping(event.target)) {
      pick(app.selected ? [app.selected] : [], app.selected);
    }
    return;
  }
  // Ctrl+Up zooms in (day), Ctrl+Down zooms out (month).
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || isTyping(event.target)) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const next = ZOOMS[Math.max(0, Math.min(ZOOMS.indexOf(app.zoom) + (event.key === 'ArrowDown' ? 1 : -1), ZOOMS.length - 1))];
  setZoom(next);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => app.sched && !ui.editor.hidden && renderChart(), 120);
});

buildToolbar();
try {
  applyState(await (await fetch('/api/state')).json());
} catch {
  toast('サーバーに接続できません。キャンバスを開き直してください。', 'error');
}
new EventSource('/events').addEventListener('state', (event) => applyState(JSON.parse(event.data)));
