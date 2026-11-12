## 应对 AG 退出后的后台进程残留

**本次重点：AG 窗口已经关闭，却因 sidecar 等后台进程残留而无法再次启动时，可以直接在 EasyAG 中处理。**

我们在 Windows 的 Antigravity 2.31.0 上复现了退出后 sidecar 未回收、多次开关后持续累积的情况；直接使用 TUN 启动也能复现。

EasyAG 检测到已有进程时，会显示专用弹窗，提供 **“清理并重新启动”**。如果界面已经显示“运行中”，点击原启动按钮也能打开处理窗口，无需重启电脑或手动寻找 PID。

清理前请保存 AG 中的工作，并确认没有需要保留的后台任务。操作会结束当前用户、所选安装路径对应的 AG 进程；确认退出后再重新启动，清理失败则停止后续启动。EasyAG 不会自动清理进程。这是对 AG 退出行为的兼容处理，AG 自身的回收问题仍需上游修复。

感谢 [shallFun4Learning](https://github.com/shallFun4Learning) 提交 [PR #18](https://github.com/DSDS-CMHL/EasyAntigravity/pull/18) 提供方案和复现信息；本次在其原始提交上调整后合并，保留贡献记录。

## 如何升级

- **已有 Windows / macOS Lite 用户**：点击顶栏 **“检查更新”**，完成后从托盘或菜单栏彻底退出 EasyAG，再重新打开。此次功能更新可通过热更新获取。
- 如果更新按钮无法使用，请下载对应平台的完整包，退出 EasyAG 后替换。macOS 用户如果还需要此前的 Dock 图标修复，仍需更换完整应用。

<details>
<summary>其他更新（点击展开）</summary>

**新版 AG 汉化跟进**：补充 238 条词典项，总计 3376 条。覆盖设置、权限说明、语音选择、浏览器、通知、项目设置和快捷键提示，并适配额度恢复倒计时等动态文案。

**底层端点模型标识**：上下文圆环详情新增接口返回的端点模型标识，与界面的采样模型名称分开展示。取不到时显示“—”；该标识来自 AG 返回的元数据，不代表对实际服务端模型身份的独立验证。

进程冲突与路径失效分别提示，不再因已有进程而误弹路径选择窗口。Mac ARM 打包环境更新为受支持的 macOS 15。

进程恢复已在 Windows 实机验证，macOS 实际清理行为仍待反馈。IDE 继续支持启动、代理和上下文圆环；汉化仅用于桌面版。

</details>

<details>
<summary>完整包下载与说明（点击展开）</summary>

| 平台 | 文件名 |
| --- | --- |
| Windows x64 | `EasyAntigravity-4.0.5-lite-windows-x64.zip` |
| macOS Apple Silicon | `EasyAntigravity-4.0.5-lite-macos-arm64-beta.zip` |
| macOS Intel | `EasyAntigravity-4.0.5-lite-macos-x64-beta.zip` |

Windows 完整解压后运行 `EasyAntigravity.exe`，保留同目录运行环境和 backend 文件夹。macOS 包仍为 Beta，未经过 Apple 公证。每个平台均提供 SHA-256 校验文件。

CLI Companion 独立开发和发布，不包含在本次更新中。

</details>
