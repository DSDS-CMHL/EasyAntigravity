# EasyAntigravity（EasyAG）

AG 桌面端的启动器与 Turbo 副驾：免 TUN 代理、界面汉化、一键自动审批与原生权限规则。

## 功能

| 功能 | 行为 |
| --- | --- |
| 进程代理 | 启动参数与环境变量指向本地 HTTP/Mixed 代理，保留回环直连 |
| 汉化 | 通过 CDP 翻译界面文案；关闭时恢复 EasyAG 修改的原文 |
| Turbo Pilot | 启动前开启终端自动执行并叠加 Allow / Deny / Ask 权限规则 |
| 风险说明 | Pilot 下用 ARES 给出低、中、高风险提示，兼容模式关闭 |
| 托盘与胶囊 | 启动后收起窗口；风险提示可关闭、超时消失、点击返回 AG |

权限执行由 AG 自身完成；EasyAG 负责配置操作的一键化和风险解释。
风险提示不替代原生权限规则，也不自动点击审批按钮。

当前专注 AG 桌面端。上下文、额度与速度面板属于后续接入项；AG IDE 与 AG CLI 尚未适配。
Hook 执行机制已移除，升级时仅清理可识别的旧 EasyAG Hook 注册。

## 使用

1. 完整解压对应平台的发布包，运行 EasyAntigravity。
2. 选择常见代理端口，或输入自定义 HTTP/Mixed 端口。
3. 保留或关闭汉化，选择启动模式，点击启动 AG。

| 模式 | 配置行为 |
| --- | --- |
| Turbo Pilot | 自动审批 + 原生权限规则，风险说明单独开关 |
| 兼容模式 | 使用代理与汉化，沿用用户原有审批和权限设置 |

文件访问范围和沙箱策略由用户在 AG 中自行设置。EasyAG 只更改终端自动执行字段，因此 AG 的预设标签可能显示为自定义；不会为了让标签显示 Turbo 而扩大文件权限。

AG 退出或 EasyAG 退出时移除本次新增的规则，恢复原执行策略。原本缺失的字段仍保持缺失；运行中用户对同一策略做了修改时保留新选择。异常中断的恢复记录在下次启动时处理。
关闭主窗口会收起至托盘；从托盘退出应用才结束 EasyAG。退出不强制结束其他 AG 进程。

## 开发

需要 Node.js 22 或更高版本。

```sh
npm ci
npm start
npm run check
npm test
npm run test:tauri-lifecycle
```

开发入口使用浏览器面板；发布版使用 Tauri 外壳，自带 Node.js 与依赖。

| 路径 | 职责 |
| --- | --- |
| `server.js` | 薄启动入口、退出信号 |
| `core/` | 会话、设置、事件、原子存储 |
| `features/` | 代理、规则、汉化、风险说明、通知 |
| `adapters/desktop/` | 桌面发现、权限配置、CDP、渲染器接入、旧版迁移 |
| `desktop/` | 模块组装、本地 HTTP/SSE、桌面外壳通信 |
| `ui/` | 面板样式、界面交互、API 客户端 |
| `src-tauri/` | 原生窗口、托盘、Node 后台生命周期 |
| `scripts/backend-resources.cjs` | 发布资源白名单 |
| `test/` | 模块行为、接口、CDP、汉化、发布资源与生命周期验证 |

详见 [总体架构](docs/ARCHITECTURE.md)、[权限规则与 ARES](docs/RULES.md)、[便携版说明](docs/PORTABLE.md)。

## 规则资产

`danger-rules.json` 是权限规则来源，`knowledge/signatures.json` 是统一的 ARES 风险知识库；旧 EAS 编号保留映射供追溯。
规则引擎按 `action` 编译为 Allow / Deny / Ask，未填写时默认为 Ask。发布包将 ARES 独立放入 `backend/knowledge/`。

这些规则属于基础防呆，无法覆盖全部命令变种。请在目标 AG 版本中验证原生规则的实际行为。

## 致谢与链接

汉化词典主要来源：[nicktan @ linux.do](https://linux.do/t/topic/2896116)。

反重力账号相关问题：[社区文档](https://zcn91ppq6ur7.feishu.cn/wiki/L748wAHTriwwGVkc7TSc3TSennb)。
友链：[linux.do](https://linux.do)。

Antigravity 为 Google 产品，本项目与其官方无关。

## License

[MIT](LICENSE)
