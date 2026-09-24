const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const vm = require('vm');

console.log('================================================================');
console.log('   EasyAntigravity 托盘常驻与灵动胶囊自动化回归测试套件           ');
console.log('================================================================\n');

// 1. 验证静态资源和可执行文件存在
console.log('--- 1. 检查托盘常驻与胶囊原生可执行组件 ---');
const exePath = path.join(__dirname, '..', 'assets', 'EasyAG-Resident.exe');
const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

assert.strictEqual(fs.existsSync(exePath), true, 'EasyAG-Resident.exe 必须存在于 assets 目录');
assert.strictEqual(fs.existsSync(iconPath), true, 'icon.ico 必须存在于 assets 目录');
const exeStats = fs.statSync(exePath);
console.log(`✓ EasyAG-Resident.exe 存在，体积: ${exeStats.size} 字节 (${(exeStats.size / 1024).toFixed(1)} KB)`);
console.log(`✓ icon.ico 存在，体积: ${fs.statSync(iconPath).size} 字节\n`);

// 2. 检查 server.js 注入脚本语法正确性 (无语法错误)
console.log('--- 2. 验证 CDP 注入脚本与完成状态机语法 ---');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');

// 提取 generateMasterInjectScript 的函数体
const match = serverSource.match(/(function generateMasterInjectScript\(\) \{[\s\S]*?\n\})/);
assert.ok(match, '必须在 server.js 中匹配到 generateMasterInjectScript 函数');

// 模拟必要上下文运行脚本生成
const fn = new Function('state', 'translationDict', 'reverseDict', 'getActiveDangerPatterns', match[1] + '\nreturn generateMasterInjectScript();');
const mockState = { preferOption: 1, autoAccept: true, enableI18n: false, blockDangerous: true };
const injectCode = fn(mockState, {}, {}, () => [{ id: 'test', re: /rm\s+-rf/i, name: '测试' }]);

assert.ok(injectCode.includes('[EA_READY]'), '注入脚本中必须包含 [EA_READY] 任务完成监控特征码');
assert.ok(injectCode.includes('agent-input-box'), '注入脚本中必须包含 agent-input-box 检测特征码');
assert.ok(injectCode.includes('input-send-button-cancel-tooltip'), '注入脚本中必须包含 cancel-tooltip 状态检测特征码');

// 用 Node VM 校验生成的 JS 语法
try {
  new vm.Script(injectCode);
  console.log('✓ generateMasterInjectScript 生成的客户端脚本经 VM 编译通过，语法 100% 正确\n');
} catch (e) {
  assert.fail('CDP 注入脚本语法错误: ' + e.message);
}

// 3. 验证 EasyAG-Resident.exe 原生进程 IPC 协议
console.log('--- 3. 验证 EasyAG-Resident.exe 原生常驻进程 IPC 交互 ---');
if (process.platform !== 'win32') {
  console.log('✓ 非 Windows 平台，跳过 Windows 原生驻留进程测试\n');
  console.log('================ 测试工作流执行结果总结 ================');
  console.log('🎉 恭喜：测试通过！\n');
  process.exit(0);
}

const resident = spawn(exePath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});

let readyReceived = false;
let stdoutLogs = [];

resident.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    stdoutLogs.push(trimmed);
    try {
      const obj = JSON.parse(trimmed);
      if (obj.event === 'ready') {
        readyReceived = true;
      }
    } catch (_) {}
  }
});

setTimeout(() => {
  assert.strictEqual(readyReceived, true, 'EasyAG-Resident.exe 启动后必须发送 {"event":"ready"}');
  console.log('✓ 收到原生常驻进程启动握手信号: {"event":"ready"}');

  // 发送指令测试：初始化端口与PID
  resident.stdin.write(JSON.stringify({ cmd: 'init', port: 7890, ea_pid: process.pid }) + '\n');
  console.log('✓ 发送 init 初始化指令');

  // 发送指令测试：展示胶囊三种形态
  resident.stdin.write(JSON.stringify({ cmd: 'show_capsule', type: 'danger', title: 'git push --force', detail: '已阻断' }) + '\n');
  console.log('✓ 发送 show_capsule (danger) 指令');

  resident.stdin.write(JSON.stringify({ cmd: 'show_capsule', type: 'interaction', title: '方案决策', detail: '请选择' }) + '\n');
  console.log('✓ 发送 show_capsule (interaction) 指令');

  resident.stdin.write(JSON.stringify({ cmd: 'show_capsule', type: 'ready', title: '任务就绪', detail: '代码已就绪' }) + '\n');
  console.log('✓ 发送 show_capsule (ready) 指令');

  // 隐藏胶囊
  resident.stdin.write(JSON.stringify({ cmd: 'hide_capsule' }) + '\n');
  console.log('✓ 发送 hide_capsule 指令');

  // 发送 exit 指令优雅退出
  resident.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
  console.log('✓ 发送 exit 退出指令');

  setTimeout(() => {
    resident.kill();
    console.log('\n================ 测试工作流执行结果总结 ================');
    console.log('🎉 恭喜：托盘常驻与灵动胶囊原生套件全部测试通过！\n');
    process.exit(0);
  }, 800);
}, 1000);
