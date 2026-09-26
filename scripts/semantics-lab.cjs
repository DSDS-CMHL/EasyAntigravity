#!/usr/bin/env node
/**
 * AG 权限语义实验室 — 复杂匹配矩阵（全部无害命令）
 * 用法:
 *   node scripts/semantics-lab.cjs list
 *   node scripts/semantics-lab.cjs prep <caseId> [--project EasyAntigravity]
 *   node scripts/semantics-lab.cjs record <caseId> <pass|fail|skip> [note]
 *
 * prep 会: 清空该项目 allow/ask/deny 中我们写入的测试规则 → 写入该 case 规则 → set-mode
 * record 会把结果追加到 test/semantics-results.json
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AG = path.join(__dirname, 'ag-config.cjs');
const RESULTS = path.join(ROOT, 'test', 'semantics-results.json');
const PROJECT = 'EasyAntigravity';

function ag(...args) {
  return execFileSync(process.execPath, [AG, ...args], { encoding: 'utf8' });
}

/** 全部无害：只 echo / Get-Date / Get-ChildItem / Write-Output 等只读 */
const CASES = [
  {
    id: 'P1',
    title: '路径空格 + 引号：token 正则能否吃掉带空格路径',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'regex:echo -rf .*' }
    ],
    run: 'echo -rf "F:\\temp path with spaces\\dummy"',
    expect: '不弹（.* 应吞掉带空格路径）',
    why: '验证 regex: 空格分 token 后，.* 是否按词还是按整行'
  },
  {
    id: 'P2',
    title: '多词路径无引号：前缀 echo vs 五段参数',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'echo' }
    ],
    run: 'echo F:\\a\\b c d e',
    expect: '不弹（前缀 echo）',
    why: '前缀匹配是否覆盖任意参数'
  },
  {
    id: 'P3',
    title: 'cmd 包装：allow(echo) 能否穿透 cmd /c',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'echo' }
    ],
    run: 'cmd /c echo wrapped-probe',
    expect: '待观察：若弹 → 引擎认的是 cmd 而非 echo',
    why: '包装命令是否整行替换匹配对象'
  },
  {
    id: 'P4',
    title: 'PowerShell 包装：allow(echo) vs powershell -Command',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'echo' }
    ],
    run: 'powershell -Command "echo ps-wrapped"',
    expect: '待观察：多半弹（前缀是 powershell）',
    why: '同上，Windows 引擎匹配哪一层命令'
  },
  {
    id: 'P5',
    title: '反规避：命令替换 $( ) 是否令前缀失效',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'echo' }
    ],
    run: 'echo $(echo subtoken)',
    expect: '弹（文档：$() 禁用前缀匹配，回落 Ask）',
    why: '官方反规避是否真生效'
  },
  {
    id: 'P6',
    title: '管道链：前缀是否仍覆盖 && 左侧',
    mode: 'default',
    rules: [
      { list: 'allow', target: 'echo' }
    ],
    run: 'echo chain-a && echo chain-b',
    expect: '不弹（文档：&& 链仍前缀匹配）',
    why: '标准 shell 组合是否保留前缀语义'
  },
  {
    id: 'P7',
    title: '提权形态·Deny 正则吃 RunAs 参数（不真提权）',
    mode: 'turbo',
    rules: [
      { list: 'deny', target: 'regex:Write-Output .*RunAs.*' }
    ],
    run: 'Write-Output "Start-Process -Verb RunAs fake"',
    expect: '硬拒（Deny 命中参数里的 RunAs）',
    why: 'Deny 正则能否匹配参数中的提权特征；命令本身只打印字符串'
  },
  {
    id: 'P8',
    title: '提权形态·对比：无 RunAs 不该被 Deny',
    mode: 'turbo',
    rules: [
      { list: 'deny', target: 'regex:Write-Output .*RunAs.*' }
    ],
    run: 'Write-Output "safe text without keyword"',
    expect: 'Turbo 放行',
    why: 'Deny 不过度杀伤'
  },
  {
    id: 'P9',
    title: '路径穿越形态：Deny 吃 ..\\ 与绝对盘符（echo 模拟）',
    mode: 'turbo',
    rules: [
      { list: 'deny', target: 'regex:Write-Output .*(\\.\\.[\\\\/]|[A-Za-z]:\\\\).*' }
    ],
    run: 'Write-Output "C:\\Windows\\..\\..\\secret"',
    expect: '硬拒',
    why: '复杂正则 + 盘符/穿越在 token 锚定下是否还命中'
  },
  {
    id: 'P10',
    title: 'EasyAG 现编译格式：整段 JS 正则当单 token',
    mode: 'default',
    rules: [
      // 模拟 danger-rules 编译产物：无字面空格的复杂 JS 正则
      { list: 'ask', target: 'regex:\\bWrite-Output\\s+.*probe.*' }
    ],
    run: 'Write-Output "has probe inside"',
    expect: '若弹且 EasyAG 旁路可命中 → 格式可用；若永不弹 → 编译格式错误',
    why: '验证 regex:+JS正则 是否被 ^...$ 锁死'
  }
];

function clearTestRules() {
  for (const list of ['allow', 'ask', 'deny']) {
    try { ag('clear-rules', list, '--project', PROJECT); } catch (e) {}
    try { ag('clear-rules', list, '--global'); } catch (e) {}
  }
}

function prep(id) {
  const c = CASES.find(x => x.id === id);
  if (!c) { console.error('unknown case', id); process.exit(1); }
  clearTestRules();
  ag('set-mode', c.mode, PROJECT);
  for (const r of c.rules) {
    ag('set-rules', r.list, r.target, '--project', PROJECT);
  }
  const out = {
    case: c.id,
    title: c.title,
    mode: c.mode,
    rules: c.rules,
    run_in_project: PROJECT,
    command: c.run,
    expect: c.expect,
    why: c.why
  };
  console.log(JSON.stringify(out, null, 2));
  console.log('\n>>> 请在 Antigravity 的 [' + PROJECT + '] 项目里跑:\n    ' + c.run);
  console.log('>>> 然后: node scripts/semantics-lab.cjs record ' + c.id + ' <pass|fail|skip> "备注"');
}

function record(id, verdict, note) {
  const c = CASES.find(x => x.id === id);
  const list = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : [];
  list.push({
    id, verdict, note: note || '',
    title: c ? c.title : '',
    command: c ? c.run : '',
    expect: c ? c.expect : '',
    at: new Date().toISOString()
  });
  fs.writeFileSync(RESULTS, JSON.stringify(list, null, 2), 'utf8');
  console.log('recorded', id, verdict);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'list') {
  console.log(CASES.map(c => `${c.id}  ${c.title}\n    run: ${c.run}\n    expect: ${c.expect}`).join('\n\n'));
} else if (cmd === 'prep') prep(args[0]);
else if (cmd === 'record') record(args[0], args[1], args[2]);
else {
  console.log('list | prep <id> | record <id> pass|fail|skip [note]');
  process.exit(1);
}
