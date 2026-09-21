# Antigravity Proxy DLL 兼容性问题 - 技术排查请求

**日期**: 2026-09-21  
**项目**: EasyAntigravity  
**仓库**: https://github.com/DSDS-CMHL/EasyAntigravity

---

## 一、问题摘要

### 1.1 项目背景

**EasyAntigravity** 是 Google Antigravity AI 编程助手的第三方启动器，提供：
- 免 TUN 模式的代理注入（通过 `version.dll` 劫持）
- 界面深度汉化（CDP 注入 + 字典翻译）
- 自动审批与高危命令熔断

代理注入组件 `version.dll` 来源于开源项目 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy)。

### 1.2 核心问题

```
测试环境: Windows 10/11 x64
Antigravity 版本: 2.15.0 (Electron 架构)
代理软件: Clash/Mihomo (SOCKS5 127.0.0.1:7890)

测试结果:
  ✅ AG 2.14.0 + version.dll 代理 = 正常工作
  ❌ AG 2.15.0 + version.dll 代理 = AG 启动失败/白屏
  ✅ AG 2.15.0 + 系统原版 version.dll = 正常启动（无代理）
  ✅ AG 2.15.0 + TUN 模式 = 正常工作
```

**关键发现**: 问题不是 version.dll "失效"，而是 **AG 2.15.0 的某个特性与 version.dll 的 API Hook 机制冲突**。

---

## 二、技术架构

### 2.1 version.dll 工作原理

```
Antigravity.exe 启动
    ↓
Windows DLL 搜索顺序: 应用目录 → System32
    ↓
加载应用目录下的 version.dll（代理版本，劫持原版）
    ↓
DllMain(DLL_PROCESS_ATTACH) 执行
    ↓
├── 读取 config.json
├── MinHook 安装 API Hooks
└── 返回 TRUE
    ↓
Electron/Chromium 初始化
    ↓
网络请求 → connect() 被 Hook → 重定向到 SOCKS5 代理
```

### 2.2 Hook 的 API 清单

**网络 Hooks (ws2_32.dll):**
- `connect`, `WSAConnect`
- `getaddrinfo`, `GetAddrInfoW`
- `socket`, `WSASocketA/W`
- `WSAIoctl` (ConnectEx 捕获)
- `send`, `recv`, `WSASend`, `WSARecv`

**进程 Hooks (kernel32.dll):**
- `CreateProcessW`, `CreateProcessA` (子进程注入)

**IOCP Hooks (kernel32.dll):**
- `GetQueuedCompletionStatus`
- `GetQueuedCompletionStatusEx`

### 2.3 Chromium/Electron 网络架构

```
Electron 主进程 (Antigravity.exe)
    ↓
Chromium Network Service (独立子进程)
    ↓
Winsock API (ws2_32.dll)
    ↓
[version.dll Hook 拦截层]
    ↓
SOCKS5 代理 (127.0.0.1:7890)
```

---

## 三、测试矩阵

| 编号 | DLL | AG版本 | 配置 | 结果 |
|------|-----|--------|------|------|
| T1 | 无 | 2.15.0 | - | ✅ 正常 |
| T2 | 系统原版 | 2.15.0 | - | ✅ 正常 |
| T3 | 代理DLL | 2.14.0 | 完整 | ✅ 正常+代理生效 |
| T4 | 代理DLL | 2.15.0 | 完整 | ❌ AG 退出 |
| T5 | 代理DLL | 2.15.0 | child_injection=false | ❌ AG 退出 |
| T6 | 代理DLL | 2.15.0 | 移除主进程Hook | ❌ AG 退出 |
| T7 | 代理DLL | 2.15.0 | fake_ip=false | ❌ AG 退出 |
| T8 | 代理DLL | 2.15.0 | skip_iocp_hooks=true | ⚠️ AG启动但白屏 |
| T9 | 代理DLL | 2.15.0 | hook_delay_ms=3000 | ⚠️ AG启动但白屏 |
| T10 | 自编译DLL | 2.15.0 | 组合配置 | ⚠️ AG启动但白屏 |

---

## 四、日志分析

### 4.1 DLL 日志对比

**AG 2.14.0 (正常):**
```
Antigravity-Proxy DLL 已加载
配置加载成功
所有 API Hook 安装成功 (Phase 1-3)
SOCKS5: 隧道建立成功, 目标=oauth2.googleapis.com:443
SOCKS5: 隧道建立成功, 目标=daily-cloudcode-pa.googleapis.com:443
```

**AG 2.15.0 (异常):**
```
Antigravity-Proxy DLL 已加载
配置加载成功
所有 API Hook 安装成功 (Phase 1-3)
(无 SOCKS5 隧道日志)
```

### 4.2 AG main.log 对比

**AG 2.14.0 (正常):**
```
Starting app (v2.14.0) with dynamic port
Host bridge server listening on http://127.0.0.1:xxxx
Spawning: ...language_server.exe...
Local: https://127.0.0.1:xxxx/
```

**AG 2.15.0 + DLL (异常):**
```
(无新条目 - Electron 静默退出)
```

**AG 2.15.0 + 自编译DLL (白屏):**
```
Starting app (v2.15.0) with dynamic port
Host bridge server listening
Spawning: ...language_server.exe...
Local: https://127.0.0.1:xxxx/
Failed to load URL: https://127.0.0.1:xxxx/ with error: ERR_TIMED_OUT
```

### 4.3 language_server.log (白屏情况)

```
Post "https://oauth2.googleapis.com/token": 
  dial tcp 192.179.26.95:443: connectex: 
  A connection attempt failed because the connected party 
  did not properly respond after a period of time
```
**分析**: 网络请求超时，说明 Hook 可能没有正确拦截或代理链路有问题。

---

## 五、已排除的原因

| 可能原因 | 排除依据 |
|---------|---------|
| DLL 文件损坏 | 系统原版 DLL 正常，代理 DLL 在 2.14.0 正常 |
| 安全软件拦截 | 退出火绒/腾讯后问题依旧 |
| 位数不匹配 | AG 和 DLL 都是 x64 |
| VC++ 运行库缺失 | 已安装 v14.51 |
| 配置文件错误 | 多种配置组合测试均失败 |
| 代理端口问题 | 代理软件正常监听，2.14.0 可用 |
| 管理员权限 | 提权后问题依旧 |

---

## 六、待专家分析的问题

### 6.1 核心问题

**Q1**: 为什么系统原版 version.dll（无 Hook）能让 AG 2.15.0 正常启动，而代理 version.dll（有 Hook）会导致 AG 退出或白屏？

**Q2**: AG 2.15.0 更新了哪些可能导致与 API Hook 冲突的特性？（从更新日志看主要是 UI/UX 改进，未提及底层架构变化）

**Q3**: 自编译 DLL 使用 `hook_delay_ms=3000`（延迟安装 Hook）和 `skip_iocp_hooks=true`（跳过 IOCP Hook）后，AG 能启动但白屏，这说明什么？

**Q4**: 白屏的直接原因是什么？是 Hook 没有正确拦截 connect()，还是拦截后代理链路有问题？

### 6.2 技术细节

**Q5**: MinHook 的 inline hook 实现是否可能被 Chromium/Electron 的代码完整性检测机制识别？

**Q6**: Chromium Network Service 架构中，网络请求由哪个进程发起？DLL 应该在哪些进程中安装 Hook 才能正确拦截？

**Q7**: `GetQueuedCompletionStatus` Hook 是否与 Chromium 的异步 I/O 模型存在冲突？如果是，如何解决？

**Q8**: 除了 API Hook，还有哪些进程级代理注入方案可以考虑？（如 LSP、WFP、ETW 等）

### 6.3 AG 2.15.0 特有行为

**Q9**: AG 2.15.0 的 Electron 主进程为什么在 Hook 生效后静默退出？是否有异常处理机制在检测到 Hook 后主动退出？

**Q10**: 从日志看，AG 2.15.0 的 NetworkService 进程识别逻辑可能与 2.14.0 不同，这是否是问题根源？

---

## 七、相关文件

| 文件 | 说明 |
|------|------|
| `server.js` | EasyAG 后端（Node.js） |
| `backup/version.dll` | 代理 DLL（原始版本，548KB） |
| `backup/config.json` | 代理配置文件 |
| `host/WebView2Host.cs` | WebView2 窗口宿主源码 |
| `docs/DLL-DEBUG-REPORT.md` | 详细调试报告 |
| `docs/DLL-DEBUG-GUIDE.md` | 调试工具使用指南 |
| `diagnose.ps1` | 一键诊断脚本 |

**外部参考:**
- version.dll 源码: https://github.com/yuaotian/antigravity-proxy
- AG 更新日志: https://antigravity.google/changelog

---

## 八、当前工作状态

### 8.1 可用功能

- ✅ EasyAG 核心功能（汉化、自动审批、风控）在 AG 2.15.0 + TUN 模式下正常
- ✅ AG 2.14.0 + version.dll 免 TUN 代理正常
- ❌ AG 2.15.0 + version.dll 免 TUN 代理不工作

### 8.2 临时解决方案

1. **使用 TUN 模式** - 开启代理软件的 TUN 模式，全局接管流量
2. **降级 AG** - 使用 AG 2.14.0 并禁用自动更新
3. **等待适配** - 等待 version.dll 作者或社区适配 AG 2.15.0

---

*如有分析结果或建议，欢迎反馈*
