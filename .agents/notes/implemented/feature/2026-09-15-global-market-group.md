# Agent Note: global 市场 market-group 平权（bundle + kit + global_get_ticker 命名族）

Status: implemented

## Problem

金十接入（[2026-09-13 金十连接器](./2026-09-13-jin10-mcp-flash-news-connector.md)）交付 `global` 市场时走了**最小数据面切片**：无 bundle、无 kit、patch 行归 base，agent 侧只有连接器自有工具 `global_instruments/global_quote/global_klines`。该 note 明确留下后续步骤：owner 要 market-group 平权（bundle + kit + `global_get_ticker` 命名族 + persona 市场列表）时，按 [2026-09-12 futures 市场分组](./2026-09-12-futures-market-group.md) 清单落地。owner 2026-09-15 拍板执行。

不平权的实际代价：专家角色（researcher/risk-reviewer）没有 `global_get_ticker/_get_klines`（research-tools 清单无 global），global 不在统一交易员 persona 的市场枚举里，也没有全球品种专属风控技能——而现货金/原油/外汇恰是杠杆误用与隔夜风险最容易失控的品种类。

## Decision

照 futures 先例（2026-09-12）全套复制，六个市场形态对齐：

1. **新包 `@dshtrading/global`（市场 bundle）**：host 面 `dsh-trading-global-installer`（boot 时经 base/presets 幂等贡献 global-trader 切片）+ host 面数据行 `dsh-trading-global-dataplane-jin10`。**该行从 base patch 迁入 bundle**——首轮归 base 的理由（「没有市场 bundle 会认领它」）随 bundle 成立而消失，铁律 #1 的「市场无关共享行归 base」边界回归原位；base 只保留连接器主行（跨市场快讯工具面仍是市场无关的）。
2. **新包 `@dshtrading/kit-global`（工具箱）**：skill provider = `global-risk-checklist`（新作者：杠杆与保证金、隔夜利息/展期、每日 05:00-06:00 与周末跳空、数据行情波动、美元计价与汇率回吐、金十分钟K能力边界）+ 四个共享技能（indicator-authoring / trading-strategy-paradigms / knowledge-curation / trading-notes-setup，SSOT 实跑 sync-skills 零漂移）。base role-skill 白名单按 `[<market>-risk-checklist, 共享技能…]` 生成，kit-global 测试验证三套白名单可解析（futures 审查修正 #1 的 fail-fast 教训前置验证）。
3. **preset 面与 host 面入口分离**（futures 审查修正 #2 同款）：`connector-jin10` 新增 `./global-plugin` preset 入口（隔离组内 `ctx.reflect.provide(tradingGlobalMarketData)`），host 面保留 dataplane 行做注册表注册；两面同挂 dataplane 会触发 `(global, jin10)` 重复注册响亮失败。global-trader preset 的 connector 组 `isolate: tradingGlobalMarketData: true`。
4. **base 三清单扩 global**（futures 先例：数据面市场接受「可选方法未实现」的显式报错语义）：`market-tools.MARKETS`（盘口/逐笔走注册表，jin10 未实现 getOrderbook → `TRADING_NOT_IMPLEMENTED`；账户族报「无交易连接器」属实）、`ORDER_GATE_PATTERN`（预防性收口，global 无下单工具）、`research-tools` markets（专家角色获得 `global_get_ticker/_get_klines`，经注册表惰性解析）。`presets.MARKETS` 扩展后 `@dshtrading/global` 自动进 preset 装配过滤（`installFromLoader` 按包名匹配）；trader persona 市场枚举文案补全球品种（注明 data only）。
5. **部署面**：`desktop/scripts/build-runtime.mjs` 两清单（DIRECT_TRADING_PACKAGES / PROFILE_BUNDLES）纳入 `@dshtrading/global`；`scripts/sync-skills.mjs` 路由加 `global-*` 与第六 kit；typecheck 棘轮基线纳入两新包（0 错）。

## Alternatives considered

- **dataplane 行留在 base、bundle 只挂 installer**：落选——同一行两个所有者违反铁律 #1 单一归属；且「不装 bundle 也能用全球行情」的兼容假象会让 profile 依赖闭包漂移（GUI 全球页签依赖该行，装不装 bundle 行为却不同，是隐式状态）。装 `@dshtrading/global` 成为全球行情的唯一正道。
- **preset 组直接复用 dataplane 入口**：落选——futures 审查修正 #2 已实证注册表重复注册响亮失败。
- **为 global 单独写一份 persona 文案**：落选——统一 trader persona 管全部已装市场（base/presets 组装语义），global-trader 独立 preset 只在单市场 profile 有意义，与 futures 切片同款定位。
- **kit 技能文件手写进 assets**：落选——SSOT 纪律（.agents/skills 单一事实来源），sync-skills 实跑同步。

## Consequences

- 工具面净增：专家角色 +`global_get_ticker/_get_klines`；trader/master 会话 +`global_get_orderbook/_get_trades`（jin10 未实现可选方法 → 显式 NOT_IMPLEMENTED，不冒充空数据）与账户族（报「无交易连接器」）。global_* 连接器自有工具不退役（双命名族并存，futures 无此包袱但 jin10 首轮工具面已分发）。
- **已装 profile 需刷新且必须加装新 bundle**：`dsh plugin add @dshtrading/global --profile trading-web` 后走 `scripts/refresh-trading-web-profile.sh`；不装 bundle 的旧 profile 全球页签会从「能用」变「无 provider」——这是行归属迁移的预期语义，部署时同批完成。
- 桌面 runtime 产物随下次 build-runtime 重生成（生成物不入本变更）。
- 台账边界不变：`HOLDINGS_MARKETS` 仍为四市场（global 现货品种无券商持仓语义，进台账属另一决策）。

## Verification

- `pnpm build` 全绿；`pnpm -r test` 全绿（kit-global 新增 6 例；base presets/market-tools/research-tools 既有测试全过，组合子集测试的 MARKETS 迭代兼容第六市场）。
- `node scripts/typecheck-gate.mjs` 棘轮通过（基线纳入 packages/global 与 packages/kit-global 各 0 错）。
- `node scripts/sync-skills.mjs` 实跑：29 资产同步，既有 kit 零漂移，global-risk-checklist 进 kit-global。
- `pnpm i18n:check` 通过（本变更零 UI 文案改动）。
- composePresets 端到端：global contribution 与五市场并存时四角色文件生成、kit 白名单可解析（kit-global 测试 + base presets 测试覆盖）。
