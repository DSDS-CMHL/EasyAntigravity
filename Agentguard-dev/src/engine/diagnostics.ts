import type { ScanMatch } from '../types.js';

export class DiagnosticsReporter {
  /**
   * Generates a high-clarity markdown diagnostic report for the AI Agent.
   * This is structured specifically to trigger LLM Self-Correction loops.
   */
  public static formatBlockReport(command: string, violation: ScanMatch, elapsedMs: number): string {
    const { rule, matchedText } = violation;

    return [
      `🚨 [AgentGuard Security Gateway] 阻断执行：命中系统高危缺陷特征！`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `【漏洞标识】: ${rule.id} - ${rule.name}`,
      `【危险评级】: ${rule.severity} (检测耗时: ${elapsedMs}ms)`,
      `【命中片段】: \`${matchedText}\``,
      `【原始指令】: \`${command}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `⚠️ 【底层病理分析】:`,
      `${rule.root_cause}`,
      ``,
      `💥 【真实破坏后果】:`,
      `${rule.destructive_impact}`,
      ``,
      `🛡️ 【官方安全处方与重写建议】:`,
      `${rule.safe_alternative}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `[Self-Correction Directive] 请 Agent 立即停止盲目重试，根据上述【底层病理分析】与【官方安全处方】，反思并改用推荐的安全指令重新提交。`
    ].join('\n');
  }
}
