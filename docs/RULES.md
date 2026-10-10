# 原生权限规则与 ARES

## 两类资产

| 资产 | 文件 | 职责 |
| --- | --- | --- |
| 权限规则 | `danger-rules.json` | 编译成 AG 原生 Allow / Deny / Ask 资源 |
| ARES | `Agentguard-dev/src/rules/signatures.json` | 风险等级、成因、后果与安全替代方案 |

权限配置与风险解释分开运行。关闭风险说明不会关闭已应用的权限规则。
当前权限规则来自 19 条合并规则；实际数量以文件和面板显示为准。

## 规则格式

```json
{
  "id": "example-delete",
  "name": "删除操作需要确认",
  "pattern": "\\brm\\s+-rf\\b",
  "flags": "i",
  "action": "ask",
  "severity": "high",
  "enabled": true
}
```

`action` 可选 `allow`、`deny`、`ask`，省略时默认 `ask`。
`enabled: false` 停用单条规则；文档级 `enabled: false` 停用全部权限规则。
无效正则或动作使加载失败，保留之前成功加载的内存规则。Pilot 没有可用权限规则时停止启动。

AG 配置列表中的条目采用 `command(regex:…)` 格式。编译器负责包装，避免 `command(command(…))`。
现有本地模拟器按已记录的整行匹配语义验证，用 `.*(?:pattern).*` 表达部分匹配。它是开发自检，不替代 AG 实机测试。

## 生效时机

编辑数据目录中的规则文件，点击重载可立即更新风险解释。
原生权限规则在下一次通过 EasyAG 启动时重新编译、写入和校验。
重载不会在 AG 正在执行任务时静默更换其权限配置。

Pilot 仅叠加必要规则，记录实际新增条目。恢复时保留用户已有规则及后续修改。
不自动扩大文件权限，也不改变用户沙箱设置。

## 规则包维护

稳定保留规则 `id`，新增或修订检测模式时提供无害正负样例。
ARES 条目包含 `root_cause`、`destructive_impact`、`safe_alternative`；后果与建议分别描述。

```sh
node scripts/rules-packs.cjs validate
node scripts/rules-packs.cjs snapshot
npm test
```

规则包位于 `rules/feeds/`，维护工具是开发工具，不随桌面运行时分发。
不会因为内置规则版本较新而直接覆盖用户的数据目录文件。
