# Agent Note: 同花顺情绪工具（涨停池/集合竞价）读不到设置中心凭证

Status: implemented

## Problem

桌面壳「设置 → 交易」已把同花顺 Key 写入 `dshtrading.credentials.hithink.apiKey`（settings.yaml），
连接器侧的行情链路（`connector-hithink` dataplane/服务）也经 `tradingMarketRouter.getCredential('hithink')`
惰性取到 Key 并可用；但 `cn_get_limit_up_pool` 与 `cn_get_auction_strength` 恒报
`HITHINK_FINANCE_API_KEY is not configured`。

根因（代码级）：这两个工具实现在 `packages/kit-cn`，`apply` 期实例化时只透传 `fetchImpl`，
凭证链路的惰性 provider 从未接上；`fetchCnLimitUpPool` / `fetchCnAuctionStrength` 仅回退读
`process.env.HITHINK_FINANCE_API_KEY`。GUI 进程不继承 shell 环境变量，env 里天然没有该 Key，
于是设置中心的配置对这两个工具完全不可见。这与
[期货市场分组（2026-09-12 数据面凭证惰性化）](../feature/2026-09-12-futures-market-group.md)
是同一根因的另一个未修复消费点：当时只修了 cn/futures 两个 dataplane，kit-cn 的工具面未纳入。

## Decision

1. `packages/kit-cn/src/sentiment.ts`：`SentimentOptions` 增加可选的惰性 `apiKeyProvider?: () => string | undefined`，
   并抽出 `resolveApiKey()` 统一解析顺序 **显式 apiKey → apiKeyProvider（设置中心）→ 环境变量**；
   `fetchCnLimitUpPool` / `fetchCnLimitUpLadder` / `fetchCnAuctionStrength` 三处共用。
2. `packages/kit-cn/src/index.ts`：`apply` 内新增 `readHithinkApiKey` 惰性 thunk，
   经 `ctx.get('tradingMarketRouter', false)?.getCredential('hithink')?.apiKey || process.env.HITHINK_FINANCE_API_KEY`
   解析，并注入 `createGetLimitUpPoolTool` / `createGetAuctionStrengthTool`。
   与 `connector-hithink`、`connector-jin10` 同款：**每次 execute 解析**，settings 用户层加载/修改晚于插件
   `apply` 也生效。
3. 工具描述与无数据提示同步改为「在『设置 → 交易』配置同花顺 API Key，或设环境变量」，避免继续把用户
   引到不存在的 env 前提。

## 验证

- `pnpm --filter @dshtrading/kit-cn build` 通过（tsdown + d.ts）；`pnpm --filter @dshtrading/kit-cn test`
  4 文件 52 用例全绿（sentiment 由 4 → 7 用例）。
- 新增用例：`apiKeyProvider` 在无 env 时提供凭证并真实取数；`cn_get_limit_up_pool` **每次 execute 惰性解析**
  （首次无 Key 报错且不发起 fetch，注入 Key 后同一工具实例成功）；`cn_get_auction_strength` 经 provider
  取到凭证后确实发起请求（无 Key 时根本不会 fetch，以此判别）。
- 部署到桌面实例实际加载的 profile 副本（`~/.dsh-trading/profiles/trading-web/node_modules/@dshtrading/kit-cn/lib`）
  后，对该**产物**做冒烟：`fetchCnLimitUpPool` 用 provider 正常解析、无 Key 仍抛错；
  `createGetLimitUpPoolTool` 输出「A 股涨停池共 1 只股票」。源码 `lib` 与 profile `lib` `diff -r` 一致。
- 未在真机重启桌面实例前验证 GUI 内实际工具调用；该步需用户 ⌘Q 重开（见 Consequences）。

## Alternatives considered

- **往 `launchctl setenv` / 宿主 env 注入 `HITHINK_FINANCE_API_KEY`**：只对之后新启动的进程生效、
  logout/电脑重启即失效，且与设置中心 credentials 形成双写真相；治标不治本——放弃。
- **在 kit-cn `apply` 期读一次凭证快照**：settings 用户层加载晚于插件 `apply`（2026-09-12 已实证的根因），
  快照会落空且改 Key 不热生效——放弃。
- **把 apiKey 作为工具必填参数由模型传入**：凭证进对话/工具参数，既泄露又和设置中心的职责冲突——放弃。
- **改由 `connector-hithink` 提供这两个工具**：工具是 cn 市场专属 sentiment 语义、归 kit 面；
  挪动会打乱 host/preset 平面与 kit 边界（README 铁律 #1）——放弃。

## Consequences

- 设置中心配置同花顺 Key 后，涨停池/连板天梯/集合竞价工具即时可用，无需依赖 env；env 仍兼容。
- 桌面壳生效路径：源码重建后刷新 profile 的 kit-cn 副本并**重启实例**（本次已把 `lib` 同步进
  `~/.dsh-trading/profiles/trading-web/node_modules/@dshtrading/kit-cn/lib`，用户 ⌘Q 重开即加载新代码）。
- 遗留同类点：`packages/kit-cn/src/fundamentals.ts` 的 Tier-1 同花顺估值仍只读 `process.env`，
  GUI 下会静默降级到 Tencent Tier-2；本变更未触碰以保持 `cn_get_fundamentals` 现有行为，如需一并接入
  走同一 `apiKeyProvider`。
- 未加 changeset（发布/版本 bump 需显式请求）；`packages/kit-cn/CHANGELOG.md` 由 changesets 生成，不手改。
