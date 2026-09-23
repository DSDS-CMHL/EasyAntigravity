# EasyAntigravity v2.2.0 便携版指南

Windows：完整解压 ZIP，双击 EasyAntigravity.exe。请保留同目录的
easyag-node.exe 和 backend 文件夹，不要单独拷贝主 exe。
使用系统已安装的 Microsoft Edge WebView2 Runtime，不会自动安装运行库。

macOS（社区测试版 / Beta）：解压对应 Apple Silicon / Intel 的 ZIP，直接打开 EasyAntigravity.app。
无需移到 Applications，也不需要安装 Node 或 Rust。
测试版尚未 Apple 公证，首次打开可能需要通过系统“隐私与安全性”允许。

设置、规则和日志存于用户数据目录：
- Windows：%LOCALAPPDATA%/com.easyag.launcher.tauri
- macOS：~/Library/Application Support/com.easyag.launcher.tauri

关闭原生窗口会结束 EasyAG 后端；页面刷新或后台停留不会触发心跳退出。
测试时先关闭稳定版，避免两个启动器同时控制 AG。

## ⚠️ 安全与风控须知
1. 内置高危规则属于通用基础防呆机制，静态正则无法 100% 穷举所有命令变种（如脚本包装、提权执行、引号转义塌陷等）。
2. 用户可按需在面板点击「打开规则」补充专属规则，保存后点「重载」即时生效。
3. 当触发高危拦截（界面高亮警示、日志输出 SECURITY ALERT）或系统弹出 Windows UAC 管理员提权弹窗时，EasyAG 已停止自动代点，请务必逐字仔细核查当前指令，切勿盲目手动放行！
4. 切勿在未备份重要数据或核心生产设备上完全脱离人工监管运行 AI Agent。
