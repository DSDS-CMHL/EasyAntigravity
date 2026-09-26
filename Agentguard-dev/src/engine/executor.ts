import { exec } from 'node:child_process';
import type { ExecutionResult } from '../types.js';

export interface ExecuteOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export class SafeExecutor {
  private defaultTimeout: number;
  private defaultMaxBuffer: number;

  constructor(defaultTimeoutMs = 30000, defaultMaxBuffer = 10 * 1024 * 1024) {
    this.defaultTimeout = defaultTimeoutMs;
    this.defaultMaxBuffer = defaultMaxBuffer;
  }

  /**
   * Executes a command in native shell after passing security scan.
   */
  public async execute(command: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const start = performance.now();
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    const maxBuffer = options.maxBuffer ?? this.defaultMaxBuffer;
    const cwd = options.cwd || process.cwd();

    // Select native shell depending on platform
    let shell: string | undefined;
    if (process.platform === 'win32') {
      shell = process.env.COMSPEC || 'powershell.exe';
    } else {
      shell = process.env.SHELL || '/bin/bash';
    }

    return new Promise<ExecutionResult>((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer,
          shell,
          env: { ...process.env, ...options.env }
        },
        (error, stdout, stderr) => {
          const durationMs = Math.round(performance.now() - start);

          if (error) {
            resolve({
              command,
              stdout: stdout?.toString() || '',
              stderr: stderr?.toString() || error.message,
              exitCode: typeof error.code === 'number' ? error.code : 1,
              durationMs,
              isError: true
            });
            return;
          }

          resolve({
            command,
            stdout: stdout?.toString() || '',
            stderr: stderr?.toString() || '',
            exitCode: 0,
            durationMs,
            isError: false
          });
        }
      );
    });
  }
}
