const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { disposeSource } = require('./renderer');
const { GUID } = require('./language-service');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) request.destroy(new Error('CDP 响应过大'));
      });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('CDP 不可用');
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(2500, () => request.destroy(new Error('CDP 连接超时')));
  });
}

function validTarget(target, port) {
  try {
    const socket = new URL(target.webSocketDebuggerUrl);
    const page = new URL(target.url);
    const localPage = ['file:', 'vscode-file:', 'app:'].includes(page.protocol)
      || (['http:', 'https:'].includes(page.protocol) && LOOPBACK.has(page.hostname));
    return target.type === 'page' && localPage && socket.protocol === 'ws:'
      && LOOPBACK.has(socket.hostname) && Number(socket.port) === port;
  } catch { return false; }
}

class CdpConnection {
  constructor(url, onEvent = () => {}) {
    this.url = url;
    this.onEvent = onEvent;
    this.pending = new Map();
    this.sequence = 0;
    this.contexts = new Set();
  }

  async open() {
    this.socket = new WebSocket(this.url, { handshakeTimeout: 3000, maxPayload: 4 * 1024 * 1024 });
    this.socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.id) {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message));
          else request.resolve(message.result || {});
        } else this.onEvent(message, this);
      } catch { /* Ignore malformed or unrelated renderer messages. */ }
    });
    this.socket.on('close', () => this.rejectPending());
    this.socket.on('error', () => this.rejectPending());
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
      this.socket.once('close', () => reject(new Error('CDP 已断开')));
    });
    return this;
  }

  command(method, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP 已断开'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时: ${method}`));
      }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP 已断开'));
    }
    this.pending.clear();
  }
  close() { this.rejectPending(); this.socket?.terminate(); }
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
}

class CdpHub {
  constructor({ port = 9333, profile, source, onStatus = () => {}, onMetrics, onStop = () => {}, discover }) {
    Object.assign(this, { port, profile, source, onStatus, onMetrics, onStop });
    this.binding = '__easyagReport_' + randomUUID().replaceAll('-', '');
    this.discover = discover || (() => this.findTargets());
    this.sessions = new Map();
    this.running = false;
    this.pendingConnections = new Set();
    this.orphanScripts = new Map();
    this.status = { cdpTargets: 0, cdpSockets: 0, injectCount: 0, lastInjectAt: 0, cdpError: '', cdpLoopRunning: false };
  }

  async findTargets() {
    let port = this.port;
    if (this.profile) {
      try {
        const found = Number(fs.readFileSync(path.join(this.profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
        if (Number.isInteger(found) && found > 0 && found <= 65535) port = found;
      } catch { /* Launches with an explicit debug port do not always write this file. */ }
    }
    let targets;
    try { targets = await getJson(`http://127.0.0.1:${port}/json/list`); }
    catch (error) {
      if (port === this.port) throw error;
      port = this.port;
      targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    }
    if (!Array.isArray(targets)) throw new Error('无效的 CDP 页面列表');
    return targets.filter(target => validTarget(target, port));
  }

  event(message, connection) {
    const params = message.params || {};
    if (message.method === 'Runtime.executionContextCreated') {
      if (params.context?.auxData?.isDefault && params.context.auxData.frameId === connection.frame) connection.contexts.add(params.context.id);
    } else if (message.method === 'Runtime.executionContextsCleared') connection.contexts.clear();
    else if (message.method === 'Runtime.executionContextDestroyed') connection.contexts.delete(params.executionContextId);
    else if (message.method === 'Runtime.bindingCalled' && params.name === this.binding
      && connection.contexts.has(params.executionContextId) && this.running && params.payload?.length < 20000) {
      try {
        const event = JSON.parse(params.payload);
        if (event.type === 'context-metrics' && this.onMetrics && GUID.test(event.conversationId)
          && typeof event.requestId === 'string' && /^\d{1,10}$/.test(event.requestId)) {
          void this.metrics(connection, params.executionContextId, event);
        }
      } catch { /* The bridge accepts only bounded metric requests. */ }
    }
  }

  async metrics(connection, contextId, event) {
    if (connection.metricsBusy || Date.now() - (connection.metricsAt || 0) < 1200) return;
    connection.metricsBusy = true;
    connection.metricsAt = Date.now();
    const generation = connection.injectGeneration;
    try {
      const location = await connection.command('Runtime.evaluate', { expression: 'location.href', contextId, returnByValue: true });
      const href = location.result?.value;
      if (!this.running || !connection.contexts.has(contextId) || !validTarget({ type: 'page', url: href,
        webSocketDebuggerUrl: connection.url }, Number(new URL(connection.url).port))) return;
      const page = new URL(href), initial = new URL(connection.pageUrl);
      if (page.origin !== initial.origin || page.protocol !== initial.protocol
        || page.pathname.match(/\/c\/([^/]+)/)?.[1]?.toLowerCase() !== event.conversationId.toLowerCase()) return;
      const result = await this.onMetrics(event.conversationId.toLowerCase());
      if (!this.running || generation !== connection.injectGeneration || !connection.contexts.has(contextId)) return;
      const payload = JSON.stringify(result);
      if (payload.length > 8192) return;
      await connection.command('Runtime.evaluate', { contextId,
        expression: `if (location.href === ${JSON.stringify(href)}) window.__easyagContext?.receive(${JSON.stringify(event.requestId)}, ${payload});` });
    } catch { /* Stats are optional; never interrupt localization. */ }
    finally { connection.metricsBusy = false; }
  }

  async inject(connection) {
    if (!this.running) throw new Error('CDP 已停止');
    const source = this.source(this.binding);
    connection.injectGeneration = (connection.injectGeneration || 0) + 1;
    if (connection.script) await connection.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: connection.script });
    connection.script = (await connection.command('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
    if (!this.running) throw new Error('CDP 已停止');
    const result = await connection.command('Runtime.evaluate', { expression: source });
    if (result.exceptionDetails) throw new Error('AG 页面组件初始化失败');
    this.status.injectCount++;
    this.status.lastInjectAt = Date.now();
  }

  async attach(target) {
    const connection = new CdpConnection(target.webSocketDebuggerUrl, (event, socket) => this.event(event, socket));
    connection.pageUrl = target.url;
    this.pendingConnections.add(connection);
    try {
      await connection.open();
      if (!this.running) throw new Error('CDP 已停止');
      const tree = await connection.command('Page.getFrameTree');
      connection.frame = tree.frameTree?.frame?.id;
      if (!connection.frame) throw new Error('未找到 AG 主页面');
      await connection.command('Runtime.enable');
      await connection.command('Page.enable');
      for (const identifier of this.orphanScripts.get(connection.url) || []) {
        try { await connection.command('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
        catch { /* A re-created page may already have dropped its former preload. */ }
      }
      this.orphanScripts.delete(connection.url);
      await connection.command('Runtime.addBinding', { name: this.binding });
      await this.inject(connection);
      if (!this.running) throw new Error('CDP 已停止');
      return connection;
    } catch (error) {
      await this.detach(connection);
      throw error;
    } finally { this.pendingConnections.delete(connection); }
  }

  tick() {
    if (!this.running || this.busy) return this.tickPromise || Promise.resolve();
    this.tickPromise = this.runTick();
    return this.tickPromise;
  }

  async runTick() {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      const targets = await this.discover();
      if (!this.running) return;
      this.status.cdpTargets = targets.length;
      const active = new Set(targets.map(target => target.webSocketDebuggerUrl));
      for (const [url, connection] of this.sessions) {
        if (!active.has(url) || !connection.connected) {
          await this.detach(connection);
          this.sessions.delete(url);
        }
      }
      for (const target of targets) {
        if (!this.running) break;
        if (!this.sessions.has(target.webSocketDebuggerUrl)) {
          this.sessions.set(target.webSocketDebuggerUrl, await this.attach(target));
        }
      }
      this.status.cdpError = targets.length ? '' : '等待 AG 页面';
    } catch (error) {
      this.status.cdpError = error.message;
    } finally {
      this.busy = false;
      this.status.cdpSockets = [...this.sessions.values()].filter(connection => connection.connected).length;
      this.onStatus({ ...this.status });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.status.cdpLoopRunning = true;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 2000);
    this.timer.unref();
  }

  async refresh() {
    for (const connection of this.sessions.values()) {
      try { await this.inject(connection); }
      catch (error) { this.status.cdpError = error.message; connection.close(); }
    }
  }

  async detach(connection) {
    let removed = false;
    try {
      await connection.command('Runtime.evaluate', { expression: disposeSource });
      if (connection.script) await connection.command('Page.removeScriptToEvaluateOnNewDocument', { identifier: connection.script });
      removed = true;
      await connection.command('Runtime.removeBinding', { name: this.binding });
    } catch { /* Renderer exit already releases its document. */ }
    if (!removed && connection.script) {
      const scripts = this.orphanScripts.get(connection.url) || new Set();
      scripts.add(connection.script);
      this.orphanScripts.set(connection.url, scripts);
    }
    connection.close();
  }

  async stop() {
    this.running = false;
    this.onStop();
    clearInterval(this.timer);
    for (const connection of this.pendingConnections) if (!connection.connected) connection.close();
    await this.tickPromise;
    await Promise.allSettled([...this.sessions.values()].map(connection => this.detach(connection)));
    this.sessions.clear();
    Object.assign(this.status, { cdpTargets: 0, cdpSockets: 0, cdpLoopRunning: false });
    this.onStatus({ ...this.status });
  }
}

module.exports = { CdpConnection, CdpHub, validTarget, getJson };
