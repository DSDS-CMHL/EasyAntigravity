import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EASDatabase, EASRule, Platform, ScanResult, ScanMatch } from '../types.js';
import { EASDatabaseSchema } from '../rules/schema.js';

interface CompiledRule {
  rule: EASRule;
  regex: RegExp;
}

export class SignatureScanner {
  private compiledRules: CompiledRule[] = [];
  private currentPlatform: Platform;

  constructor(customRulesPath?: string) {
    this.currentPlatform = this.detectCurrentPlatform();
    this.loadRules(customRulesPath);
  }

  private detectCurrentPlatform(): Platform {
    const p = process.platform;
    if (p === 'win32') return 'windows';
    if (p === 'darwin') return 'darwin';
    return 'linux';
  }

  public getPlatform(): Platform {
    return this.currentPlatform;
  }

  public getLoadedRulesCount(): number {
    return this.compiledRules.length;
  }

  private loadRules(customRulesPath?: string): void {
    const rulesList: EASRule[] = [];

    // 1. Load built-in rules
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const candidatePaths = [
        path.resolve(__dirname, '../rules/signatures.json'),
        path.resolve(__dirname, '../../src/rules/signatures.json')
      ];
      const builtInPath = candidatePaths.find(p => fs.existsSync(p));
      if (builtInPath) {
        const raw = fs.readFileSync(builtInPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const validated = EASDatabaseSchema.parse(parsed);
        rulesList.push(...validated.rules);
      } else {
        console.warn('[AgentGuard] Warning: Built-in signatures.json not found in candidate paths:', candidatePaths);
      }
    } catch (err) {
      console.error('[AgentGuard] Error loading built-in signatures:', err);
    }

    // 2. Load user-defined project custom rules if present (.agentguard/rules.json)
    const localRulesPath = customRulesPath || path.resolve(process.cwd(), '.agentguard/rules.json');
    if (fs.existsSync(localRulesPath)) {
      try {
        const raw = fs.readFileSync(localRulesPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const validated = EASDatabaseSchema.parse(parsed);
        rulesList.push(...validated.rules);
      } catch (err) {
        console.warn(`[AgentGuard] Warning: Failed to parse custom rules at ${localRulesPath}:`, err);
      }
    }

    // 3. Compile regexes with platform filtering
    this.compiledRules = [];
    for (const rule of rulesList) {
      if (rule.enabled === false) continue;

      // Platform check
      const matchesPlatform =
        rule.platforms.includes('all') ||
        rule.platforms.includes(this.currentPlatform);

      if (!matchesPlatform) continue;

      try {
        const regex = new RegExp(rule.pattern, rule.flags || 'i');
        this.compiledRules.push({ rule, regex });
      } catch (err) {
        console.error(`[AgentGuard] Invalid regex in rule ${rule.id}:`, err);
      }
    }
  }

  /**
   * Scans a command string against active EAS rules.
   * Benchmarked to complete in sub-millisecond (< 1ms).
   */
  public scan(command: string): ScanResult {
    const startTime = performance.now();
    const cleanCmd = command.trim();

    if (!cleanCmd) {
      return {
        isSafe: true,
        elapsedMs: performance.now() - startTime
      };
    }

    for (const item of this.compiledRules) {
      const match = item.regex.exec(cleanCmd);
      if (match) {
        const elapsedMs = Number((performance.now() - startTime).toFixed(3));
        return {
          isSafe: false,
          violation: {
            rule: item.rule,
            matchedText: match[0]
          },
          elapsedMs
        };
      }
    }

    const elapsedMs = Number((performance.now() - startTime).toFixed(3));
    return {
      isSafe: true,
      elapsedMs
    };
  }
}
