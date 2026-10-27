## 新增 Antigravity IDE 支持

**EasyAG Lite 现在支持 Antigravity IDE 了。**

在启动器中选择 **“桌面版”** 或 **“IDE 版”**，即可启动对应程序。IDE 同样支持免 TUN 代理，不需要为了使用 IDE 开启系统全局 TUN。

程序默认自动检测安装位置；安装在其他目录、无法自动找到时，会弹出路径选择窗口，保存一次后即可继续使用。

> IDE 目前支持启动与代理配置。界面汉化和上下文圆环仍用于桌面版，尚未接入 IDE。

## 如何升级

- **Windows 用户**：点击顶栏 **“检查更新”**，完成后从托盘彻底退出 EasyAG，再重新打开即可，无需重新下载。
- **macOS 用户**：本次包含 Dock 图标行为修复，请下载对应芯片的完整包，退出 EasyAG 后替换整个应用。原有配置可保留。

<details>
<summary>其他改进与修复（点击展开）</summary>

优化启动与路径配置流程，修复部分按钮无响应、路径输入被刷新覆盖等问题；路径窗口支持浏览、手动输入、恢复默认及取消后重新打开。

新增免 TUN 代理开关，直连环境可关闭；启动中及运行时锁定相关设置。改善长会话上下文采集、模型名称解析和界面布局，屏蔽多余的浏览器右键菜单，并优化热更新下载。

macOS 隐藏窗口后会隐藏 Dock 图标，继续驻留顶部菜单栏，可从菜单栏重新显示窗口。这项修复涉及原生外壳，需要下载完整包。

</details>

<details>
<summary>首次下载与特殊升级情况（点击展开）</summary>

| 系统 | 下载文件 |
| --- | --- |
| Windows x64 | `EasyAntigravity-4.0.4-lite-windows-x64.zip` |
| macOS Apple Silicon | `EasyAntigravity-4.0.4-lite-macos-arm64-beta.zip` |
| macOS Intel | `EasyAntigravity-4.0.4-lite-macos-x64-beta.zip` |

Windows 新用户请完整解压，运行 `EasyAntigravity.exe`，保留同目录的运行环境和 backend 文件夹。macOS 仍为 Beta，未经过 Apple 公证；Dock 行为仍需 Mac 实机确认。

如果界面已显示内部测试版 **4.0.4**，或“检查更新”按钮无法使用，请下载本次完整包。旧更新器会跳过同版本补丁，无法通过再次检查更新取得此次修复。

CLI Companion 独立开发和发布，不包含在本次更新中。

</details>
