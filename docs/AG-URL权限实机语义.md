# AG URL 权限实机语义

## 验证边界

2026-10-12，用户在 Windows AG 桌面端手动验证 U1–U5，并反馈“都符合预期”；随后验证 U6，反馈“直接拒绝了”。本机安装的 Antigravity.exe 文件版本为 2.22.0，产品版本为 2.22.0.0；此版本从安装文件读取，未另行确认正在运行的进程版本。EasyAG 当前发布版本为 v3.2.0。

仅验证 AG 原生网页读取权限；不以网页抓取成功与否判断权限命中，不代表浏览器交互、重定向、终端联网或 MCP 联网均受同样限制。未运行自动化测试。

## 临时配置

保留用户原有权限和其他设置，仅增加：

- Allow：`read_url(*)`
- Ask：`read_url(example.com)`
- Deny：`read_url(example.org)`

原配置已备份至 `C:\Users\Xiaohtgz\.gemini\config\config.easyag-url-probe-before-20261012.json`。测试结束应仅撤回此次新增规则，不应整份覆盖配置，以免丢失期间的用户修改。

## 实机结果

提示 AG 使用 read_url_content 直接读取指定网页，不使用终端、搜索或浏览器点击；出现审批时取消，不选择始终允许。

| 编号 | 目标 | 预期 | 用户实机结果 |
| --- | --- | --- | --- |
| U1 | `https://www.wikipedia.org` | 自动放行 | 符合预期 |
| U2 | `https://example.com` | Ask | 符合预期 |
| U3 | `https://example.com/?easyag_probe=1` | Ask，查询参数不改变域名命中 | 符合预期 |
| U4 | `https://www.example.com` | Ask，覆盖子域名 | 符合预期 |
| U5 | `https://example.org` | 直接拒绝 | 符合预期 |
| U6 | `https://example.com`，保留 Ask 并将同一域名加入 Deny | 直接拒绝，验证 Deny 优先于 Ask | 用户确认直接拒绝 |

## 已确认与未确认

- 全量 Allow 配合指定域名 Ask / Deny，在上述样例中能够表达默认自动读取、风险域名审批或拒绝。
- Ask 和 Deny 均能覆盖全量 Allow；U6 确认 Deny 与 Ask 同时命中时直接拒绝。上述样例实机验证优先级为 Deny > Ask > Allow。
- example.com 的规则覆盖 www.example.com；带查询参数的 URL 仍命中 Ask。
- 官方文档规定按域名匹配并忽略路径，但本轮 U3 仅实际测试查询参数，不能将任意路径的行为标为已实测。
- 未确认 URL 正则、端口、协议、IP、重定向目标、浏览器 execute_url、终端沙箱及跨版本行为。
- URL 读取放行不等于点击、输入等浏览器操作放行，也不是全局恶意网站防护或数据外泄防护。

官方依据：[AG 权限文档 Windows 部分](https://www.antigravity.google/docs/permissions#Windows)。正式纳入 EasyAG 前应保持用户原配置、记录本次新增条目，并在模式退出时仅撤回自身注入。

## 测试清理

2026-10-12，U6 验收后撤回本轮新增的 Allow `read_url(*)`、Ask `read_url(example.com)`、Deny `read_url(example.org)` 和 Deny `read_url(example.com)`。保留用户原有 `read_url(github.com)` 和全部命令权限、其他配置；备份保留供核查。未构建、推送或运行自动化测试。
