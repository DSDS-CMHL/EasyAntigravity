# EasyAntigravity 便携版

Windows：完整解压发布包，运行 EasyAntigravity.exe。保留同目录 easyag-node.exe 和 backend 文件夹。
桌面外壳使用系统 WebView2 Runtime；缺失时需安装对应运行库。

macOS（Beta）：解压对应 Apple Silicon 或 Intel 的 ZIP，打开 EasyAntigravity.app。
发布包自带 Node.js，无需安装 Node 或 Rust。未经过 Apple 公证的测试版可能需要在系统设置中允许打开。

## 使用与退出

选择 HTTP/Mixed 代理端口，按需开启汉化，选择 Turbo Pilot 或兼容模式。
Pilot 一键开启终端自动执行并叠加原生权限规则；兼容模式沿用用户权限设置。
工作区之外的文件访问和沙箱策略请在 AG 内自行设置。

关闭主窗口收起至托盘，后台继续运行。托盘“退出应用”会恢复 EasyAG 的增强配置并结束后台。
AG 退出也会恢复配置。EasyAG 退出不会强制结束其他 AG 进程。
页面刷新和界面断连不会触发退出。

## 用户数据

数据目录由 Tauri 的 app_local_data_dir 提供，包含：

- settings.json：代理端口、启动模式、汉化及风险说明开关。
- danger-rules.json：用户可编辑的权限规则。
- permission-session.json：尚未完成恢复的配置变更记录。
- easyag.log：有界轮转运行日志。

不要在存在未恢复会话时删除 permission-session.json。异常中断后再次启动 EasyAG 会尝试恢复。
风险日志可能含命令片段，对外分享日志前请检查内容。
