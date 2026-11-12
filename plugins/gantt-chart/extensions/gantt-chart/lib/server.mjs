import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALE_CHOICES, resolveLocale, setLocale, t } from './i18n.mjs';
import { ModelError, fail } from './model.mjs';
import { loadLocale, loadTheme, saveLocale, saveTheme } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const JS = 'text/javascript; charset=utf-8';
const FILES = {
  '/': [path.join(here, '..', 'assets', 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(here, '..', 'assets', 'app.js'), JS],
  '/style.css': [path.join(here, '..', 'assets', 'style.css'), 'text/css; charset=utf-8'],
  '/model.mjs': [path.join(here, 'model.mjs'), JS],
  '/i18n.mjs': [path.join(here, 'i18n.mjs'), JS],
  '/locales/ja.mjs': [path.join(here, 'locales', 'ja.mjs'), JS],
  '/locales/en.mjs': [path.join(here, 'locales', 'en.mjs'), JS],
  '/schema.json': [path.join(here, '..', 'schema', 'gantt-chart.schema.json'), 'application/schema+json; charset=utf-8'],
};
const MAX_BODY = 1024 * 1024;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const errorBody = (code, key) => ({ ok: false, error: { code, message: t(key) } });

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) fail('invalid_request', 'err.contentType');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) fail('invalid_request', 'err.tooLarge');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    body = null;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('invalid_request', 'err.notJsonObject');
  return body;
}

/** Serves the page and its JSON API for one chart on a loopback port. */
export async function startServer(chart, { log }) {
  const sockets = new Set();
  let port = 0;

  const serveEvents = (req, res) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    const send = (json) => res.write(`event: state\ndata: ${json}\n\n`);
    const off = chart.subscribe(send);
    send(JSON.stringify(chart.clientState()));
    const beat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      off();
      clearInterval(beat);
    });
  };

  const handle = async (req, res) => {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host ?? '')) return sendJson(res, 403, errorBody('forbidden', 'err.badHost'));
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === 'GET') {
      if (url.pathname === '/') {
        // Put the saved theme and language choice on <html> so the first paint already uses them.
        const [theme, locale] = await Promise.all([loadTheme(), loadLocale()]);
        const html = (await fs.readFile(FILES['/'][0], 'utf8')).replace('<html ', `<html data-theme="${theme}" data-locale="${locale}" `);
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': FILES['/'][1] });
        return res.end(html);
      }
      const asset = FILES[url.pathname];
      if (asset) {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': asset[1] });
        return res.end(await fs.readFile(asset[0]));
      }
      if (url.pathname === '/api/state') return sendJson(res, 200, chart.clientState());
      if (url.pathname === '/events') return serveEvents(req, res);
      if (url.pathname === '/api/export' && chart.doc) {
        const name = encodeURIComponent(path.basename(chart.file));
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${name}` });
        return res.end(chart.exportText());
      }
      return sendJson(res, 404, errorBody('not_found', 'err.notFound'));
    }

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedHosts.some((host) => origin === `http://${host}`)) return sendJson(res, 403, errorBody('forbidden', 'err.badOrigin'));
      const body = await readJson(req);
      if (url.pathname === '/api/ops') {
        const { results } = await chart.mutate(body.ops);
        return sendJson(res, 200, { ok: true, results, state: chart.clientState() });
      }
      if (url.pathname === '/api/undo' || url.pathname === '/api/redo') {
        const { label } = await chart.step(url.pathname === '/api/undo' ? 'undo' : 'redo');
        return sendJson(res, 200, { ok: true, label, state: chart.clientState() });
      }
      if (url.pathname === '/api/open') {
        if (body.path === null) await chart.closeFile();
        else await chart.openFile(body.path, { name: typeof body.name === 'string' ? body.name : undefined });
        return sendJson(res, 200, { ok: true, state: chart.clientState() });
      }
      if (url.pathname === '/api/select') {
        chart.select(body.id ?? null, body.ids);
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/theme') {
        await saveTheme(body.theme);
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/locale') {
        // `locale` is the choice ("auto" or a language); `resolved` is the language the page itself uses.
        // Messages that go back to the page and to the agent follow the same language.
        if (!LOCALE_CHOICES.includes(body.locale)) fail('invalid_request', 'err.badChoice', { name: 'locale', choices: LOCALE_CHOICES.join(' / ') });
        if ((await loadLocale()) !== body.locale) await saveLocale(body.locale);
        setLocale(body.locale === 'auto' ? resolveLocale(body.resolved) : body.locale);
        return sendJson(res, 200, { ok: true });
      }
    }
    return sendJson(res, 404, errorBody('not_found', 'err.notFound'));
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof ModelError) return sendJson(res, 400, { ok: false, error: { code: error.code, message: error.message } });
      log(`Request failed: ${error?.stack ?? error}`);
      return sendJson(res, 500, errorBody('internal_error', 'err.internal'));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}
