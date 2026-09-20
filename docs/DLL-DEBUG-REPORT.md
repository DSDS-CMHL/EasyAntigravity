# Antigravity Proxy DLL 兼容性问题调试报告

**日期**: 2026-09-20  
**项目**: EasyAntigravity / antigravity-proxy  
**目的**: 分析 version.dll 代理注入组件与 Antigravity 2.15.0 的兼容性问题

---

## 1. 问题概述

### 1.1 背景

Antigravity 是 Google 的 AI 编程助手（Electron 架构）。在中国大陆使用时，需要通过代理访问 Google API。`antigravity-proxy` 项目使用 `version.dll` 劫持技术，为 Antigravity 提供免 TUN 模式的进程级代理注入。

### 1.2 问题描述

在开发者个人测试环境下发现：
- **Antigravity 2.14.0** + version.dll 代理 → ✅ 正常工作
- **Antigravity 2.15.0** + version.dll 代理 → ❌ 出现异常

**重要发现**：问题可能不是 version.dll "失效"，而是 **AG 2.15.0 的某个新特性/行为变化与 version.dll 的 Hook 机制产生冲突**。

---

## 2. 测试环境

### 2.1 硬件/软件环境

| 项目 | 值 |
|------|-----|
| 操作系统 | Windows NT 10.0.26200.0 |
| Antigravity 版本 | 2.15.0 (测试机: 2.14.0) |
| AG 安装路径 | `%LOCALAPPDATA%\Programs\antigravity` |
| 代理软件 | Mihomo (Clash Meta) |
| 代理端口 | 127.0.0.1:7890 (SOCKS5) |
| 安全软件 | 腾讯电脑管家 + 火绒（测试确认未拦截） |

### 2.2 version.dll 信息

| 版本 | 大小 | 来源 | 测试结果 |
|------|------|------|----------|
| 原始版 (v2.0) | 548 KB | yuaotian/antigravity-proxy | AG 2.14.0 ✅ / AG 2.15.0 ❌ |
| v2.4 | 617 KB | GitHub Release | AG 2.15.0 ❌ |
| 系统原版 | 55 KB | Windows System32 | AG 2.15.0 ✅ (无代理功能) |
| 自编译版 | 3.5 MB | 本地 MinGW-w64 编译 | AG 2.15.0 ⚠️ 启动但白屏 |

---

## 3. 测试矩阵与结果

### 3.1 核心测试矩阵

| 测试编号 | DLL 版本 | AG 版本 | 配置 | 结果 |
|---------|----------|---------|------|------|
| T1 | 无 DLL | 2.15.0 | - | ✅ AG 正常启动 |
| T2 | 系统原版 version.dll | 2.15.0 | - | ✅ AG 正常启动 |
| T3 | 原始代理 DLL (548KB) | 2.14.0 | 完整配置 | ✅ AG 启动 + 代理生效 |
| T4 | 原始代理 DLL (548KB) | 2.15.0 | 完整配置 | ❌ AG 启动即退出 |
| T5 | v2.4 DLL (617KB) | 2.15.0 | 完整配置 | ❌ AG 启动即退出 |
| T6 | 自编译 DLL | 2.15.0 | skip_iocp_hooks=true, hook_delay_ms=3000 | ⚠️ AG 启动但白屏 |
| T7 | 原始代理 DLL | 2.15.0 | child_injection=false | ❌ AG 启动即退出 |
| T8 | 原始代理 DLL | 2.15.0 | target_processes 移除 Antigravity.exe | ❌ AG 启动即退出 |
| T9 | 原始代理 DLL | 2.15.0 | 最小配置 (仅 Antigravity.exe) | ❌ AG 启动即退出 |
| T10 | 原始代理 DLL | 2.15.0 | fake_ip=false | ❌ AG 启动即退出 |

### 3.2 关键结论

```
✅ 系统原版 version.dll + AG 2.15.0 = 正常启动
❌ 代理 version.dll + AG 2.15.0 = 启动失败

→ 问题不在 DLL 文件替换本身
→ 问题在 DLL 安装的 API Hooks 与 AG 2.15.0 冲突
```

---

## 4. 日志分析

### 4.1 version.dll 日志 (proxy-YYYYMMDD.log)

**AG 2.14.0 正常情况：**
```
[时间] [PID:xxx] Antigravity-Proxy DLL 已加载 (模拟 version.dll)
[时间] [PID:xxx] 配置加载成功
[时间] [PID:xxx] 所有 API Hook 安装成功 (Phase 1-3)
[时间] [PID:xxx] SOCKS5: 隧道建立成功, 目标=oauth2.googleapis.com:443
[时间] [PID:xxx] SOCKS5: 隧道建立成功, 目标=daily-cloudcode-pa.googleapis.com:443
```
**分析**: DLL 加载 → Hook 安装 → 代理隧道建立，全流程正常

**AG 2.15.0 异常情况：**
```
[时间] [PID:xxx] Antigravity-Proxy DLL 已加载 (模拟 version.dll)
[时间] [PID:xxx] 配置加载成功
[时间] [PID:xxx] 所有 API Hook 安装成功 (Phase 1-3)
(无后续 SOCKS5 日志)
```
**分析**: DLL 加载和 Hook 安装显示成功，但：
- 无 SOCKS5 隧道日志
- AG main.log 无新条目（Electron 未启动到网络请求阶段）
- AG 进程静默退出

### 4.2 AG main.log 对比

**AG 2.14.0 (无 DLL，正常启动):**
```
[时间] Starting app (v2.14.0) with dynamic port
[时间] Host bridge server listening on http://127.0.0.1:xxxx
[时间] Spawning: ...language_server.exe...
[时间] [Auto-Restart] Port changed! Reloading all windows
[时间] Local: https://127.0.0.1:xxxx/
```

**AG 2.15.0 (有 DLL，启动失败):**
```
(无任何新条目)
```
**关键差异**: AG 2.15.0 在 DLL Hook 生效后，Electron 主进程完全没有输出日志就退出了。

**AG 2.15.0 (自编译 DLL + 延迟 Hook，白屏):**
```
[时间] Starting app (v2.15.0) with dynamic port
[时间] Host bridge server listening on http://127.0.0.1:7529
[时间] Spawning: ...language_server.exe...
[时间] [Auto-Restart] Port changed! Reloading all windows
[时间] Local: https://127.0.0.1:7530/
[时间] Failed to load URL: https://127.0.0.1:7530/ with error: ERR_TIMED_OUT
```
**分析**: Electron 启动了，但 UI 加载超时（白屏）

### 4.3 language_server.log (AG 2.15.0 + 自编译 DLL)

```
[错误] Post "https://oauth2.googleapis.com/token": 
       dial tcp 192.179.26.95:443: connectex: 
       A connection attempt failed because the connected party 
       did not properly respond after a period of time
```
**分析**: 
- 网络请求直接超时
- 请求尝试连接 Google IP (192.179.26.95)
- 说明请求**没有经过代理**（代理应该看到 SOCKS5 连接日志）
- Hook 可能没有正确拦截 connect() 调用

---

## 5. version.dll 工作原理分析

### 5.1 DLL 劫持机制

```
Antigravity.exe 启动
    ↓
Windows 加载 version.dll (DLL 搜索顺序: 应用目录优先)
    ↓
加载我们的代理 version.dll (而非系统原版)
    ↓
DllMain(DLL_PROCESS_ATTACH) 执行
    ↓
├── 加载 config.json
├── 安装 API Hooks (MinHook)
└── 返回 TRUE
    ↓
Electron/Chromium 初始化
    ↓
网络请求 → connect() 被 Hook → 重定向到 SOCKS5 代理
```

### 5.2 Hook 的 API 清单

**Phase 1 - 网络 Hooks (ws2_32.dll):**
- socket, WSASocketA/W
- connect, WSAConnect
- getaddrinfo, GetAddrInfoW
- WSAConnectByNameA/W
- WSAIoctl (用于捕获 ConnectEx)
- WSAGetOverlappedResult

**Phase 2 - 进程创建 Hooks (kernel32.dll):**
- CreateProcessW
- CreateProcessA

**Phase 3 - 流量监控 Hooks (ws2_32.dll):**
- send, recv, WSASend, WSARecv
- sendto, recvfrom (UDP)

**IOCP Hooks (kernel32.dll):**
- GetQueuedCompletionStatus
- GetQueuedCompletionStatusEx

### 5.3 Chromium/Electron 的网络架构

```
Electron 主进程 (Antigravity.exe)
    ↓
Chromium Network Service (独立子进程)
    ↓
网络请求 (connect, DNS 解析等)
    ↓
Winsock API (ws2_32.dll)
    ↓
[我们的 Hook 在这里拦截]
```

**关键点**: Chromium 的网络请求由独立的 Network Service 进程处理，不是主进程。

---

## 6. 假设与分析

### 6.1 假设 A: IOCP Hook 冲突

**依据**: 
- Chromium 使用 IOCP (I/O Completion Ports) 进行异步网络 I/O
- GetQueuedCompletionStatus/Ex 是 Chromium 网络栈的核心 API
- AG 2.15.0 可能更新了 Chromium 版本，改变了 IOCP 使用方式

**测试结果**:
- 自编译 DLL 设置 `skip_iocp_hooks=true`
- AG 启动成功但白屏
- 说明跳过 IOCP Hook 能让 AG 启动，但代理功能失效

**结论**: IOCP Hook 可能是导致 AG 退出的原因之一，但跳过它们会导致代理不工作

### 6.2 假设 B: Hook 时序问题

**依据**:
- AG 2.15.0 可能改变了 Electron 启动顺序
- Hook 在 DllMain 中安装，此时 Electron 还未初始化
- 某些 Hook 可能在错误的时机拦截了关键调用

**测试结果**:
- 设置 `hook_delay_ms=3000` (延迟 3 秒安装 Hook)
- AG 启动成功但白屏
- 延迟期间的网络请求未被拦截

**结论**: 延迟 Hook 能让 AG 启动，但初始请求逃逸

### 6.3 假设 C: Electron/Chromium 版本更新

**依据**:
- AG 2.14.0 → 2.15.0 更新日志提到多项修复
- 可能包含 Electron/Chromium 底层更新
- Chromium 网络栈变化可能导致 Hook 冲突

**测试结果**:
- 无法直接确认 Chromium 版本变化
- AG 更新日志未明确提及

### 6.4 假设 D: 反注入/完整性检测

**依据**:
- AG 2.15.0 可能添加了代码完整性检查
- 检测到 API 被 Hook 后主动退出

**测试结果**:
- 系统原版 version.dll 无 Hook → AG 正常
- 代理 version.dll 有 Hook → AG 退出
- 符合"检测到 Hook 后退出"的行为

**反证**:
- 自编译 DLL 延迟 Hook 后 AG 能启动
- 如果有完整性检测，应该在启动时就失败

### 6.5 假设 E: Network Service 进程检测

**依据**:
- DLL 日志显示: "Antigravity.exe 使用 NetworkService 旁路模式"
- 原版 DLL 代码中检测 Chromium NetworkService 进程
- AG 2.15.0 可能改变了进程命名或启动方式

**DLL 源码相关逻辑**:
```cpp
static bool IsChromiumNetworkServiceProcess() {
    const wchar_t* commandLine = GetCommandLineW();
    return commandLine != nullptr &&
           std::wcsstr(commandLine, L"--utility-sub-type=network.mojom.NetworkService") != nullptr;
}

// 在 DllMain 中:
const bool bypassNetworkService =
    Hooks::IsAntigravityHostProcessName(processName) && IsChromiumNetworkServiceProcess();
const bool enableNetworkHooks = !bypassNetworkService;
```

**分析**: 如果 AG 2.15.0 的 NetworkService 进程启动参数变化，可能导致检测逻辑失效

---

## 7. 已尝试的解决方案

| 方案 | 配置 | 结果 |
|------|------|------|
| 禁用 child_injection | child_injection=false | ❌ AG 仍退出 |
| 移除主进程 Hook | target_processes 不含 Antigravity.exe | ❌ AG 仍退出 |
| 最小化配置 | 仅 Hook Antigravity.exe | ❌ AG 仍退出 |
| 禁用 fake_ip | fake_ip=false | ❌ AG 仍退出 |
| 跳过 IOCP Hook | skip_iocp_hooks=true | ⚠️ AG 启动但白屏 |
| 延迟 Hook 安装 | hook_delay_ms=3000/5000 | ⚠️ AG 启动但白屏 |
| 完全静态链接编译 | -static | ⚠️ AG 启动但白屏 |
| 管理员权限运行 | - | ❌ AG 仍退出 |
| 退出安全软件 | 关闭火绒/腾讯 | ❌ AG 仍退出 |

---

## 8. 关键问题（请 CS 专家分析）

### 8.1 核心问题

**Q1**: 为什么系统原版 version.dll（无 Hook）能让 AG 2.15.0 正常启动，而代理 version.dll（有 Hook）会导致 AG 退出？

**Q2**: AG 2.15.0 的哪些变化可能导致与 API Hook 的冲突？（Electron 更新？Chromium 网络栈变化？代码完整性检测？）

**Q3**: 自编译 DLL 延迟安装 Hook 后 AG 能启动（但白屏），这说明什么？

**Q4**: 代理功能失效（白屏）的原因是什么？是 Hook 没有正确拦截，还是拦截后代理链路有问题？

### 8.2 技术细节问题

**Q5**: MinHook 的 API Hook 实现（inline hook/detour）是否可能被 Chromium 的代码完整性校验检测到？

**Q6**: Chromium 的 Network Service 架构中，哪些进程负责实际的网络 I/O？DLL 应该在哪些进程中安装 Hook？

**Q7**: `GetQueuedCompletionStatus` Hook 是否可能与 Chromium 的异步 I/O 模型冲突？如果是，如何正确处理？

**Q8**: 有没有其他更稳定的进程级代理注入方式，不依赖 API Hook？

---

## 9. 附录

### 9.1 相关文件

- **DLL 源码**: https://github.com/yuaotian/antigravity-proxy
- **EasyAG 项目**: https://github.com/DSDS-CMHL/EasyAntigravity
- **AG 更新日志**: https://antigravity.google/changelog

### 9.2 AG 2.15.0 更新内容摘要

```
Release Date: September 18, 2026
Title: Custom agent controls and keyboard navigation

Improvements (7):
- Custom agents can switch off default prompts/tools
- Keyboard navigation enhancements
- Sidebar performance improvements
- Drag-and-drop improvements

Fixes (16):
- Settings/state file reading changes
- Permission settings duplicate entries fix
- Process management changes
- Conversation state fixes
```

**注意**: 更新日志未明确提及 Electron/Chromium 版本变化或安全检测机制。

### 9.3 DLL Hook 安装日志示例

```cpp
// Hooks.cpp - Hook 安装流程
void Install(bool enableNetworkHooks) {
    MH_Initialize();
    
    if (enableNetworkHooks) {
        // Phase 1: 网络 Hooks
        MH_CreateHookApi(L"ws2_32.dll", "connect", ...);
        MH_CreateHookApi(L"ws2_32.dll", "getaddrinfo", ...);
        // ...
        
        // IOCP Hooks
        MH_CreateHookApi(L"kernel32.dll", "GetQueuedCompletionStatus", ...);
        MH_CreateHookApi(L"kernel32.dll", "GetQueuedCompletionStatusEx", ...);
    }
    
    // Phase 2: 进程创建 Hooks
    MH_CreateHookApi(L"kernel32.dll", "CreateProcessW", ...);
    MH_CreateHookApi(L"kernel32.dll", "CreateProcessA", ...);
    
    MH_EnableHook(MH_ALL_HOOKS);
}
```

---

## 10. 总结

### 10.1 已确认的事实

1. AG 2.15.0 + 系统原版 version.dll = 正常启动
2. AG 2.15.0 + 代理 version.dll (有 Hook) = 启动失败
3. 问题与 Hook 有关，不是 DLL 替换本身
4. 跳过部分 Hook 或延迟 Hook 能让 AG 启动，但代理功能失效
5. 安全软件、权限、配置选项均排除为原因

### 10.2 待解决的核心问题

1. **找出 AG 2.15.0 与 Hook 冲突的具体原因**
2. **找到既能启动 AG 又能让代理工作的 Hook 策略**
3. **确定是否有比 API Hook 更稳定的代理注入方案**

---

*报告生成时间: 2026-09-20*  
*如有疑问请参考附录中的源码和日志文件*
