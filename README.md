<p align="center">
  <img src="assets/logo-128.png" width="80" alt="EasyAG">
</p>

<h1 align="center">EasyAG Lite</h1>

<p align="center">免 TUN 代理 · 可逆界面汉化 · 上下文圆环</p>

EasyAG 是 Antigravity 的轻量启动器，支持桌面版与 IDE 启动选择。当前发行版本为 **4.0.4 Lite**，完整更新内容见 [发布说明](docs/RELEASE-v4.0.4.md)。

## 功能

- **免 TUN 代理**：启动时向程序传入本地代理配置，支持常用端口和自定义端口。直连环境可关闭；EasyAG 不提供代理节点。
- **启动目标选择**：在桌面版与 IDE 版间切换，自动寻找安装位置。找不到程序时才弹出路径设置，支持手动输入、浏览选择、保存及恢复默认。
- **可逆界面汉化**：桌面版通过 CDP 动态翻译界面，关闭开关后恢复原文，不修改安装包。
- **上下文圆环**：桌面版输入区显示最近请求的上下文估算，详情提供采样模型与输出速度。估算值不代表服务端精确计费。
- **热更新**：检查更新可拉取词典与后台/UI 补丁，执行 SHA-256 校验；原生外壳升级仍需下载完整包。
- **后台驻留**：关闭窗口后继续驻留托盘或 macOS 顶部菜单栏；macOS 隐藏窗口时隐藏 Dock 图标。

桌面版与 IDE 的增强能力不同。目前 IDE 支持启动和代理配置，界面汉化与上下文监控未接入 IDE。CLI Companion 在 [cli-edition 分支](https://github.com/DSDS-CMHL/EasyAntigravity/tree/cli-edition) 独立开发，不集成到本程序。

## 下载与使用

1. 在 [Releases](https://github.com/DSDS-CMHL/EasyAntigravity/releases) 下载对应系统的完整包。
2. Windows 完整解压后运行 `EasyAntigravity.exe`，保留同目录 `easyag-node.exe` 和 `backend` 文件夹；macOS 解压后打开应用。
3. 打开自己的代理客户端，选择对应 HTTP / Mixed 端口，或关闭免 TUN 代理使用直连。
4. 选择桌面版或 IDE，点击启动。若程序已经打开，请保存工作并退出，再通过 EasyAG 启动。

从托盘或顶部菜单栏选择“退出应用”可彻底退出 EasyAG。详细使用方式见 [便携版说明](docs/PORTABLE.md)。

macOS Apple Silicon / Intel 包仍为 Beta，未经过 Apple 公证。Dock 修复涉及原生外壳，需要替换整个应用。已显示内部 4.0.4 的用户也请下载本次完整包，同版本补丁不会由旧更新器重复安装。

## 版本说明

当前 Lite 版专注代理、汉化与上下文监控。Turbo Pilot、ARES 风险提示等历史功能属于 [v3.2.4](https://github.com/DSDS-CMHL/EasyAntigravity/releases/tag/v3.2.4)，代码保留在 `v3-pilot` 分支。

## 开发

基于 Tauri、Node.js 和原生 Web 前端。需要 Node.js 22 或更高版本；构建原生应用还需要 Rust 和平台构建依赖。

```sh
npm ci
npm start
npm run check
npm test
```

浏览器交互回归使用独立测试页面和模拟接口，不会启动真实 Antigravity：

```sh
npm run test:launcher:browser -- "浏览器可执行文件的完整路径"
```

三个平台的发布包均由 GitHub Actions 从同一份代码构建，并提供 SHA-256 校验和。

## 致谢

- 汉化词典来源于社区整理，包括 [nicktan @ linux.do](https://linux.do/t/topic/2896116)。
- 上下文监控相关实现参考 [Antigrative Dashboard / AG Pulse](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard)（MIT 协议）。

EasyAG 为独立社区项目，与 Google 官方无关。使用 [MIT License](LICENSE)，第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
