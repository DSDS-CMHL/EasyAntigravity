# EasyAntigravity（EasyAG）

**Turbo Mode 的副驾** —— 免 TUN 登录 · 界面汉化 · 高危命令风险旁路

<p align="center">苦反重力久矣。</p>

---

## 它做什么

| 能力 | 说明 |
|------|------|
| **免 TUN 代理** | 启动 Antigravity 时注入 Chromium 本地 HTTP 代理，不改系统代理、不用 TUN/DLL |
| **界面汉化** | CDP 只读词典，替换 UI 文案（不点击、不碰审批） |
| **高危旁路** | 官方 **Hooks** 在命令执行前匹配 `danger-rules` + EAS 病毒库，输出 **低/中/高** 风险与处方；命中则 `force_ask` |

自动放行交给官方 **Turbo Mode**；EasyAG **不做 CDP 自动审批**。

---

## 架构（一览）

```text
Antigravity 执行 run_command
        ↓  PreToolUse Hook（官方）
EasyAG  assessCommandRisk（danger-rules + EAS）
        ↓
   allow / force_ask   +  风险胶囊（低/中/高）
        ↓
官方弹窗由你决策

执行环结束
        ↓  Stop Hook（fullyIdle）
胶囊「任务完成」
```

- **Hooks**（官方扩展点）：危险门禁、任务完成  
- **CDP**：仅界面汉化  
- 详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/RULES.md](docs/RULES.md)

---

## 快速开始

1. 从 [Releases](../../releases) 下载对应平台压缩包，完整解压  
2. 运行 `EasyAntigravity.exe`（macOS 打开 `.app`）  
3. 确认本地代理端口（默认 `7890`，指向你的 HTTP 代理）  
4. 点 **启动 Antigravity**

首次运行会安装官方 Hooks（`~/.gemini/config/hooks.json` 中 `easyag-task-done` / `easyag-danger-gate`，可卸载）。

### 面板操作

| 按钮 | 作用 |
|------|------|
| 注入 ASK | 把 `danger-rules` 编译为官方 ASK 写入全局（退出可清理） |
| 清理注入 | 只移除 EasyAG 写入的条目，并恢复注入前策略 |
| 打开规则 / 重载 | 编辑 `danger-rules.json` |

---

## 规则与病毒库（可独立使用）

不装 EasyAG 也能用，适合 CLI / IDE 的 auto-accept 插件：

| 文件 | 规模 | 用途 |
|------|------|------|
| `danger-rules.json` | 19 条合并规则（带 severity） | 高危 ASK/Deny 黑名单 |
| `Agentguard-dev/src/rules/signatures.json` | 199 条 EAS | 病理 / 后果 / 安全替代 |

- 官方规则只填 **target**（如 `regex:rm -rf .*`），不要写 `command(…)` 外壳  
- 编译语义见 `docs/RULES.md`（单 token 整行 `^…$`，需 `.*(?:pat).*` 包裹）  
- 导出：`rules/feeds/easyag-danger-core.json`、`rules/feeds/antigravity-cli-ask.json`

```bash
node scripts/rules-packs.cjs validate
node scripts/rules-packs.cjs snapshot
node scripts/ag-config.cjs set-mode turbo EasyAntigravity
```

---

## 开发

```bash
npm install
npm start
npm test
```

| 路径 | 说明 |
|------|------|
| `server.js` / `index.html` | 后端 + 面板 |
| `scripts/rule-compile.cjs` | danger-rules → 官方 `command(regex:…)` |
| `scripts/easyag-*-hook.cjs` | 官方 Hooks 脚本 |
| `scripts/ag-config.cjs` | AG 权限 JSON 控制（快照/模式/规则） |
| `src-tauri/` | Tauri 壳（打包） |

---

## 安全说明

- 代理只改启动参数与环境变量，**不读写账号凭据**  
- Hooks 写入用户配置 `hooks.json`，可删除；`decision` 不阻止正常停止  
- 高危规则为**基础防呆**，无法穷尽所有变种；请自行增补，重要环境请备份  
- Antigravity 为 Google 产品，本项目与其官方无关。请遵守当地法律与软件许可协议。

## License

[MIT](./LICENSE)
