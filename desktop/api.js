const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { compilePilotPermissions } = require('../features/pilot-permissions');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('请求内容过大');
  }
  return body ? JSON.parse(body) : {};
}

function serveFile(response, base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) return json(response, { ok: false, error: '无效路径' }, 403);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return json(response, { ok: false, error: '文件不存在' }, 404);
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  const stream = fs.createReadStream(target);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

function createApi(app) {
  const streams = new Map();
  let reviewFocus;
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) {
        return json(response, { ok: false, error: '无效的本地请求' }, 403);
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const route = url.pathname;
      const method = request.method;
      const origin = request.headers.origin;
      const capsuleRoute = ['/api/focus-ag', '/api/capsule/hide'].includes(route);
      const nativeOrigin = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(origin);
      if (method !== 'GET' && origin && origin !== `http://${host}` && !(capsuleRoute && nativeOrigin)) {
        return json(response, { ok: false, error: '不允许跨站修改设置' }, 403);
      }
      if (method === 'GET' && route === '/') return serveFile(response, app.rootDir, 'index.html');
      if (method === 'GET' && route === '/capsule.html') return serveFile(response, app.rootDir, 'src/capsule.html');
      if (method === 'GET' && (route.startsWith('/ui/') || route.startsWith('/assets/'))) {
        const directory = route.startsWith('/ui/') ? 'ui' : 'assets';
        return serveFile(response, path.join(app.rootDir, directory), decodeURIComponent(route.slice(directory.length + 2)));
      }
      if (method === 'GET' && route === '/api/ping') { response.end('pong'); return; }
      if (method === 'GET' && route === '/api/status') return json(response, app.status());
      if (method === 'GET' && route === '/api/logs') {
        const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
        return json(response, app.events.logs(Number.isFinite(limit) ? limit : 100));
      }
      if (method === 'GET' && route === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        response.write(': connected\n\n');
        const send = item => {
          if (response.destroyed) return;
          if (!response.write(`data: ${JSON.stringify(item)}\n\n`)) response.destroy();
        };
        app.events.on('message', send);
        streams.set(response, send);
        response.on('close', () => { app.events.off('message', send); streams.delete(response); });
        return;
      }
      if (method === 'GET' && route === '/api/danger-rules') {
        return json(response, { ...app.rules.document, active: app.rules.active.length });
      }
      if (method === 'GET' && route === '/api/kb') {
        return json(response, { count: app.rules.knowledge.length, rules: app.rules.knowledge.map(({ id, name, severity, category, root_cause, destructive_impact, safe_alternative }) => ({ id, name, severity, category, root_cause, destructive_impact, safe_alternative })) });
      }
      if (method === 'GET' && route === '/api/injected') return json(response, app.permissions.status());
      if (method === 'POST' && route === '/api/config') {
        const data = await readBody(request);
        await app.configure(data);
        return json(response, { ok: true, settings: app.settings.get() });
      }
      if (method === 'POST' && route === '/api/launch') {
        const result = await app.session.launch();
        return json(response, result, result.ok ? 200 : 409);
      }
      if (method === 'POST' && route === '/api/danger-rules/reload') {
        const result = app.reloadRules();
        return json(response, result, result.ok ? 200 : 409);
      }
      if (method === 'POST' && route === '/api/danger-rules/open') {
        app.host.open(app.rules.file, { text: true });
        return json(response, { ok: true, path: app.rules.file });
      }
      if (method === 'POST' && ['/api/danger-rules/sync', '/api/pilot/global'].includes(route)) {
        if (['running', 'preparing', 'launching'].includes(app.session.phase)) {
          return json(response, { ok: false, error: '请先退出 AG，再应用权限规则' }, 409);
        }
        const data = await readBody(request);
        if (data.scope && data.scope !== 'global') throw new Error('当前仅支持桌面端全局权限规则');
        app.rules.reload();
        const result = app.permissions.apply(compilePilotPermissions(app.rules, app.settings.get().protectionLevel, data.list));
        return json(response, result, result.ok ? 200 : 400);
      }
      if (method === 'POST' && route === '/api/danger-rules/cleanup') {
        const result = app.permissions.restore();
        return json(response, result, result.ok ? 200 : 409);
      }
      if (method === 'POST' && route === '/api/hide') { app.host.hide(); return json(response, { ok: true }); }
      if (method === 'POST' && route === '/api/capsule/hide') { app.notifications.hide(); return json(response, { ok: true }); }
      if (method === 'POST' && route === '/api/focus-ag') {
        if (!reviewFocus) reviewFocus = (async () => {
          app.notifications.hide();
          // Native hide is delivered asynchronously over stdout. Let the
          // capsule release foreground before activating AG, never synthesize input.
          await new Promise(resolve => setTimeout(resolve, 180));
          if (app.session.closed) return { ok: false, error: 'EasyAG 正在退出' };
          let focused;
          if (process.platform === 'win32' || process.platform === 'darwin') {
            focused = await app.host.focus(app.session.child?.pid);
          } else {
            await app.cdp.focus();
            focused = true;
          }
          app.events.log('SYSTEM', focused ? '胶囊已隐藏，已请求激活 AG 原生窗口'
            : 'AG 窗口激活失败，请手动切回 AG 审查；未执行任何审批', focused ? 'tag-proxy' : 'tag-warn');
          return focused ? { ok: true } : { ok: false, error: '无法激活 AG 窗口，请手动切回 AG' };
        })();
        const pending = reviewFocus;
        try {
          const result = await pending;
          return json(response, result, result.ok ? 200 : 409);
        } finally {
          if (reviewFocus === pending) reviewFocus = null;
        }
      }
      if (method === 'POST' && route === '/api/quit') {
        json(response, { ok: true });
        void app.close('收到退出请求');
        return;
      }
      return json(response, { ok: false, error: 'not found', url: request.url }, 404);
    } catch (error) {
      app.events.log('SYSTEM', error.message, 'tag-warn');
      if (!response.headersSent) json(response, { ok: false, error: error.message }, 400);
      else response.end();
    }
  });
  return {
    server,
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
      });
    },
    close() {
      for (const [response, send] of streams) {
        app.events.off('message', send);
        response.end();
      }
      streams.clear();
      server.close();
      server.closeIdleConnections();
    }
  };
}

module.exports = { createApi, readBody };
