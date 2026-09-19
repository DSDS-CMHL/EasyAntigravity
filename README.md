# EasyAntigravity

<p align="center">
  <img src="assets/logo-128.png" alt="EasyAntigravity" width="96" height="96" />
</p>

<p align="center">
  <strong>自动审批 · 高危拦截 · 免 TUN 登录 · 汉化界面</strong>
</p>

<p align="center">苦反重力久矣。</p>

---

## 简介

**EasyAntigravity（EasyAG）** 是 Windows 上面向 Google Antigravity 的本地控制台，把常用增强收进一个小面板：

- **免 TUN 代理**：自动部署 `version.dll` 补丁，进程走本地 SOCKS5；客户端更新抹掉补丁后会自动从备份恢复
- **界面汉化**：通过 CDP 注入词典，实时翻译界面文案
- **自动审批**：识别权限卡片并按策略一键放行，日志里会带上请求内容摘要
- **高危拦截**：放行前按 `danger-rules.json` 规则扫描危险命令并熔断

---

## 开箱即用

1. 打开 [Releases](../../releases)，下载最新的 **`EasyAntigravity-v*-win-x64.zip`**
2. 解压到任意目录（建议路径不要过深、避免中文权限问题目录）
3. **双击 `EasyAntigravity.exe`**
4. 确认面板里的 SOCKS5 端口与本机代理一致（默认 `7890`）
5. 点击 **启动 Antigravity**

> 请使用 Release 里的 zip 完整解压，不要只拷贝一个 exe。

---

## 高危规则

规则文件为 exe 同目录下的 `danger-rules.json`（首次启动会从 `backup/` 生成）。

面板「自动化审批与高危风控」中：

- **打开规则**：用系统默认程序编辑 JSON
- **重载**：保存后立即生效

可按正则自行增删规则；顶层或单条 `enabled: false` 可停用。

---

## 自动审批选项

| 选项 | 含义 |
|------|------|
| 1 | 仅允许本次 |
| 2 | 对话中始终允许 |
| 3 | 项目中始终允许 |
| 4 | 全局始终允许（默认） |

支持中英文按钮文案，汉化开启时同样可用。

---

## 开发者（可选）

```powershell
git clone https://github.com/DSDS-CMHL/EasyAntigravity.git
cd EasyAntigravity
npm install
npm start
```

打包：

```powershell
npx pkg@5.8.1 . --targets node18-win-x64 --output EasyAntigravity.exe --compress GZip
```

---


## 致谢

| 来源 | 说明 |
|------|------|
| [nicktan @ linux.do](https://linux.do/t/topic/2896116) | 界面汉化词典主要来源 |
| [antigravity-2.0-no-tun-login-proxy](https://github.com/2531565073zzc-ux/antigravity-2.0-no-tun-login-proxy) | 免 TUN方案 |
| [AntiGravity-AutoAccept](https://github.com/yazanbaker94/AntiGravity-AutoAccept) | 自动审批交互思想参考 |


</details>

## License

[MIT](./LICENSE)

Antigravity 为 Google 产品，本项目与其官方无关。请遵守当地法律与软件许可协议。

## 友链
[linux.do](https://linux.do)

## 反重力账号相关问题
[一位不知名佬友写的]https://zcn91ppq6ur7.feishu.cn/wiki/L748wAHTriwwGVkc7TSc3TSennb


