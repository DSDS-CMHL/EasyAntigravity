const { spawn } = require('node:child_process');
const { buildProxyLaunch } = require('../features/proxy');

class Session {
  constructor({ settings, desktop, cdp, events, host, testMode = false, spawnProcess = spawn, onStart = () => {} }) {
    Object.assign(this, { settings, desktop, cdp, events, host, testMode, spawnProcess, onStart });
    this.phase = 'idle';
    this.child = null;
    this.closed = false;
    this.generation = 0;
    this.activeTarget = null;
  }

  resolveTarget() {
    const settings = this.settings.get();
    if (this.desktop?.resolveTarget) {
      return this.desktop.resolveTarget(settings.targetApp);
    }
    const target = this.desktop?.locate ? this.desktop.locate() : { exists: true, appExe: 'Antigravity' };
    return { id: target.id || 'hub', name: target.appName || target.name || 'Antigravity', ...target };
  }

  snapshot() {
    const target = this.activeTarget || this.resolveTarget();
    return {
      phase: this.phase,
      clientRunning: this.phase === 'running',
      pid: this.child?.pid || null,
      activeTarget: target.id || 'hub',
      targetName: target.name || 'Antigravity'
    };
  }

  change(phase) {
    this.phase = phase;
    this.events.publish(this.snapshot());
  }

  async launch() {
    if (this.closed) return { ok: false, error: 'EasyAG 正在退出' };
    if (this.phase === 'running') return { ok: true, alreadyRunning: true };
    if (this.phase === 'preparing' || this.phase === 'launching') return { ok: false, error: '正在启动，请稍候' };
    const generation = ++this.generation;
    this.change('preparing');
    try {
      const target = this.resolveTarget();
      if (!target.exists) throw new Error(`未找到 ${target.name}: ` + target.appExe);
      const isRunning = await this.desktop.running(target.id);
      if (isRunning) throw new Error(`请先退出已打开的 ${target.name}，再通过 EasyAG 启动以接入代理环境`);
      if (this.closed || generation !== this.generation) throw new Error('启动已取消');
      const settings = this.settings.get();
      this.activeTarget = target;
      if (target.profile && this.cdp) this.cdp.profile = target.profile;
      this.change('launching');
      const launch = buildProxyLaunch(settings.port, this.cdp.port);
      const child = this.spawnProcess(target.appExe, launch.args, {
        env: launch.env, detached: false, stdio: 'ignore', windowsHide: false
      });
      this.child = child;
      let spawnError;
      child.once('error', error => { spawnError = error; });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      if (spawnError) throw spawnError;
      child.once('exit', () => { if (this.child === child) void this.finish(`${target.name} 已关闭`); });
      if (this.closed || generation !== this.generation) {
        child.kill();
        throw new Error('启动已取消');
      }
      if (child.exitCode !== null && child.exitCode !== undefined) throw new Error(`${target.name} 启动后立即退出`);
      this.onStart();
      this.change('running');
      if (target.capabilities?.cdp !== false) {
        this.cdp.start();
      }
      const cdpMsg = target.capabilities?.cdp !== false ? '，增强功能正在连接' : '';
      this.events.log('SYSTEM', `${target.name} 已启动（本地代理 127.0.0.1:${settings.port}）${cdpMsg}`, 'tag-proxy');
      this.host.hide();
      return { ok: true, target: target.id };
    } catch (error) {
      this.child = null;
      this.activeTarget = null;
      if (!this.closed) this.change('error');
      this.events.log('SYSTEM', error.message, 'tag-alert');
      return { ok: false, error: error.message };
    }
  }

  async attachExisting() {
    if (this.closed || this.phase !== 'idle' || this.testMode) return;
    const settings = this.settings.get();
    let runningTarget = null;
    if (this.desktop?.detectRunningTarget) {
      runningTarget = await this.desktop.detectRunningTarget(settings.targetApp);
    } else if (await this.desktop?.running()) {
      runningTarget = this.resolveTarget();
    }
    if (!runningTarget || this.closed || this.phase !== 'idle') return;
    this.activeTarget = runningTarget;
    if (runningTarget.profile && this.cdp) this.cdp.profile = runningTarget.profile;
    this.onStart();
    this.change('running');
    if (runningTarget.capabilities?.cdp !== false) {
      this.cdp.start();
    }
    this.events.log('SYSTEM', `已连接现有 ${runningTarget.name} 实例`, 'tag-proxy');
    this.monitor = setInterval(async () => {
      if (this.monitoring || this.closed) return;
      this.monitoring = true;
      try {
        if (!await this.desktop.running(runningTarget.id)) await this.finish(`${runningTarget.name} 已关闭`);
      } finally { this.monitoring = false; }
    }, 3000);
    this.monitor.unref();
  }

  async finish(reason) {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      clearInterval(this.monitor);
      await this.cdp.stop();
      this.child = null;
      this.activeTarget = null;
      this.change('idle');
      this.events.log('SYSTEM', reason, 'tag-proxy');
      return { ok: true };
    })();
    try { return await this.finishing; } finally { this.finishing = null; }
  }

  async close(reason) {
    this.closed = true;
    this.generation++;
    return this.finish(reason);
  }
}

module.exports = { Session };
