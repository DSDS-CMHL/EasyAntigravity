const { spawn } = require('node:child_process');
const { buildProxyLaunch } = require('../features/proxy');
const { compilePilotPermissions } = require('../features/pilot-permissions');
const { LABELS, validateProtectionLevel } = require('../features/protection');

class Session {
  constructor({ settings, permissions, rules, desktop, cdp, events, host, testMode = false, spawnProcess = spawn, onStart = () => {} }) {
    Object.assign(this, { settings, permissions, rules, desktop, cdp, events, host, testMode, spawnProcess, onStart });
    this.phase = 'idle';
    this.child = null;
    this.mode = null;
    this.protectionLevel = null;
    this.closed = false;
    this.generation = 0;
  }

  snapshot() {
    return { phase: this.phase, clientRunning: this.phase === 'running', activeLaunchMode: this.mode,
      activeProtectionLevel: this.protectionLevel, pid: this.child?.pid || null };
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
      const target = this.desktop.locate();
      if (!target.exists) throw new Error('未找到 Antigravity: ' + target.appExe);
      if (await this.desktop.running()) throw new Error('请先退出已打开的 AG，再通过 EasyAG 启动以应用增强配置');
      if (this.closed || generation !== this.generation) throw new Error('启动已取消');
      const settings = this.settings.get();
      const recovery = this.permissions.restore();
      if (!recovery.ok) throw new Error('无法恢复上次配置: ' + recovery.error);
      this.mode = settings.launchMode;
      let pilot = { ok: true, skipped: true };
      if (this.mode === 'pilot') {
        this.protectionLevel = validateProtectionLevel(settings.protectionLevel || 'standard');
        this.rules.reload();
        pilot = this.permissions.apply(compilePilotPermissions(this.rules, this.protectionLevel));
        if (!pilot.ok) throw new Error('增强配置失败: ' + pilot.error);
        this.events.log('SECURITY', `启动前校验通过：${LABELS[this.protectionLevel]}防护 + 自动审批 + ${pilot.count} 条原生权限规则`, 'tag-proxy');
      }
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
      // Register exit observation before handing control back to the caller.
      child.once('exit', () => { if (this.child === child) void this.finish('Antigravity 已关闭'); });
      if (this.closed || generation !== this.generation) {
        child.kill();
        throw new Error('启动已取消');
      }
      if (child.exitCode !== null && child.exitCode !== undefined) throw new Error('Antigravity 启动后立即退出');
      this.onStart();
      this.change('running');
      this.cdp.start();
      this.events.log('SYSTEM', 'Antigravity 已启动，增强功能正在连接', 'tag-proxy');
      this.host.hide();
      return { ok: true, pilot };
    } catch (error) {
      const recovery = this.permissions.restore();
      this.mode = null;
      this.protectionLevel = null;
      this.child = null;
      if (!this.closed) this.change('error');
      this.events.log('SYSTEM', error.message, 'tag-alert');
      return { ok: false, error: error.message, recovery };
    }
  }

  async attachExisting() {
    if (this.closed || this.phase !== 'idle' || this.testMode) return;
    if (!await this.desktop.running() || this.closed || this.phase !== 'idle') return;
    this.mode = 'compatibility';
    this.onStart();
    this.change('running');
    this.cdp.start();
    this.events.log('SYSTEM', '已连接现有 AG；沿用其原有权限设置', 'tag-proxy');
    this.monitor = setInterval(async () => {
      if (this.monitoring || this.closed) return;
      this.monitoring = true;
      try {
        if (!await this.desktop.running()) await this.finish('Antigravity 已关闭');
      } finally { this.monitoring = false; }
    }, 3000);
    this.monitor.unref();
  }

  async finish(reason) {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      clearInterval(this.monitor);
      // Restore before waiting for renderer cleanup: the native host has a shutdown deadline.
      const recovery = this.permissions.restore();
      await this.cdp.stop();
      this.child = null;
      this.mode = null;
      this.protectionLevel = null;
      this.change(recovery.ok ? 'idle' : 'error');
      this.events.log(recovery.ok ? 'SYSTEM' : 'SECURITY', recovery.ok ? reason + '，原设置已恢复' : '配置恢复失败: ' + recovery.error, recovery.ok ? 'tag-proxy' : 'tag-alert');
      return recovery;
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
