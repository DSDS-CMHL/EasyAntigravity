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

- **原生免 TUN 代理**：启动时为 Chromium 设置本地 HTTP 代理，并将代理环境变量传给语言服务；不改系统代理、不启用 TUN、不加载网络 Hook
- **界面汉化**：通过 CDP 注入词典，实时翻译界面文案
- **自动审批**：先记录权限请求；仅在实际点击最终确认按钮后才记录放行与批准计数
- **高危拦截**：放行前按 `danger-rules.json` 规则扫描危险命令并熔断
---

> [!WARNING]
> **⚠️ 不要依赖 Turbo Mode 实现自动审批**
> 
> <details>
> <summary><b>点击展开查看「官方全字匹配缺陷」与「实测删库记录」</b></summary>
>
> #### 1. 机制缺陷剖析
> - **仅支持全字匹配（无通配符/无正则）**：官方拦截规则（`permissionGrants`）必须与执行字符串 100% 完全一致。若规则设置 `rm -rf` 为 `Ask`，一旦命令携带路径（如 `rm -rf "F:\project"`），该规则便会直接判定为**“未命中”**。
> - **Turbo Mode 默认静默全放行**：在 Turbo 模式下，只要命令未被精准命中，系统一律视为安全并在后台**毫秒级直接静默执行**，零弹窗、零确认，没有任何核对反应时间。
>
> #### 2. 开发者实测结果
> - **测试环境**：Windows 11 / Antigravity 官方桌面端（开启 Turbo Mode）
> - **预置规则**：显式将 `rm -rf` 与 `cmd /c rmdir` 设为 `Ask` (每次询问)
> - **AI 执行命令**：  
>   `cmd /c rmdir /s /q "F:\EasyAntigravity\safety-turbo-test"`
> - **实测结果**：  
>   ❌ **规则失效**：命令因附带完整路径，与预置规则不完全一致，未被拦截。  
>   ⚠️ **静默粉碎**：Turbo Mode 直接放行，**全程零弹窗、零确认**，测试目录被瞬间物理粉碎。
>
> #### 3. 官方配置的正则机制可自行测试是否生效，目前开发者测试—审批框的命令添加，例如永久允许某个命令添加到官方规则集里都是全量添加字段。因此目前不建议采用Turbo Modo替代自动审批功能。
>
> </details>


## 开箱即用

1. 打开 [Releases](../../releases)，下载对应平台的最新安装包：
   - **Windows**：`EasyAntigravity-2.1.1-windows-x64.zip`
   - **macOS（社区测试版 / Beta）**：`EasyAntigravity-2.1.1-tauri-macos-arm64-beta.zip`（Apple Silicon）或 `EasyAntigravity-2.1.1-tauri-macos-x64-beta.zip`（Intel）
2. 完整解压 ZIP 到任意目录（请保留目录内所有文件，不要单独拷贝主可执行程序）
3. 运行程序：
   - Windows：双击 `EasyAntigravity.exe`
   - macOS：直接打开 `EasyAntigravity.app`（首次运行如遇拦截，请在系统「隐私与安全性」中点击允许）
4. 确认面板里的 SOCKS5 端口与本机代理一致（默认 `7890`）
5. 点击 **启动 Antigravity**

> 请使用 Release 里的 zip 完整解压运行，不要只单独拷贝可执行文件。

---

## 高危规则

规则文件为 exe 同目录下的 `danger-rules.json`。

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
| 4 | 全局始终允许 |

默认使用选项 1（仅允许本次），避免将授权扩大为长期或全局规则。

支持中英文按钮文案，汉化开启时同样可用。

---

## 开发者（可选）

```powershell
git clone https://github.com/DSDS-CMHL/EasyAntigravity.git
cd EasyAntigravity
npm install
npm start
```

### 免 TUN 实现

默认采用原生代理模式：EasyAG 启动 Antigravity 时传入 Chromium 的 `--proxy-server=http://127.0.0.1:<端口>`，同时将 `HTTP_PROXY`、`HTTPS_PROXY` 传给语言服务，并让本地回环地址直连。该方案不改系统代理、不需要 TUN，也不依赖 DLL 注入。

旧版 DLL 兼容模式可显式使用 `node server.js --dll-proxy`，但已弃用；该模式依赖 `version.dll`，与 AG 2.15.0 冲突。需要旧版兼容时请使用历史 release，新版请使用默认原生代理模式。

打包：

```powershell
npx pkg@5.8.1 . --targets node18-win-x64 --output EasyAntigravity.exe --compress GZip
```

---


## 致谢

| 来源 | 说明 |
|------|------|
| [nicktan @ linux.do](https://linux.do/t/topic/2896116) | 界面汉化词典主要来源 |
| ~~[antigravity-2.0-no-tun-login-proxy](https://github.com/2531565073zzc-ux/antigravity-2.0-no-tun-login-proxy)~~ | 已弃用：其 `version.dll` 注入方案与 AG 2.15.0 冲突；新版改用 Chromium 启动参数与语言服务代理环境变量实现免 TUN。 |
| [AntiGravity-AutoAccept](https://github.com/yazanbaker94/AntiGravity-AutoAccept) | 自动审批交互思想参考 |


</details>

## License

[MIT](./LICENSE)

Antigravity 为 Google 产品，本项目与其官方无关。请遵守当地法律与软件许可协议。

## 友链
[linux.do](https://linux.do)

## 反重力账号相关问题
[一位不知名佬友写的]https://zcn91ppq6ur7.feishu.cn/wiki/L748wAHTriwwGVkc7TSc3TSennb


