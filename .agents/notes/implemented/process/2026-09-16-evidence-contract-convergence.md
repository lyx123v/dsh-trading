# Agent Note: 证据契约收敛——三字段落账与五套刻度合一

Status: implemented

## Problem

「证据优先」以五套互不映射的刻度并存：company-analysis 的信源等级 S–E、知识卡 `factCheck` 三桶
（verified/discrepancies/unverifiable）、`facts/` 状态三态（verified/discrepancy/unverified）、
证据矩阵的「证据强度 强/中/弱」、各处「置信度 高/中/低」。同一件事——这条结论站不站得住——
每个角色各选一套。规则重复写在 preset `EVIDENCE` 常量、company-analysis（49 处证据类表述）、
knowledge-curation、weekly-trading-plan 四处，却**没有一处是结论级**：company-analysis 要求的
是报告末尾一份「来源与口径」清单，它证明查过资料，不证明某条结论指向哪条证据。

技能面另有结构缺口：证据方法论只随 company-analysis / crypto-instrument-analysis 分发给研究员，
`presets.ts` 的 role-skill 白名单里 trader 与 risk-reviewer 为空——真正下判断和做独立复核的
两个角色手里没有契约，只能依赖 preset 里那段长英文。

## Decision

定义唯一证据契约，结论逐条三字段落账：`来源等级`（S–E）+ `判定`（`supported` /
`contradicted` / `mixed` / `insufficient`）+ `锚点`（可回看位置：知识卡 id、`facts/` 条目、
公告或财报章节页码、工具名+参数+数值+数据时间）。写不出锚点按 `insufficient`；单一 C/D/E 级
来源不得单独支撑 `supported`；主源或工具不可用必须点名并写出缺口，不得静默用记忆、常识或弱源
替代。落点分三层，各放最少的东西：

1. **预设前缀（always-on）**：`packages/base/src/presets.ts` 新增 `VERDICT` 常量，注入四个角色
   persona 与三个委派子代理 persona。放这一层而非新 skill，因为它必须对
   trader / risk-reviewer 同样生效，不需要改白名单，也不会因 skill 是否被加载而失效。
2. **角色职责**：研究员逐条交付三字段；交易员每条计划意向写明所依据的锚点；风险审查员独立复核
   锚点存在性、单 C/D/E 单源定论与主源静默降级——不采信研究员自证。
3. **技能细目**：company-analysis 补契约入口、证据矩阵改为「优先级 / 来源等级 / 锚点 / 判定」并
   新增收尾缺口报告（must 未覆盖必须单列），template 三张表同步；crypto-instrument-analysis
   依据清单按三字段落账并补未覆盖项；weekly-trading-plan 事实层与每条意向补锚点与判定；
   crypto/futures/global risk-checklist 加「依据闸门」；knowledge-curation 补素材级三桶与结论级
   四态的层次说明（知识卡 schema 不动）。

## Alternatives considered

新建 base skill `evidence-discipline` 承载契约：需进 role-skill 白名单才可见，仍会随「是否加载」
失效，且与 preset 现有 `EVIDENCE` 段落形成第二处重复——选 preset 前缀。把 S–E 五级表整段搬进
preset：前缀是每轮固定成本，且 company-analysis 的表带市场口径示例（10-K/20-F、Wind、互动易），
搬走会同时丢掉领域细节——preset 只定义字母与一级含义，细表留在 skill。改知识卡 schema 把
`factCheck` 三桶换成四态：200+ 存量卡片要迁移，且三桶记录素材级核查、四态是结论级判定，本就
不同层——只加层次说明。沿用「证据强度 强/中/弱」：它与来源等级、判定都相关又都不等价，是第三把
尺——删列，由锚点顶替位置。

## Consequences

- persona 变长约 180 词/角色，属 Layer 1 静态前缀；四角色与三个委派人设共享同一刻度。
- persona 层结构变为 角色文本 → DOCTRINE → EVIDENCE → VERDICT → JOURNAL → 市场清单；
  [2026-09-06-hypothesis-scarcity-doctrine.md](../feature/2026-09-06-hypothesis-scarcity-doctrine.md)
  记录的旧结构已同步更新并指向本记录。
- `presets.test.ts` 新增契约断言（`Evidence contract`、`source grade, verdict, anchor`、
  四态串、`one C/D/E source may never alone support a conclusion`）。
- 技能副本经 `pnpm build`（sync-skills）分发到 base 与各市场 kit 资产；company-analysis 与
  weekly-trading-plan 的 portable 目录副本（含 templates）同步；cowork 工作区的
  weekly-trading-plan live 副本按双副本约定同步（该副本所在仓库不属本仓，未提交）。
- **本变更只立契约与落点，不新增确定性门禁**：结论条目的机器校验（引用覆盖率、未锚定条目数、
  单 C/D/E 单源计数）属演进闭环第三步「固化为 Gate」，未在本变更实现。

## Verification

`npx vitest run packages/base/test/presets.test.ts` 13 例通过。生成态 persona 目检确认 `VERDICT`
注入四个角色与三个代表 delegation 的委派 persona（`presets.test.ts` 的 16 组市场子集断言覆盖）；
技能侧人工核对 company-analysis 证据矩阵列与 template 列数一致（三张表均 13 列）。
