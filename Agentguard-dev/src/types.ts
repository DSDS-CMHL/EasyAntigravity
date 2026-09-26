export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type Platform = 'windows' | 'linux' | 'darwin' | 'all';

export type Category = 
  | 'argument_injection_collapse'
  | 'unbound_variable_expansion'
  | 'destructive_filesystem'
  | 'reserved_device_deadlock'
  | 'wildcard_expansion_danger'
  | 'permission_destruction'
  | 'disk_partition_wipe'
  | 'database_wipe'
  | 'process_exhaustion'
  | 'secret_exfiltration'
  | 'privilege_escalation'
  | 'remote_script_execution'
  | 'container_resource_wipe'
  | string;

export interface EASRule {
  id: string;
  name: string;
  severity: Severity;
  platforms: Platform[];
  category: Category;
  pattern: string;
  flags?: string;
  root_cause: string;
  destructive_impact: string;
  safe_alternative: string;
  enabled?: boolean;
}

export interface EASDatabase {
  $schema: string;
  version: string;
  updated_at: string;
  rules: EASRule[];
}

export interface ScanMatch {
  rule: EASRule;
  matchedText: string;
}

export interface ScanResult {
  isSafe: boolean;
  violation?: ScanMatch;
  elapsedMs: number;
}

export interface ExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  isError: boolean;
}
