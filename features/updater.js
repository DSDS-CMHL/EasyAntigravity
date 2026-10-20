const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { createHash } = require('node:crypto');
const { readJson, writeJson } = require('../core/storage');
const { DICT_FILES } = require('./i18n');

const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/DSDS-CMHL/EasyAntigravity/main/update-manifest.json';
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_RUNTIME_PREFIXES = ['core/', 'features/', 'adapters/', 'desktop/', 'ui/', 'dicts/'];
const ALLOWED_RUNTIME_ROOT_FILES = new Set(['server.js', 'index.html']);

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toLowerCase();
}

function compareVersions(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).split(/[.-]/).map(part => Number.isFinite(Number(part)) ? Number(part) : part);
  const pb = String(b).split(/[.-]/).map(part => Number.isFinite(Number(part)) ? Number(part) : part);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va === vb) continue;
    if (typeof va === 'number' && typeof vb === 'number') return va > vb ? 1 : -1;
    return String(va).localeCompare(String(vb));
  }
  return 0;
}

function isAllowedRuntimePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.includes('..')) {
    return false;
  }
  if (ALLOWED_RUNTIME_ROOT_FILES.has(relativePath)) return true;
  if (!ALLOWED_RUNTIME_PREFIXES.some(prefix => relativePath.startsWith(prefix))) return false;
  return /\.(?:js|cjs|json|css|html)$/i.test(relativePath);
}

function readStreamBounded(stream, maxBytes = MAX_DOWNLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy(new Error('更新文件体积超出安全上限'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function requestDirect(targetUrl, timeoutMs = 10000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { timeout: timeoutMs, headers: { 'User-Agent': 'EasyAntigravity-Updater/4.0' } }, async res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        try {
          resolve(await requestDirect(new URL(res.headers.location, parsed).toString(), timeoutMs, redirects - 1));
        } catch (err) { reject(err); }
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`更新源响应异常 (${res.statusCode})`));
        return;
      }
      try { resolve(await readStreamBounded(res)); }
      catch (err) { reject(err); }
    });
    req.on('timeout', () => req.destroy(new Error('连接更新源超时')));
    req.on('error', reject);
  });
}

function requestViaHttpProxy(targetUrl, proxyPort, timeoutMs = 10000, redirects = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === 'http:') {
      const req = http.request({
        hostname: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: parsed.toString(),
        timeout: timeoutMs,
        headers: { Host: parsed.host, 'User-Agent': 'EasyAntigravity-Updater/4.0' }
      }, async res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          try {
            resolve(await requestViaHttpProxy(new URL(res.headers.location, parsed).toString(), proxyPort, timeoutMs, redirects - 1));
          } catch (err) { reject(err); }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`更新源响应异常 (${res.statusCode})`));
          return;
        }
        try { resolve(await readStreamBounded(res)); }
        catch (err) { reject(err); }
      });
      req.on('timeout', () => req.destroy(new Error('本地代理请求超时')));
      req.on('error', reject);
      req.end();
      return;
    }

    const connectReq = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${parsed.hostname}:${parsed.port || 443}`,
      timeout: timeoutMs
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理隧道握手失败 (${res.statusCode})`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: parsed.hostname });
      const req = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        createConnection: () => tlsSocket,
        timeout: timeoutMs,
        headers: { Host: parsed.host, 'User-Agent': 'EasyAntigravity-Updater/4.0', Connection: 'close' }
      }, async httpsRes => {
        if ([301, 302, 307, 308].includes(httpsRes.statusCode) && httpsRes.headers.location && redirects > 0) {
          httpsRes.resume();
          try {
            resolve(await requestViaHttpProxy(new URL(httpsRes.headers.location, parsed).toString(), proxyPort, timeoutMs, redirects - 1));
          } catch (err) { reject(err); }
          return;
        }
        if (httpsRes.statusCode !== 200) {
          httpsRes.resume();
          reject(new Error(`更新源响应异常 (${httpsRes.statusCode})`));
          return;
        }
        try { resolve(await readStreamBounded(httpsRes)); }
        catch (err) { reject(err); }
      });
      req.on('timeout', () => req.destroy(new Error('HTTPS 更新下载超时')));
      req.on('error', reject);
      req.end();
    });
    connectReq.on('timeout', () => connectReq.destroy(new Error('连接本地代理端口超时')));
    connectReq.on('error', reject);
    connectReq.end();
  });
}

async function fetchBuffer(targetUrl, proxyPort) {
  const parsed = new URL(targetUrl);
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!isLoopback && Number.isInteger(proxyPort) && proxyPort > 0 && proxyPort <= 65535) {
    try {
      return await requestViaHttpProxy(targetUrl, proxyPort);
    } catch {
      // Fall back to direct connection if local proxy is not listening yet.
    }
  }
  return requestDirect(targetUrl);
}

function resolveRuntimeRoot(bundledRoot, dataDir) {
  if (!dataDir || process.env.EASYAG_DISABLE_OVERLAY === '1') return bundledRoot;
  try {
    const bundledPkg = readJson(path.join(bundledRoot, 'package.json'), { version: '0.0.0' });
    const overlayDir = path.join(dataDir, 'runtime', 'current');
    const overlayMeta = readJson(path.join(overlayDir, 'overlay-meta.json'), null);
    if (!overlayMeta || overlayMeta.failedBoot || !overlayMeta.version) return bundledRoot;
    if (compareVersions(overlayMeta.version, bundledPkg.version || '0.0.0') <= 0) return bundledRoot;
    if (!fs.existsSync(path.join(overlayDir, 'server.js'))) return bundledRoot;
    return overlayDir;
  } catch {
    return bundledRoot;
  }
}

class Updater {
  constructor({ rootDir, dataDir, settings, events, fetchBytes = fetchBuffer, onDictionaryUpdated = async () => {}, onRuntimeUpdated = async () => {} }) {
    Object.assign(this, { rootDir, dataDir, settings, events, fetchBytes, onDictionaryUpdated, onRuntimeUpdated });
    this.stateFile = path.join(dataDir, 'hotfix', 'update-state.json');
    this.busy = false;
    try {
      const overlayMeta = readJson(path.join(rootDir, 'overlay-meta.json'), null);
      const saved = readJson(this.stateFile, null);
      if (overlayMeta?.version) {
        const pkgFile = path.join(rootDir, 'package.json');
        const pkg = readJson(pkgFile, null);
        if (pkg && pkg.version !== overlayMeta.version) {
          writeJson(pkgFile, { ...pkg, version: overlayMeta.version });
        }
        if (saved?.restartRequired && saved.runtimeVersion === overlayMeta.version) {
          writeJson(this.stateFile, { ...saved, restartRequired: false });
        }
      }
    } catch {}
  }

  currentState() {
    const bundledPkg = readJson(path.join(this.rootDir, 'package.json'), { version: '4.0.2', edition: 'lite' });
    const saved = readJson(this.stateFile, {});
    return {
      edition: bundledPkg.edition || 'lite',
      version: saved.runtimeVersion || bundledPkg.version || '4.0.2',
      bundledVersion: bundledPkg.version || '4.0.2',
      dictVersion: saved.dictVersion || '内置词典',
      lastCheckedAt: saved.lastCheckedAt || null,
      restartRequired: Boolean(saved.restartRequired)
    };
  }

  async checkAndApply({ manifestUrl } = {}) {
    if (this.busy) throw new Error('正在检查热更新，请稍候');
    this.busy = true;
    try {
      const port = this.settings.get().port;
      const url = manifestUrl || process.env.EASYAG_UPDATE_URL || DEFAULT_MANIFEST_URL;
      const rawManifest = await this.fetchBytes(url, port);
      let manifest;
      try { manifest = JSON.parse(rawManifest.toString('utf8')); }
      catch { throw new Error('热更新清单格式无效'); }
      if (!manifest || typeof manifest !== 'object') throw new Error('热更新清单内容为空');
      const state = this.currentState();
      if (manifest.edition && manifest.edition !== state.edition) {
        throw new Error(`更新通道不匹配（当前为 ${state.edition} 版）`);
      }
      let dictsUpdated = 0;
      let runtimeFilesUpdated = 0;

      // 1. Dictionary hot-update (zero-restart, live CDP reload)
      if (manifest.dicts && typeof manifest.dicts === 'object') {
        const dictDir = path.join(this.dataDir, 'hotfix', 'dicts');
        fs.mkdirSync(dictDir, { recursive: true });
        for (const name of DICT_FILES) {
          const entry = manifest.dicts[name];
          if (!entry || typeof entry.url !== 'string' || typeof entry.sha256 !== 'string') continue;
          const expectedHash = entry.sha256.trim().toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error(`词典 ${name} 校验摘要格式无效`);
          const targetFile = path.join(dictDir, name);
          const bundledFile = path.join(this.rootDir, 'dicts', name);
          const currentFile = fs.existsSync(targetFile) ? targetFile : (fs.existsSync(bundledFile) ? bundledFile : null);
          if (currentFile && sha256Hex(fs.readFileSync(currentFile)) === expectedHash) continue;
          const fileUrl = new URL(entry.url, url).toString();
          const bytes = await this.fetchBytes(fileUrl, port);
          if (sha256Hex(bytes) !== expectedHash) throw new Error(`词典 ${name} SHA-256 校验未通过，已拒绝写入`);
          const parsedDict = JSON.parse(bytes.toString('utf8'));
          writeJson(targetFile, parsedDict);
          dictsUpdated++;
        }
      }

      // 2. Runtime overlay hot-update (for JS/UI modules without touching EXE)
      let restartRequired = state.restartRequired;
      if (manifest.runtime && typeof manifest.runtime === 'object'
        && typeof manifest.runtime.version === 'string'
        && compareVersions(manifest.runtime.version, state.version) > 0
        && manifest.runtime.files && typeof manifest.runtime.files === 'object') {
        const stagingDir = path.join(this.dataDir, 'runtime', 'staging-' + Date.now());
        const currentDir = path.join(this.dataDir, 'runtime', 'current');
        fs.rmSync(stagingDir, { recursive: true, force: true });
        try {
          // Seed staging from current rootDir so overlay is a complete runnable backend
          for (const item of ['server.js', 'index.html', 'package.json', 'THIRD-PARTY-NOTICES.md', 'node_modules', 'dicts', 'core', 'features', 'adapters', 'desktop', 'ui', 'assets']) {
            const src = path.join(this.rootDir, item);
            if (fs.existsSync(src)) fs.cpSync(src, path.join(stagingDir, item), { recursive: true });
          }
          for (const [relativePath, spec] of Object.entries(manifest.runtime.files)) {
            if (!isAllowedRuntimePath(relativePath)) throw new Error(`不允许热更新路径: ${relativePath}`);
            if (!spec || typeof spec.url !== 'string' || typeof spec.sha256 !== 'string') throw new Error(`热更新文件配置缺失: ${relativePath}`);
            const expectedHash = spec.sha256.trim().toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error(`文件 ${relativePath} 校验摘要格式无效`);
            const destination = path.resolve(stagingDir, relativePath);
            if (!destination.startsWith(path.resolve(stagingDir) + path.sep)) throw new Error(`非法热更新目标路径: ${relativePath}`);
            if (fs.existsSync(destination)) {
              const localRaw = fs.readFileSync(destination);
              const localLf = Buffer.from(localRaw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
              if (sha256Hex(localRaw) === expectedHash || sha256Hex(localLf) === expectedHash) {
                continue;
              }
            }
            const fileUrl = new URL(spec.url, url).toString();
            const bytes = await this.fetchBytes(fileUrl, port);
            if (sha256Hex(bytes) !== expectedHash) throw new Error(`文件 ${relativePath} SHA-256 校验失败`);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, bytes);
            runtimeFilesUpdated++;
          }
          const stagedPkgFile = path.join(stagingDir, 'package.json');
          const stagedPkg = readJson(stagedPkgFile, null);
          if (stagedPkg) writeJson(stagedPkgFile, { ...stagedPkg, version: manifest.runtime.version });
          writeJson(path.join(stagingDir, 'overlay-meta.json'), {
            version: manifest.runtime.version,
            updatedAt: new Date().toISOString(),
            failedBoot: false
          });
          fs.rmSync(currentDir, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(currentDir), { recursive: true });
          fs.renameSync(stagingDir, currentDir);
          this.rootDir = currentDir;
          await this.onRuntimeUpdated(currentDir);
          restartRequired = true;
        } finally {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
      }

      const nextState = {
        runtimeVersion: runtimeFilesUpdated > 0 ? manifest.runtime.version : state.version,
        dictVersion: manifest.dictVersion || state.dictVersion,
        lastCheckedAt: new Date().toISOString(),
        restartRequired
      };
      writeJson(this.stateFile, nextState);

      let dictEntries = null;
      if (dictsUpdated > 0) {
        dictEntries = await this.onDictionaryUpdated();
      }

      const summary = {
        ok: true,
        updated: dictsUpdated > 0 || runtimeFilesUpdated > 0,
        dictsUpdated,
        runtimeFilesUpdated,
        dictEntries,
        ...this.currentState()
      };
      if (dictsUpdated > 0 || runtimeFilesUpdated > 0) {
        this.events.log('SYSTEM', `热更新完成：更新 ${dictsUpdated} 个词典文件、${runtimeFilesUpdated} 个内核模块${restartRequired ? '（内核更新将在下次启动生效）' : '（词典已即时生效）'}`, 'tag-proxy');
      } else {
        this.events.log('SYSTEM', `已是最新版本（v${summary.version} · 词典 ${summary.dictVersion}）`, 'tag-proxy');
      }
      return summary;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Updater, sha256Hex, compareVersions, isAllowedRuntimePath, resolveRuntimeRoot };
