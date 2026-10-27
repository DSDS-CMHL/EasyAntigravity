const fs = require('node:fs/promises');
const http = require('node:http');
const { discoverProcesses, serverFromDiscovery, logPaths } = require('./language-service-discovery');

const METHODS = new Set(['GetUserStatus', 'GetCascadeTrajectory', 'GetCascadeTrajectoryGeneratorMetadata']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readLogTail(file) {
  const handle = await fs.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

// Only explicitly allowed read RPCs. No raw service data is returned to a renderer.
class LanguageService {
  constructor({ profile, processes = discoverProcesses, readLog = readLogTail, transport = http.request } = {}) {
    Object.assign(this, { profile, processes, readLog, transport });
    this.requests = new Set();
    this.generation = 0;
  }

  async discover() {
    if (this.server && Date.now() - this.discoveredAt < 15000) return this.server;
    if (this.discovering) return this.discovering;
    const generation = this.generation;
    const task = (async () => {
      const rows = await this.processes();
      let server;
      for (const file of logPaths(this.profile)) {
        try { server = serverFromDiscovery(await this.readLog(file, 'utf8'), rows); break; }
        catch { /* Try the next known host log path; do not expose paths or credentials. */ }
      }
      if (!server) throw new Error(rows.length > 1 ? '多个 AG 后台，暂不采集' : '等待 AG 本地统计接口');
      if (generation !== this.generation) throw new Error('采集已取消');
      this.server = server;
      this.discoveredAt = Date.now();
      return server;
    })();
    this.discovering = task;
    try { return await task; } finally { if (this.discovering === task) this.discovering = null; }
  }

  async call(method, body = {}, signal) {
    if (!METHODS.has(method)) throw new Error('不支持的统计接口');
    const generation = this.generation;
    const server = await this.discover();
    if (signal?.aborted || generation !== this.generation) throw new Error('采集已取消');
    try {
      return await new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const request = this.transport({ hostname: '127.0.0.1', port: server.port, method: 'POST',
          path: '/exa.language_server_pb.LanguageServerService/' + method, signal,
          headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1',
            'x-codeium-csrf-token': server.csrf, 'Content-Length': Buffer.byteLength(data) }
        }, response => {
          let size = 0;
          const chunks = [];
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 64 * 1024 * 1024) request.destroy(new Error('统计数据过大'));
            else chunks.push(chunk);
          });
          response.on('error', () => reject(new Error('统计连接中断')));
          response.on('aborted', () => reject(new Error('统计连接中断')));
          response.on('end', () => {
            if (response.statusCode !== 200) return reject(new Error('当前 AG 统计接口不可用'));
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new Error('AG 统计数据无法解析')); }
          });
        });
        this.requests.add(request);
        request.on('close', () => this.requests.delete(request));
        request.on('error', () => reject(new Error('AG 统计采集暂不可用')));
        request.setTimeout(8000, () => request.destroy(new Error('统计连接超时')));
        request.end(data);
      });
    } catch (error) {
      if (generation === this.generation) this.server = null;
      throw error;
    }
  }

  async metadata(id, signal) {
    if (!GUID.test(id)) throw new Error('无效的对话 ID');
    let first = await this.call('GetCascadeTrajectory', { cascadeId: id, trajectoryVerbosity: 2 }, signal);
    if (first.trajectory?.cascadeId?.toLowerCase() !== id.toLowerCase()) throw new Error('对话统计不匹配');
    const items = first.trajectory.generatorMetadata || [];
    const total = Number(first.numTotalGeneratorMetadata ?? items.length);
    first = null;
    if (!Array.isArray(items) || !Number.isSafeInteger(total) || total < items.length || total > 10000) throw new Error('统计样本范围不支持');
    // Discard steps/body immediately. Never persist trajectories or enumerate conversations.
    let pages = 0;
    while (items.length < total) {
      if (++pages > 32) throw new Error('统计分页超过上限');
      const page = await this.call('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: id, generatorMetadataOffset: items.length }, signal);
      const entries = page.generatorMetadata || page.generatorMetadatas;
      if (!Array.isArray(entries) || !entries.length || items.length + entries.length > total) throw new Error('统计分页不完整');
      items.push(...entries);
    }
    return items;
  }

  reset() {
    this.generation++;
    this.server = null;
    this.discovering = null;
    for (const request of this.requests) request.destroy();
    this.requests.clear();
  }
}

module.exports = { LanguageService, GUID };
