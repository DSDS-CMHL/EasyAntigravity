# Tauri 2 开发测试版

保留 2.0.1 的原生免 TUN、CDP 汉化、审批、高危规则、计数和日志界面。
当前分支为 feat/tauri-gui，稳定分发目录与 v2.0.1 Release 不修改。

## 退出排查

2.0.1 的 server.js 在 GUI 请求中断 30 秒后调用 quitApp；
index.html 的 pagehide / beforeunload 也会 POST /api/quit。
quitApp 会终止 EasyAG 与 Antigravity，因此后台节流或页面导航存在误退出路径。
原版只保留内存日志，当前稳定目录没有 easyag-error.log，无法还原用户那次退出的唯一原因。

迁移后移除心跳退出和页面卸载退出。状态轮询只更新 UI。
Tauri 原生窗口关闭时通过 stdin 发送 quit；宿主崩溃时管道 EOF 也触发后端清理。
Tauri 单实例插件聚焦已有窗口，后端使用动态回环端口并等待就绪文件，
不再额外启动 WebView2Host 或浏览器。
Windows 退出延续关闭 Antigravity 的行为；macOS 关闭由本启动器直接启动的 AG 进程组，
不会通过模糊 pkill 误杀其他应用。

## 分发与数据

CI 为 Windows x64、macOS Apple Silicon 和 Intel 分别构建。
Node 运行时作为 externalBin 随包提供，ws 与词典/页面作为资源提供。
用户无需安装 Node/Rust；Windows 使用系统 WebView2，macOS 使用 WKWebView。
规则首次复制到 Tauri app_local_data_dir；端口与开关也存于该目录。
日志为 easyag.log、backend-stderr.log、easyag-error.log，资源目录不承载写入数据。
测试版使用 com.easyag.launcher.tauri 标识，与稳定文件夹分开。
不要同时用稳定版与测试版控制同一个 AG（CDP 端口仍为 9333）。

## 构建与验证

本机无需 Rust。推送此分支后 Tauri Build 工作流在 GitHub runner 安装 Rust 并构建。
Windows 使用 --no-bundle 编译并组装完整便携 ZIP，解压后直接运行 EasyAntigravity.exe，
不产生 NSIS/MSI 安装器。macOS 产物为保留可执行权限的 .app ZIP，解压后直接打开，
无需安装或移动到 /Applications。
Windows 使用系统已有 WebView2 Runtime，不自动安装它；缺失运行库的系统需用户单独安装。
“免安装”指启动器本身；设置和日志仍保存在用户数据目录，不会写入 macOS .app 内。
Windows CI 会重新解压最终 ZIP，并用包内 Node 执行后端生命周期测试，核验依赖齐全。
macOS 为 ad-hoc 签名测试包，未进行 Apple notarization，Gatekeeper 可能要求用户批准。

CI 在打包资源副本上运行后端生命周期测试：
加载词典与规则、超过 30 秒无 GUI 请求、SSE 断线、设置重启恢复、
显式关闭和宿主管道断开。测试使用隔离数据目录，禁止启动/接管/终止真实 AG。
原生 GUI 及实际 AG 登录/审批兼容性仍需用户在目标机器测试。
