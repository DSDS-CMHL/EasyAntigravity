// UI observation supplies explanations only. Allow/Deny/Ask is enforced by AG itself.
function installRiskObserver(window, document, enabled, report) {
  window.__easyagRisk?.dispose();
  // Survive CDP remounts. A command step is one invocation; changing approval
  // status, output or the capsule's visibility must not create another event.
  const state = window.__easyagRiskState ||= {
    nodes: new WeakMap(), delivered: new Set(), sequence: 0,
    session: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  };
  let timer;
  function scan() {
    if (!enabled) return;
    const roots = document.querySelectorAll('[data-testid="run-command-step"], [data-testid*="approval"], [data-testid*="permission"]');
    for (const root of roots) {
      const candidates = root.matches('[data-testid="run-command-step"]')
        ? [root] : root.querySelectorAll('[data-testid="run-command-step"]');
      // Legacy approval panels may not expose a run-command-step wrapper.
      const legacyCommand = root.querySelector('pre,code');
      const steps = candidates.length ? candidates : legacyCommand ? [legacyCommand] : [];
      for (const candidate of steps) {
        if (candidate.closest('[role="radiogroup"],[role="listbox"]')) continue;
        const source = candidate.querySelector('[data-testid="command"], [data-testid="command-text"], pre code, pre, code') || candidate;
        const command = (source.innerText || source.textContent || '').trim();
        if (!command || command.length > 16000 || /^(allow|deny|ask|允许|拒绝)(?:\s|$)/i.test(command)) continue;
        let invocationId = state.nodes.get(candidate);
        if (!invocationId) {
          const owner = candidate.closest('[data-tool-call-id],[data-step-id],[data-message-id],[data-command-id]') || candidate;
          const key = ['data-tool-call-id', 'data-step-id', 'data-command-id', 'data-message-id', 'id']
            .map(attr => owner.getAttribute(attr)).find(Boolean);
          const index = owner === candidate ? 0 : Array.from(owner.querySelectorAll('[data-testid="run-command-step"]')).indexOf(candidate);
          invocationId = `${state.session}:${key ? 'step:' + key + ':' + index : 'node:' + ++state.sequence}`;
          state.nodes.set(candidate, invocationId);
        }
        if (state.delivered.has(invocationId)) continue;
        state.delivered.add(invocationId);
        if (state.delivered.size > 2048) state.delivered.delete(state.delivered.values().next().value);
        report({ type: 'risk-command', command, invocationId });
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
    this.counts = { high: 0, medium: 0, low: 0 };
    this.latestLevel = null;
    this.session = 0;
    this.revision = 0;
  }

  snapshot() {
    return { enabled: this.enabled(), session: this.session, revision: this.revision, total: this.hits,
      counts: { ...this.counts }, latestLevel: this.latestLevel,
      highestLevel: this.counts.high ? 'high' : this.counts.medium ? 'medium' : this.counts.low ? 'low' : null };
  }

  reset() {
    this.recent.clear();
    this.hits = 0;
    this.counts = { high: 0, medium: 0, low: 0 };
    this.latestLevel = null;
    this.session++;
    this.revision++;
    this.events.publish({ counters: true, riskHits: 0, riskSummary: this.snapshot(), blockCount: 0 });
  }

  observe(command, metadata = {}) {
    if (!this.enabled()) return;
    const now = Date.now();
    const invocationId = typeof metadata.invocationId === 'string' && metadata.invocationId.length <= 17000
      ? metadata.invocationId : '';
    for (const [key, time] of this.recent) if (key.startsWith('text:') && now - time > 30000) this.recent.delete(key);
    const key = invocationId ? 'invocation:' + invocationId : 'text:' + command;
    if (this.recent.has(key)) return;
    this.recent.set(key, now);
    if (this.recent.size > 2048) this.recent.delete(this.recent.keys().next().value);
    const risk = this.rules.assess(command);
    if (!risk) return;
    this.hits++;
    this.latestLevel = ['high', 'medium', 'low'].includes(risk.level) ? risk.level : 'low';
    this.counts[this.latestLevel]++;
    this.revision++;
    const cls = risk.level === 'high' ? 'tag-alert' : risk.level === 'medium' ? 'tag-warn' : 'tag-i18n';
    this.events.log('RISK', `[${risk.levelLabel}] ${command.slice(0, 180)}`, cls);
    this.notifications.show({
      type: 'risk_' + risk.level,
      title: risk.primary.name || '命令风险提示',
      detail: risk.primary.destructive_impact || risk.primary.root_cause || '请确认命令的作用范围。',
      solution: risk.primary.safe_alternative || '先确认目标路径和备份，再决定是否执行。'
    });
    this.events.publish({ counters: true, riskHits: this.hits, riskSummary: this.snapshot(), blockCount: 0 });
  }
}

module.exports = { installRiskObserver, RiskAdvisor };
