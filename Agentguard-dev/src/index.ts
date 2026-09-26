#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';

import { SignatureScanner } from './engine/scanner.js';
import { SafeExecutor } from './engine/executor.js';
import { DiagnosticsReporter } from './engine/diagnostics.js';

const SERVER_NAME = 'agentguard-mcp';
const SERVER_VERSION = '0.1.0';

async function main() {
  const scanner = new SignatureScanner();
  const executor = new SafeExecutor();

  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Define MCP Tools
  const TOOLS: Tool[] = [
    {
      name: 'execute_command',
      description:
        'Securely executes a shell command with sub-millisecond AST/signature inspection. If high-risk or destructive patterns (e.g., Win32 quote collapse, recursive wipe, glob errors) are detected, execution is physically blocked and a structured self-correction prescription is returned.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command line string to be checked and executed.'
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory. Defaults to current workspace.'
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional execution timeout in milliseconds (default: 30000ms).'
          }
        },
        required: ['command']
      }
    },
    {
      name: 'scan_command',
      description:
        'Dry-run scan of a command string against the EAS (EasyAG Agent Security) signature database without executing. Useful for pre-flight safety audits.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command line string to audit.'
          }
        },
        required: ['command']
      }
    },
    {
      name: 'list_security_rules',
      description:
        'Lists the currently loaded EAS security rules and active platform filters.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ];

  // Handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Handler for executing tools
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'execute_command') {
      const command = String(args?.command || '').trim();
      const cwd = args?.cwd ? String(args.cwd) : undefined;
      const timeoutMs = typeof args?.timeoutMs === 'number' ? args.timeoutMs : undefined;

      if (!command) {
        return {
          content: [{ type: 'text', text: 'Error: Parameter "command" cannot be empty.' }],
          isError: true
        };
      }

      // Step 1: Sub-millisecond Security Scan
      const scanResult = scanner.scan(command);

      // Step 2: Block if violation is detected
      if (!scanResult.isSafe && scanResult.violation) {
        const report = DiagnosticsReporter.formatBlockReport(
          command,
          scanResult.violation,
          scanResult.elapsedMs
        );
        return {
          content: [{ type: 'text', text: report }],
          isError: true
        };
      }

      // Step 3: Command is safe -> Execute in native shell
      const result = await executor.execute(command, { cwd, timeoutMs });

      let outputText = '';
      if (result.stdout) outputText += result.stdout;
      if (result.stderr) {
        if (outputText) outputText += '\n[stderr]\n';
        outputText += result.stderr;
      }
      if (!outputText) {
        outputText = `(Command finished with exit code ${result.exitCode} in ${result.durationMs}ms, no output)`;
      }

      return {
        content: [
          {
            type: 'text',
            text: outputText
          }
        ],
        isError: result.isError
      };
    }

    if (name === 'scan_command') {
      const command = String(args?.command || '').trim();
      const scanResult = scanner.scan(command);

      if (!scanResult.isSafe && scanResult.violation) {
        return {
          content: [
            {
              type: 'text',
              text: DiagnosticsReporter.formatBlockReport(
                command,
                scanResult.violation,
                scanResult.elapsedMs
              )
            }
          ],
          isError: true
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ [SAFE] 命令未命中任何高危特征规则 (扫描耗时: ${scanResult.elapsedMs}ms)\n指令: ${command}`
          }
        ],
        isError: false
      };
    }

    if (name === 'list_security_rules') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                platform: scanner.getPlatform(),
                activeRulesCount: scanner.getLoadedRulesCount(),
                status: 'operational',
                engine: 'AgentGuard-EAS-v1'
              },
              null,
              2
            )
          }
        ]
      };
    }

    throw new Error(`Unknown tool requested: ${name}`);
  });

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[AgentGuard-MCP] Server running on stdio (Platform: ${scanner.getPlatform()}, Active rules: ${scanner.getLoadedRulesCount()})`
  );
}

main().catch((err) => {
  console.error('[AgentGuard-MCP] Fatal error starting server:', err);
  process.exit(1);
});
