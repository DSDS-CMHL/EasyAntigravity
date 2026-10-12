# EasyAG v3.2.4

让启动器准备连接、汉化和权限增强，启动后继续专注于 Antigravity。

## 下载

- **Windows x64**：下载 `EasyAntigravity-3.2.4-windows-x64.zip`，完整解压后运行 `EasyAntigravity.exe`。不要单独移动 EXE，保留 `backend` 与 `easyag-node.exe`。
- **macOS Apple Silicon（Beta）**：下载 `EasyAntigravity-3.2.4-macos-arm64-beta.zip`。
- **macOS Intel（Beta）**：下载 `EasyAntigravity-3.2.4-macos-x64-beta.zip`。

macOS ZIP 使用 ditto 打包，并经过 ZIP 完整性、解压入口及可执行权限校验。macOS 构建仍为 Beta，未经过 Apple 公证。

## 这一版有什么

- **Turbo Pilot / 兼容模式**：自动执行与危险命令原生审批一键配置；兼容模式沿用用户权限，仍可使用代理、汉化与上下文显示。
- **三档防护强度**：严格、标准、宽松，默认标准；工作区外文件访问与沙箱设置仍由用户自行决定。
- **输入区轻量指标**：加粗上下文圆环；圆润风险盾牌跟随最近命中等级，显示该等级的会话次数，100 起显示 `99+`，详情保留准确分类及总计。生成速度放在上下文详情。
- **默认网页读取放行**：Pilot 注入 `read_url(*)`，保留用户已有域名 Ask/Deny；不自动允许浏览器操作 `execute_url`，兼容模式不注入，退出仅撤回自身新增权限。
- **规则重载**：运行中的 Pilot 同步更新 AG 原生权限，不再只刷新风险识别；禁用或删除的本会话注入可撤回。
- **配置恢复**：重载规则纳入恢复记录，退出撤回本会话增强，保留用户原规则及运行期间在 AG GUI 新增的规则。
- **风险胶囊**：请求去重、先隐藏再激活 AG；原生窗口设为不获取输入焦点，阻断回车/空格默认审查点击。EasyAG 不替用户允许或拒绝审批。

## 修复

- 修复 #7：`globalPermissionGrants` 为空对象、缺少权限数组或包含 null 时导致 Pilot 启动失败。
- 修复 #10 对应的 macOS ZIP 分发问题：不再发布旧的 v3.0.0 损坏压缩包，本版重新构建并校验 ZIP 后上传。

## 升级与边界

升级前正常退出旧版 EasyAG 和 AG，再完整解压到新目录。不要沿用指向旧版目录的快捷方式，不要删除未完成恢复的 `permission-session.json`。

新增/禁用规则重载、重载后正常退出恢复、用户 GUI 新增规则保留、兼容模式已有用户实机反馈。异常退出恢复本轮未实测；新原生焦点处理仍需各机器实际验证。圆环占用为最近请求的宿主估算，不代表模型实际记忆能力。

ARES 是风险辅助，不是防病毒软件或完整安全隔离；规则可能误报和漏报，风险计数不等于已阻止执行次数。macOS Beta 的机器兼容性仍欢迎反馈。

原生文件来自成功构建 [38231379632](https://github.com/DSDS-CMHL/EasyAntigravity/actions/runs/38231379632)，原生代码提交 `25f11dd707234170453801ed353bb5b4cdfa5b4b`。本次只替换 URL 读取补丁相关的后台 JavaScript（提交 `24388a5`），复用现有 EXE/Node，macOS 重新签名并验证，没有重新编译原生程序。重新打包记录：[38253249164](https://github.com/DSDS-CMHL/EasyAntigravity/actions/runs/38253249164)。上游 MIT 版权与许可保留在 `backend/THIRD-PARTY-NOTICES.md`。
