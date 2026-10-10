// UI observation supplies explanations only. Allow/Deny/Ask is enforced by AG itself.
function installRiskObserver(window, document, enabled, report) {
  window.__easyagRisk?.dispose();
  const seen = new WeakMap();
  let timer;
  function scan() {
    if (!enabled) return;
    const roots = document.querySelectorAll('[data-testid="run-command-step"], [data-testid*="approval"], [data-testid*="permission"]');
    for (const root of roots) {
      const candidates = root.matches('[data-testid="run-command-step"]')
        ? [root] : root.querySelectorAll('[data-testid="run-command-step"],pre,code');
      for (const candidate of candidates) {
        if (candidate.closest('[role="radiogroup"],[role="listbox"]')) continue;
        const command = (candidate.innerText || candidate.textContent || '').trim();
        if (!command || command.length > 16000 || /^(allow|deny|ask|允许|拒绝)(?:\s|$)/i.test(command)) continue;
        if (seen.get(candidate) === command) continue;
        seen.set(candidate, command);
        report({ type: 'risk-command', command });
      }
    }
  }
  const observer = new window.MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(scan, 150);
  });
  const runtime = {
    dispose() {
      clearTimeout(timer);
      observer.disconnect();
      if (window.__easyagRisk === runtime) delete window.__easyagRisk;
    }
  };
  window.__easyagRisk = runtime;
  if (enabled) {
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    scan();
  }
  return runtime;
}

class RiskAdvisor {
  constructor({ rules, events, notifications, enabled }) {
    Object.assign(this, { rules, events, notifications, enabled });
    this.recent = new Map();
    this.hits = 0;
  }

  observe(command) {
    if (!this.enabled()) return;
    const now = Date.now();
    for (const [key, time] of this.recent) if (now - time > 5000) this.recent.delete(key);
    if (this.recent.has(command)) return;
    this.recent.set(command, now);
    const risk = this.rules.assess(command);
    if (!risk) return;
    this.hits++;
    const cls = risk.level === 'high' ? 'tag-alert' : risk.level === 'medium' ? 'tag-warn' : 'tag-i18n';
    this.events.log('RISK', `[${risk.levelLabel}] ${command.slice(0, 180)}`, cls);
    this.notifications.show({
      type: 'risk_' + risk.level,
      title: risk.primary.name || '命令风险提示',
      detail: risk.primary.destructive_impact || risk.primary.root_cause || '请确认命令的作用范围。',
      solution: risk.primary.safe_alternative || '先确认目标路径和备份，再决定是否执行。'
    });
    this.events.publish({ counters: true, riskHits: this.hits, blockCount: 0 });
  }
}

module.exports = { installRiskObserver, RiskAdvisor };
