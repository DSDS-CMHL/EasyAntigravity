# EasyAntigravity 4.0.4 Lite 便携版

Windows：完整解压发布包，运行 EasyAntigravity.exe。保留同目录 easyag-node.exe 和 backend 文件夹。无需自行安装 Node.js 或 Rust，外壳需要系统 WebView2 Runtime。

macOS（Beta）：下载 Apple Silicon 或 Intel 对应的 ZIP，解压后打开 EasyAntigravity.app。未经过 Apple 公证。升级时替换整个应用，保留系统中的用户数据目录。

## 使用与退出

选择 HTTP/Mixed 本地代理端口，按需开启或关闭免 TUN 代理。选择桌面版或 IDE 并启动。默认自动检测路径；只有找不到程序或启动失败时才弹出路径配置。

关闭窗口后继续驻留 Windows 托盘或 macOS 顶部菜单栏。macOS 窗口隐藏时同时隐藏 Dock 图标；菜单中的“显示窗口”可以重新打开。彻底退出请在托盘或菜单栏选择“退出应用”。EasyAG 退出不会强制关闭其他 Antigravity 进程。

IDE 支持启动、代理配置和上下文圆环，可查看当前会话占用、采样模型与速度；界面汉化仍仅用于桌面版。CLI Companion 独立发布，不包含在本便携包中。

## 用户数据与更新

用户数据由外壳存放在系统应用数据目录，包含 settings.json、运行日志、词典补丁和后台/UI 热更新。升级完整包不需要删除这些配置。

Windows Lite 版用户可在顶栏点击“检查更新”，完成后从托盘彻底退出 EasyAG，再重新打开，即可获得本次后台与界面修复，无需重新下载便携包。

热更新无法替换原生外壳。macOS 用户要获得 Dock 修复，需要重新下载并替换整个应用。已显示 4.0.4 但尚无 IDE 圆环、或检查更新按钮无法使用的用户，请下载本次修订包，避免旧更新器跳过同版本补丁。

日志可能包含本地路径，对外分享前请检查内容。
