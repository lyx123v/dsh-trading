# Agent Note: 白名单缺省被归一为空数组导致角色预设内置技能全空

Status: implemented

## Problem

2026-09-14 用户在 DSH Trading 桌面版发现 master 会话完全没有仓库内置技能：`crypto-risk-checklist`、`crypto-instrument-analysis`、`indicator-authoring`、`trading-strategy-paradigms`、`knowledge-curation`、`trading-notes-setup`、各市场 risk-checklist 与 `dynamic-capabilities` 全部缺席。

桌面 master 会话 `session-0ad06977-b43f-49b5-8ee2-2cc4a7147afd` 实读：`<available_skills>` 43 条全部来自文件系统（`/Users/zcl/cowork/.agents/skills` 与 `~/.agents/skills`），但同一会话的 kit 专属工具 `crypto_funding_rate` / `crypto_get_fundamentals` / `crypto_get_news` 在场——插件 `apply` 已执行，唯独 `ctx.skills.registerProvider(...)` 注册出来的目录是空的。

根因在配置 schema，与 preset scope/layer 无关。`packages/base/src/role-skills.ts` 与五个 `packages/kit-*/src/index.ts` 的 `Config` 使用 `skills: Schema.array(Schema.string())`；schemastery 会把缺席字段归一为 `[]`，而 `providerForSkills` 的判据是 `if (!allowed) return provider`——`[]` 为真值，于是按「显式白名单」处理并过滤出 0 项。master 恰好是唯一不写白名单的角色（`KIT_SKILLS.master = () => null`、`BASE_SKILLS.master = null`），全量目录整块消失；trader / instrument-researcher / risk-reviewer 因显式白名单照常拿到子集。Web 端看似正常，只是因为会话工作区正是仓库本身，仓库 `.agents/skills/` 的同名技能盖住了缺口。

profile 已构建产物直接解析 master 预设形态的 config 即可复现：

- `Config({ dryRun: true, liveTrading: false }).skills` → `[]`（kit-*）
- `Config({}).skills` → `[]`（role-skills）
- `providerForSkills(解析值).list()` → 0 项
- `providerForSkills(['crypto-risk-checklist', ...]).list()` → 4 项（白名单角色正常）

## Decision

- `packages/base/src/role-skills.ts` 与 `packages/kit-{crypto,us,cn,hk,futures}/src/index.ts`：白名单字段改为 `Schema.union([Schema.array(Schema.string()), Schema.const(null)]).default(null)`，`interface Config.skills` 放宽为 `string[] | null`，`providerForSkills(allowed?: readonly string[] | null)`。字段缺席时解析结果不含 `skills`（`undefined`），维持「全量捆绑目录」；显式 `[]` 仍是空目录（kit-futures 既有安全语义）；显式白名单仍是子集。
- 回归测试补在 `packages/base/test/role-skills.test.ts`、`packages/kit-crypto/test/skills.test.ts`、`packages/kit-futures/test/skills.test.ts`：断言 `Config({}).skills` 为 `undefined`、`providerForSkills(该解析值)` 返回全量 provider，且显式 `[]` 仍为空。测试必须经过 `Config(...)` 解析，而不是只直调 `providerForSkills()`——旧用例正是漏在这一层。

## Alternatives considered

- **把 `[]` 一律当成「未配置」**：会抹掉显式空名单语义；kit-futures 现有用例明确断言空名单不下发任何技能，它是白名单 fail-closed 的一部分——拒绝。
- **在 `packages/base/src/presets.ts` 为 master 逐一列出全部 kit 候选**：候选在 kit 包内，跨市场组合无法静态穷举，且违背「master 无白名单 = 全量」的设计意图——拒绝。
- **仅用 `.default(null)` 不加 union**：`default(value: T)` 要求 `T = string[]`，`null` 不可赋值，TypeScript 拒绝——拒绝。
- **沿 2026-09-07 记录的「scope 层级差异」继续排查**：同一预设里的 `skill-filesystem` provider 可见、工具可见，只有随包 provider 为空，指向 provider 内容而非层级；该假设被本次实证推翻——拒绝。

## Consequences

- master（及其他无白名单角色）恢复完整内置技能目录；`crypto-*`、`us/cn/hk/futures-risk-checklist`、共享技能与 `dynamic-capabilities` 重新进入 catalog。
- 有白名单的 trader / instrument-researcher / risk-reviewer 行为不变。
- 桌面版生效需重建仓库包并刷新 `~/.dsh-trading/profiles/trading-web`（`scripts/refresh-trading-web-profile.sh` 会先停掉 trading-web 实例），再重启桌面 app；非 trading-web profile 的运行中宿主不受影响。
- 修正 [角色预设技能面](2026-09-07-role-preset-skill-surface.md) 的错误归因：缺口不是 scope/layer，也不是「company-analysis 来自 base role-skills provider」。
