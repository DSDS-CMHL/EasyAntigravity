# 规则库 / 病毒库 可持续更新

两个「定义库」是产品核心资产：**用户可改、社区可推、可回滚**。  
**规则文件可独立分发**——不装 EasyAG 也能用，CLI / IDE 的 auto-accept 插件（autoaccept、autoagy 等）同样能吃。

| 你是谁 | 怎么用 |
|--------|--------|
| EasyAG 桌面用户 | 面板「注入 ASK」一键写入 |
| Antigravity CLI / IDE | 合并 `rules/feeds/antigravity-cli-ask.json` 到 `settings.json`，或在 UI 里粘 target |
| 自写 auto-accept 插件 | 把 `danger-rules.json` 当黑名单源，命中即停/询问 |

愿意的话丢个 star；改规则请改 `id` 稳定的那 102 条，别重开一套。

| 库 | 文件 | 角色 |
|----|------|------|
| **高危规则** | `danger-rules.json` | EasyAG 编译 → 官方 ASK |
| **EAS 病毒库** | `Agentguard-dev/src/rules/signatures.json` | Ask 旁路：病理 / 后果 / 安全替代 |

---

## 1. 版本与身份

- 规则 **`id` 稳定不变**（如 `rm-rf`、`EAS-016`），改的是 `pattern` / 文案。
- `danger-rules.json`：`version` 整数递增。
- `signatures.json`：semver + `updated_at`。
- 发布 pack：`rules/feeds/<pack-name>.json`

```json
{
  "pack": "easyag-danger-core",
  "version": 2,
  "updated_at": "2026-09-25T00:00:00Z",
  "rules": [ { "id": "rm-rf", "pattern": "...", "flags": "i", "enabled": true } ]
}
```

---

## 2. 合并策略（本地优先）

```text
远端 feed  ──merge──►  danger-rules.json  ──compile──►  官方 ASK
                ▲
                │ 用户 enabled=false / 改过 pattern → 不覆盖
```

| 情况 | 行为 |
|------|------|
| feed 新 id | 追加 |
| 本地 `enabled: false` | 保持停用 |
| 用户改过 `pattern` | 保留用户写法 |
| feed 修正 pattern 且本地未改 | 采用 feed |
| 合并后校验失败 | **不写盘** |

```bash
node scripts/rules-packs.cjs validate
node scripts/rules-packs.cjs merge rules/feeds/easyag-danger-core.json
node scripts/rules-packs.cjs snapshot
```

---

## 3. 发布渠道（渐进）

| 阶段 | 做法 |
|------|------|
| 现在 | 仓库内 `rules/feeds/`，随 Release 分发 |
| 下一步 | GitHub Release 挂 feed JSON |
| 以后 | EasyAG「检查规则更新」拉 feed → 预览 diff → merge |

门禁：`validate` + `rule-compile.test.js`（编译不得含字面空白 / 双重包裹）。

---

## 4. 贡献约定

1. **只加检测正则**，不写利用载荷。  
2. 稳定 `id` + 无害触发样例（如 `echo shutdown`）。  
3. EAS 必填 `root_cause` / `destructive_impact` / `safe_alternative`。  
4. 合并前 `validate` + `npm test`。

---

## 5. 上游知识库（不从 MSDN 考古）

| 来源 | 收什么 |
|------|--------|
| **LOLBAS** | 白加黑：rundll32/mshta/certutil/bitsadmin… |
| **David Deley**《How Command Line Parameters Are Parsed in Windows》 | `\` `"` 折叠数学 |
| **Command Injection 逃逸矩阵** | `^`、`%VAR:~0,1%` 切片、非对称引号 |

`signatures.json` 的 `sources` 字段记录来源；新增病例标 `category: lolbas / argument_injection_collapse / command_injection_escape`。

---

## 6. 当前规模

- danger-rules：**102**（删除 / 磁盘 / 账号 / 服务 / 下载执行 / Git / DB / 引导 / 容器 / 转储…）  
- EAS signatures：**199**（LOLBAS / Deley / 注入逃逸 / Windows 怪癖）  
- 发布物：`rules/feeds/easyag-danger-core.json` · `rules/feeds/antigravity-cli-ask.json`
