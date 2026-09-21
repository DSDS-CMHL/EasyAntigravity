# EasyAntigravity Tauri 免安装测试版

Windows：完整解压 ZIP，双击 EasyAntigravity.exe。请保留同目录的
easyag-node.exe 和 backend 文件夹，不要单独拷贝主 exe。
使用系统已安装的 Microsoft Edge WebView2 Runtime，不会自动安装运行库。

macOS：解压对应 Apple Silicon / Intel 的 ZIP，直接打开 EasyAntigravity.app。
无需移到 Applications，也不需要安装 Node 或 Rust。
测试版尚未 Apple 公证，首次打开可能需要通过系统“隐私与安全性”允许。

设置、规则和日志存于用户数据目录：
- Windows：%LOCALAPPDATA%/com.easyag.launcher.tauri
- macOS：~/Library/Application Support/com.easyag.launcher.tauri

关闭原生窗口会结束 EasyAG 后端；页面刷新或后台停留不会触发心跳退出。
测试时先关闭稳定版，避免两个启动器同时控制 AG。
