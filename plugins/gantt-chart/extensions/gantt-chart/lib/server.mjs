import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelError } from './model.mjs';
import { loadTheme, saveTheme } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = {
  '/': [path.join(here, '..', 'assets', 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(here, '..', 'assets', 'app.js'), 'text/javascript; charset=utf-8'],
  '/style.css': [path.join(here, '..', 'assets', 'style.css'), 'text/css; charset=utf-8'],
  '/model.mjs': [path.join(here, 'model.mjs'), 'text/javascript; charset=utf-8'],
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

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new ModelError('invalid_request', 'Content-Type は application/json にしてください。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ModelError('invalid_request', 'リクエストが大きすぎます。');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new ModelError('invalid_request', 'リクエストが JSON オブジェクトではありません。');
  }
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
    if (!allowedHosts.includes(req.headers.host ?? '')) return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Host が不正です。' } });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === 'GET') {
      if (url.pathname === '/') {
        // Put the saved theme on <html> so the first paint already uses it.
        const html = (await fs.readFile(FILES['/'][0], 'utf8')).replace('<html ', `<html data-theme="${await loadTheme()}" `);
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
      return sendJson(res, 404, { ok: false, error: { code: 'not_found', message: '見つかりません。' } });
    }

    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== undefined && !allowedHosts.some((host) => origin === `http://${host}`)) {
        return sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'Origin が不正です。' } });
      }
      const body = await readJson(req);
      if (url.pathname === '/api/ops') {
        const { results } = await chart.mutate(body.ops);
        return sendJson(res, 200, { ok: true, results, state: chart.clientState() });
      }
      if (url.pathname === '/api/open') {
        if (body.path === null) await chart.closeFile();
        else await chart.openFile(body.path, { name: typeof body.name === 'string' ? body.name : undefined });
        return sendJson(res, 200, { ok: true, state: chart.clientState() });
      }
      if (url.pathname === '/api/select') {
        chart.select(body.id ?? null);
        return sendJson(res, 200, { ok: true });
      }
      if (url.pathname === '/api/theme') {
        await saveTheme(body.theme);
        return sendJson(res, 200, { ok: true });
      }
    }
    return sendJson(res, 404, { ok: false, error: { code: 'not_found', message: '見つかりません。' } });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (error instanceof ModelError) return sendJson(res, 400, { ok: false, error: { code: error.code, message: error.message } });
      log(`リクエストの処理に失敗しました: ${error?.stack ?? error}`);
      return sendJson(res, 500, { ok: false, error: { code: 'internal_error', message: '内部エラーが発生しました。' } });
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
