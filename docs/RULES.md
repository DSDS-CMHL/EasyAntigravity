# 原生权限规则与 ARES

## 两类资产

| 资产 | 文件 | 职责 |
| --- | --- | --- |
| 权限规则 | `danger-rules.json` | 编译成 AG 原生 Allow / Deny / Ask 资源 |
| ARES | `knowledge/signatures.json` | 风险等级、触发条件、成因、后果与执行前检查建议 |

权限配置与风险解释分开运行。Pilot 固定开启 ARES，兼容模式关闭 ARES；风险等级不直接决定 Allow / Deny / Ask。
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

2026-10-11 的实机对照显示：无前瞻规则命中 Ask，加入正向或负向前瞻后均未命中。原生权限表达式不能依赖这些语法；详细样例、验证边界与待测项见 [AG 权限正则实机语义](AG-权限正则实机语义.md)。此结论不代表已查明 AG 的内部正则引擎。

内置权限规则版本 7 已重写含前瞻的四类表达式，并修正 rm 选项结束符和常见 Git 全局选项，迁移已知旧版默认模式。编译器拒绝前瞻，也保守拒绝尚未实测的后顾；包含这些断言的自定义权限规则需要手动改写，加载失败时不覆盖上次成功加载的内存规则。ARES 本地知识表达式不受原生权限语法限制。

Pilot 支持严格、标准（默认）、宽松三档防护强度，选择影响原生审批范围而非 ARES 风险等级。启动时应用，运行期间锁定，退出仍按原有 journal 恢复；兼容模式不应用并保留偏好。具体边界、模块职责和待验收样例见 [防护强度机制](防护强度机制.md)。

## 生效时机

编辑数据目录中的规则文件，点击重载可立即更新风险解释。
原生权限规则在下一次通过 EasyAG 启动时重新编译、写入和校验。
重载不会在 AG 正在执行任务时静默更换其权限配置。

Pilot 仅叠加必要规则，记录实际新增条目。恢复时保留用户已有规则及后续修改。
不自动扩大文件权限，也不改变用户沙箱设置。

## 规则包维护

稳定保留规则 `id`，新增或修订检测模式时提供无害正负样例。
ARES 条目包含 `root_cause`、`destructive_impact`、`safe_alternative`；后果与建议分别描述。

ARES 唯一维护源是 `knowledge/signatures.json`，开发运行与发布打包读取同一份数据。
`Agentguard-dev/src/rules/signatures.json` 是旧开发工具的兼容副本，`rules/feeds/ares-signatures.json` 是分发副本；二者标记 `generated_from`，不独立编辑。
修改源文件后，使用 `node scripts/sync-knowledge.cjs --write` 显式同步副本，不会修改用户数据目录。
旧开发扫描器的副本保留其要求的大写风险等级，其余内容与源同步；桌面运行时使用统一的小写等级。
ARES 分发包不能通过权限规则的 `merge` 命令导入，避免把风险说明特征误写成审批规则。

### 知识条目约定

- `id` 统一使用 ARES；旧 EAS 编号保存在条目的 `legacy_ids` 和文档的 `legacy_id_map`。一条旧综合规则可以对应多条更准确的规则。
- `name` 是面向用户的简短标题；英文特征名放入 `feature_code`，不再作为弹窗主标题。
- `trigger_conditions` 说明文本命中条件及尚未确认的上下文，不把正则命中当成攻击证据。
- `severity` 统一为 `high`、`medium`、`low`，不把风险等级等同于权限动作。
- `destructive_impact` 描述具体对象、可能变化和限制条件，不使用“必然整机崩溃”“永久无法恢复”等无条件断言。
- `safe_alternative` 是执行前检查建议，不是可以直接复制执行的安全认证；改用另一工具不自动消除风险。
- `priority` 在同一风险等级内优先选用具体解释，例如敏感目录和变量路径优先于通用删除说明。
- `review_status: context-required` 表示仅凭工具名、引号或组合语法无法确定危害，必须检查完整参数；不意味着已经检测到注入。
- `merged_from` 保留被合并条目的旧模式供追溯，不参与运行时匹配。`source_refs` 与历史样例不代表已逐项验证。

本轮主要规整知识结构和文案，未运行匹配测试或实机验证；`test_cases` 为历史样例，不构成已通过验证的承诺。

```sh
node scripts/rules-packs.cjs validate
node scripts/rules-packs.cjs snapshot
npm test
```

规则包位于 `rules/feeds/`，维护工具是开发工具，不随桌面运行时分发。
不会因为内置规则版本较新而直接覆盖用户的数据目录文件。
