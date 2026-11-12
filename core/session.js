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
      return this.desktop.resolveTarget(settings.targetApp, settings);
    }
    const target = this.desktop?.locate ? this.desktop.locate('hub', settings) : { exists: true, appExe: 'Antigravity' };
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
    if (['preparing', 'launching', 'cleaning'].includes(this.phase)) return { ok: false, error: '正在启动，请稍候' };
    const generation = ++this.generation;
    this.change('preparing');
    try {
      const target = this.resolveTarget();
      if (!target.exists) throw Object.assign(new Error(`未找到 ${target.name}: ` + target.appExe), { code: 'TARGET_NOT_FOUND' });
      const isRunning = await this.desktop.running(target.id);
      if (isRunning) throw Object.assign(new Error(`检测到已有 ${target.name} 进程，请先退出；如窗口已经关闭，可清理后重新启动。`), { code: 'PROCESS_CONFLICT' });
      if (this.closed || generation !== this.generation) throw new Error('启动已取消');
      const settings = this.settings.get();
      this.activeTarget = target;
      if (target.profile && this.cdp) this.cdp.profile = target.profile;
      if (this.cdp) this.cdp.target = target.id;
      this.change('launching');
      const launch = buildProxyLaunch(settings.port, this.cdp.port, process.env, settings.enableProxy);
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
      this.onStart({ target, pid: child.pid });
      this.change('running');
      if (target.capabilities?.cdp !== false) {
        this.cdp.start();
      }
      const netMsg = settings.enableProxy ? `本地代理 127.0.0.1:${settings.port}` : '直连网络';
      const cdpMsg = target.capabilities?.cdp !== false ? '，增强功能正在连接' : '';
      this.events.log('SYSTEM', `${target.name} 已启动（${netMsg}）${cdpMsg}`, 'tag-proxy');
      this.host.hide();
      return { ok: true, target: target.id };
    } catch (error) {
      this.child = null;
      this.activeTarget = null;
      if (!this.closed) this.change('error');
      this.events.log('SYSTEM', error.message, 'tag-alert');
      return { ok: false, error: error.message, code: error.code || 'LAUNCH_FAILED' };
    }
  }

  async cleanAndLaunch() {
    if (this.closed || ['preparing', 'launching', 'cleaning'].includes(this.phase)) return { ok: false, error: '当前正在处理启动，请稍候', code: 'BUSY' };
    const target = this.activeTarget || this.resolveTarget();
    if (!target.exists) return { ok: false, error: '可执行文件不存在，请重新指定路径', code: 'TARGET_NOT_FOUND' };
    const generation = ++this.generation;
    this.change('cleaning');
    // Detach the old child first: its exit must not reset a new launch's state.
    this.child = null;
    clearInterval(this.monitor);
    try {
      if (this.finishing) await this.finishing;
      this.change('cleaning');
      await this.cdp.stop();
      if (!this.desktop.stop) throw new Error('当前环境不支持进程清理');
      const result = await this.desktop.stop(target, { cancelled: () => this.closed || generation !== this.generation });
      if (!result?.ok) throw new Error('仍有进程未退出，已停止重新启动，请检查权限或稍后重试');
      if (this.closed || generation !== this.generation) throw new Error('清理已取消');
      // Keep the normal running preflight; never bypass verification after cleanup.
      if (await this.desktop.running(target.id)) throw new Error('仍检测到同名进程，已停止重新启动');
      this.activeTarget = null;
      this.events.log('SYSTEM', `${target.name} 进程已清理，正在重新启动`, 'tag-proxy');
      this.change('idle');
      return this.launch();
    } catch (error) {
      this.activeTarget = null;
      if (!this.closed) this.change('error');
      this.events.log('SYSTEM', `清理失败: ${error.message}`, 'tag-alert');
      return { ok: false, error: error.message, code: 'CLEANUP_FAILED' };
    }
  }

  async attachExisting() {
    if (this.closed || this.phase !== 'idle' || this.testMode) return;
    const settings = this.settings.get();
    let runningTarget = null;
    if (this.desktop?.detectRunningTarget) {
      runningTarget = await this.desktop.detectRunningTarget(settings.targetApp, settings);
    } else if (await this.desktop?.running()) {
      runningTarget = this.resolveTarget();
    }
    if (!runningTarget || this.closed || this.phase !== 'idle') return;
    this.activeTarget = runningTarget;
    if (runningTarget.profile && this.cdp) this.cdp.profile = runningTarget.profile;
    if (this.cdp) this.cdp.target = runningTarget.id;
    this.onStart({ target: runningTarget, pid: null });
    this.change('running');
    if (runningTarget.capabilities?.cdp !== false) {
      this.cdp.start();
    }
    this.events.log('SYSTEM', `已连接现有 ${runningTarget.name} 实例`, 'tag-proxy');
    const monitorGeneration = this.generation;
    this.monitor = setInterval(async () => {
      if (this.monitoring || this.closed) return;
      this.monitoring = true;
      try {
        const running = await this.desktop.running(runningTarget.id);
        if (monitorGeneration === this.generation && !this.closed && !running) await this.finish(`${runningTarget.name} 已关闭`);
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
