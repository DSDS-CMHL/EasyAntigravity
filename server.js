#!/usr/bin/env node
const path = require('node:path');
const readline = require('node:readline');
const { createApplication } = require('./desktop/application');
const { normalizePath } = require('./adapters/desktop/discovery');

const native = process.env.EASYAG_TAURI === '1';
const rootDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const dataDir = normalizePath(process.env.EASYAG_DATA_DIR) || rootDir;
const app = createApplication({
  rootDir, dataDir, native,
  testMode: process.env.EASYAG_TEST_MODE === '1',
  onClose: recovery => setTimeout(() => process.exit(recovery.ok ? 0 : 1), 50)
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void app.close(signal); });
}
process.on('uncaughtException', error => {
  app.events.log('ERROR', error.stack || error.message, 'tag-alert');
  void app.close('后端异常').finally(() => process.exit(1));
});
process.on('unhandledRejection', error => {
  app.events.log('ERROR', String(error?.stack || error), 'tag-alert');
  void app.close('后端异常').finally(() => process.exit(1));
});

if (native) {
  readline.createInterface({ input: process.stdin })
    .on('line', line => { if (line === 'quit') void app.close('原生窗口关闭'); })
    .on('close', () => { void app.close('原生宿主管道关闭'); });
}

app.start().catch(error => {
  app.events.log('ERROR', error.stack || error.message, 'tag-alert');
  void app.close('启动失败').finally(() => process.exit(1));
});
