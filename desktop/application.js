const fs = require('node:fs');
const path = require('node:path');
const { createSettings } = require('../core/settings');
const { Events } = require('../core/events');
const { writeJson } = require('../core/storage');
const { createHost } = require('./host');
const { createApi } = require('./api');
const {
  findAgyExe,
  getProjectsAndConversations,
  createProject,
  checkTerminalType,
  openFolder,
  launchCliTerminal
} = require('../features/cli-launcher');

function createApplication({ rootDir, dataDir, native = false, testMode = false, onClose = () => {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const events = new Events(dataDir);
  const settings = createSettings(path.join(dataDir, 'settings.json'));
  const host = createHost({ native, testMode, events });

  let closing = false;
  const app = {
    rootDir,
    dataDir,
    events,
    settings,
    host,
    status() {
      const cli = findAgyExe();
      const terminal = checkTerminalType();
      return {
        ...settings.get(),
        cli,
        terminal,
        version: '1.0.0-cli'
      };
    },
    async configure(input) {
      const previous = settings.get();
      const next = settings.update(input);
      if (input.port !== undefined && input.port !== previous.port) {
        events.log('SYSTEM', `本地代理端口已更新为: ${next.port}`, 'tag-proxy');
      }
      if (input.enableProxy !== undefined && input.enableProxy !== previous.enableProxy) {
        events.log('SYSTEM', next.enableProxy ? `免 TUN 代理已开启（127.0.0.1:${next.port}）` : '免 TUN 代理已关闭（直连模式）', 'tag-proxy');
      }
      if (input.skipPermissions !== undefined && input.skipPermissions !== previous.skipPermissions) {
        events.log('SYSTEM', next.skipPermissions ? '已开启跳过权限确认 (--dangerously-skip-permissions)' : '已恢复标准权限确认', 'tag-proxy');
      }
      events.publish(app.status());
      return next;
    },
    getProjects() {
      return getProjectsAndConversations();
    },
    createProject(payload) {
      const res = createProject(payload);
      if (res.ok) {
        events.log('CLI', `新建项目成功: ${res.project.name} (${res.project.path})`, 'tag-proxy');
      }
      return res;
    },
    launchCli({ workspace, conversationId, continueLast, skipPermissions }) {
      const currentSettings = settings.get();
      const result = launchCliTerminal({
        workspace,
        conversationId,
        continueLast,
        skipPermissions: skipPermissions !== undefined ? skipPermissions : currentSettings.skipPermissions,
        port: currentSettings.port,
        enableProxy: currentSettings.enableProxy
      });
      if (result.ok) {
        const actionDesc = conversationId ? `续接会话 [${conversationId.slice(0, 8)}]` : (continueLast ? '续接上次会话' : '开启新会话');
        const proxyDesc = result.proxied ? `(免 TUN 代理 :${currentSettings.port})` : '(直连模式)';
        events.log('CLI', `已调起终端 ${actionDesc} -> ${path.basename(result.workspace)} ${proxyDesc}`, 'tag-proxy');
      } else {
        events.log('CLI', `调起失败: ${result.error}`, 'tag-alert');
      }
      return result;
    },
    openFolder(folderPath) {
      return openFolder(folderPath);
    },
    async start() {
      const port = await api.listen(native ? 0 : 19823);
      const cli = findAgyExe();
      if (cli.installed) {
        events.log('SYSTEM', `EasyAG CLI Hub 就绪，已检测到 CLI: ${cli.path}`, 'tag-proxy');
      } else {
        events.log('SYSTEM', 'EasyAG CLI Hub 就绪，未检测到 agy.exe，请确认已安装。', 'tag-warn');
      }
      if (process.env.EASYAG_READY_FILE) writeJson(process.env.EASYAG_READY_FILE, { port, pid: process.pid });
      return port;
    },
    async close(reason = '退出') {
      if (closing) return;
      closing = true;
      events.log('SYSTEM', `正在退出: ${reason}`, 'tag-proxy');
      api.close();
      host.dispose?.();
      onClose();
    }
  };

  const api = createApi(app);
  return app;
}

module.exports = { createApplication };
