const fs = require('node:fs');
const path = require('node:path');
const { createSettings, assertLaunchSettingsMutable } = require('../core/settings');
const { Events } = require('../core/events');
const { Session } = require('../core/session');
const { writeJson } = require('../core/storage');
const { RuleEngine } = require('../features/rules');
const { loadDictionary } = require('../features/i18n');
const { RiskAdvisor } = require('../features/risk-advisor');
const { Notifications } = require('../features/notifications');
const { PermissionAdapter } = require('../adapters/desktop/permissions');
const { CdpHub } = require('../adapters/desktop/cdp');
const { rendererSource } = require('../adapters/desktop/renderer');
const { createDesktopAdapter } = require('../adapters/desktop');
const { removeLegacyHooks } = require('../adapters/desktop/legacy-hooks');
const { createHost } = require('./host');
const { createApi } = require('./api');
const { LABELS } = require('../features/protection');
const { LanguageService } = require('../adapters/desktop/language-service');
const { ContextMonitor } = require('../features/context-monitor');

function createApplication({ rootDir, dataDir, native = false, testMode = false, onClose = () => {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const events = new Events(dataDir);
  const settings = createSettings(path.join(dataDir, 'settings.json'));
  const desktop = createDesktopAdapter(testMode);
  const permissions = new PermissionAdapter({ configFile: desktop.configFile, dataDir });
  // Recovery precedes feature initialization, including user-editable rule files.
  const startupRecovery = permissions.restore();
  if (!startupRecovery.ok) events.log('SECURITY', '上次会话恢复失败: ' + startupRecovery.error, 'tag-alert');
  const rules = new RuleEngine({ rootDir, dataDir });
  const dictionary = loadDictionary(rootDir);
  const host = createHost({ native, testMode, events });
  const notifications = new Notifications({ host, events });
  const contextMonitor = new ContextMonitor(new LanguageService({ profile: desktop.profile }));
  let session;
  const advisorEnabled = () => (session?.mode || settings.get().launchMode) === 'pilot';
  const advisor = new RiskAdvisor({ rules, events, notifications, enabled: advisorEnabled });
  let lastStatus = '';
  const cdp = new CdpHub({
    profile: desktop.profile,
    source: binding => rendererSource(dictionary, { ...settings.get(), riskAdvisor: advisorEnabled() }, binding),
    onRisk: (command, metadata) => advisor.observe(command, metadata),
    onRiskStats: () => advisor.snapshot(),
    onMetrics: id => settings.get().enableContextMonitor && session?.phase === 'running' && !testMode
      ? contextMonitor.sample(id) : Promise.resolve({ conversationId: id, state: 'unavailable', context: null, speed: null }),
    onStop: () => contextMonitor.reset(),
    onStatus: status => {
      const key = JSON.stringify([status.cdpSockets, status.cdpTargets, status.cdpError]);
      if (key === lastStatus) return;
      lastStatus = key;
      events.publish({ status: status.cdpSockets ? '增强功能已连接' : '等待连接', ...session.snapshot(), ...status });
    }
  });
  session = new Session({ settings, permissions, rules, desktop, cdp, events, host, testMode, onStart: () => advisor.reset() });
  let closing;
  const app = {
    rootDir, dataDir, events, settings, rules, desktop, permissions, host, notifications, cdp, session, contextMonitor,
    status() {
      return {
        ...settings.get(), ...session.snapshot(), ...rules.summary(session.protectionLevel || settings.get().protectionLevel), ...cdp.status,
        riskAdvisor: advisorEnabled(),
        blockDangerous: (session.mode || settings.get().launchMode) === 'pilot',
        dictEntries: Object.keys(dictionary).length, riskHits: advisor.hits, riskSummary: advisor.snapshot(), blockCount: 0,
        injectedCount: permissions.status().count, capabilities: desktop.capabilities
      };
    },
    async configure(input) {
      const previous = settings.get();
      assertLaunchSettingsMutable(input, previous, session.phase);
      const next = settings.update(input);
      if (next.enableContextMonitor !== previous.enableContextMonitor) contextMonitor.reset();
      await cdp.refresh();
      if (next.enableI18n !== previous.enableI18n) events.log('I18N', next.enableI18n ? '汉化已开启' : '汉化已关闭，原文已恢复', 'tag-i18n');
      if (next.enableContextMonitor !== previous.enableContextMonitor) events.log('SYSTEM', next.enableContextMonitor ? '上下文监控已开启（只读）' : '上下文监控已关闭，上下文圆环已移除', 'tag-proxy');
      if (next.riskAdvisor !== previous.riskAdvisor) events.log('SECURITY', next.riskAdvisor ? '风险提示已开启' : '风险提示已关闭', 'tag-proxy');
      if (next.protectionLevel !== previous.protectionLevel) events.log('SECURITY', `防护强度已设为${LABELS[next.protectionLevel]}，下次启动时应用；ARES 风险提示不受档位影响`, 'tag-proxy');
      return next;
    },
    async start() {
      if (!testMode) {
        try {
          const result = removeLegacyHooks();
          if (result.removed) events.log('SYSTEM', `已移除 ${result.removed} 个旧版 EasyAG Hook 注册`, 'tag-proxy');
        } catch (error) { events.log('SYSTEM', '旧 Hook 清理失败: ' + error.message, 'tag-warn'); }
      }
      const port = await api.listen(native ? 0 : 19823);
      events.log('SYSTEM', `EasyAG 桌面内核就绪，${rules.active.length} 条权限规则`, 'tag-proxy');
      if (process.env.EASYAG_READY_FILE) writeJson(process.env.EASYAG_READY_FILE, { port, pid: process.pid });
      if (!native && !testMode) host.open(`http://127.0.0.1:${port}`);
      void session.attachExisting().catch(error => events.log('SYSTEM', error.message, 'tag-warn'));
      return port;
    },
    close(reason) {
      if (closing) return closing;
      closing = (async () => {
        events.log('SYSTEM', '正在退出: ' + reason, 'tag-warn');
        const recovery = await session.close(reason);
        notifications.hide();
        host.dispose();
        api.close();
        onClose(recovery);
        return recovery;
      })();
      return closing;
    }
  };
  const api = createApi(app);
  app.api = api;
  return app;
}

module.exports = { createApplication };
