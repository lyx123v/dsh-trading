# Agent Note: 图表左缘惰性历史分页 — before 游标契约、provider 级能力与视窗补偿

Status: implemented

## Problem

中栏 TradingView 图表（见 [../architecture/2026-08-30-middle-stage-tradingview-views.md](../architecture/2026-08-30-middle-stage-tradingview-views.md)）
向右只到最新一根、向左滚到底就撞墙：**再往左拖不出更早的数据**。根因不在前端手势，
而在数据面根本没有「取更早一页」的能力——`MarketDataService.getKlines(symbol, interval,
limit)` 只有「最近 limit 根」一种语义，桥层与连接器都没有按时间游标向更早回溯的入口；
客户端也只按固定根数拉一次。要支持「加载所有历史」必须同时补三处：连接器契约、桥层
协议、客户端时序与视窗。

用户已确认的两条口径：①覆盖所有市场，但按各数据源**原生的分页能力**渐进推进——有
游标的源做真分页，没有的退化为固定根数并**在 UI 明确示明**，绝不静默假装支持；②加载
方式为**左缘惰性分页**（滚到左缘自动拉更早一页），**不得**跳视窗，**不设**「加载全部」
按钮、**不做**一次性全量拉取。

## Decision

### 契约（跨包 face）
- `KlineQuery { before?: number }`（epoch ms，与 `Kline.openTime` 同口径）作为
  `MarketDataService.getKlines` 的**可选第 4 参**追加：取「`openTime` **严格早于**
  `before`」的一页，返回仍为**时间升序**、最多 `limit` 根（`packages/api/src/index.ts`）。
- 契约纪律（防静默假装支持）：**不支持该语义的实现方必须抛 `TRADING_NOT_IMPLEMENTED`**，
  不得忽略参数返回最新页——否则调用方会把重复数据当成更早历史。
- 参数位置已非「零改动」：`connector-ccxt` 的第 4 参早被 `exchange` 占用，本轮把它
  **顺延为第 5 参**（行为逐字不变，仅位置变动；其 `getKlines` 内 `void query`，不实现
  往早语义）。

### provider 级能力声明（双轨）
- 新增可选方法 `getKlineHistoryCapability?(): KlineHistoryCapability`
  （`{ supportsEarlier, maxPageSize?, note? }`，`packages/api/src/index.ts`）。
  **缺席 / 调用抛异常 / 返回值非对象 / `supportsEarlier !== true` 一律按「不支持」
  处置**（桥层 `readKlineHistoryCapability` fail-closed）。
- 双轨分工（避免能力表与上游真实行为漂移）：本声明只用于 UI **提前**示明「该源不
  支持更早历史」，省掉一次注定失败的上游往返；**耗尽（已到最早）由运行时探测裁决**
  ——请求更早一页返回空 / 不足一页即判 `terminated(source)`（见 `classifyPageOutcome`）。
- 能力是 **provider 级、非 market 级**：桥层按 `activeProvider(market)` 取实际供数
  服务的能力，同一市场切了 provider 即刷新（`/klines` 响应恒带 `history`）。

### 桥层（`packages/client-ui-trading/src/bridge.ts`）
- `/klines` 增加可选 `before` 查询参数，处理顺序即安全语义：①沿用 market/symbol/limit
  校验（limit ∈ 1..`MAX_KLINE_LIMIT`=1000）；②`before` 非 null 时必须为正整数否则
  400；③能力解析；④**能力闸**——`before` 存在而能力未声明支持时抛
  `TRADING_KLINE_HISTORY_UNSUPPORTED`（`BridgeError.code`），**且不得调用上游
  `getKlines`**（防静默假装支持）；⑤取数——无 `before` 时第 4 参传 undefined（保持
  既有「取最新一页」逐字不变）。
- 响应**恒带** `history: { supportsEarlier, provider?, maxPageSize? }`，供客户端首次
  取数即知能力。`MAX_KLINE_LIMIT` 维持 1000（其上限来源见
  [./2026-09-02-okx-kline-pagination-3y-daily.md](./2026-09-02-okx-kline-pagination-3y-daily.md)）。

### 已接线 provider（四源真分页；逐个真实网络取证）
| provider | 市场 | 游标映射 | 周期范围 | maxPageSize |
|---|---|---|---|---|
| binance | crypto 默认 | `endTime = before − 1`（epoch ms，闭区间） | 全 interval | 1000 |
| okx | crypto 备选 | `after = before`（**原样**；语义同构、零换算） | 全 bar（8h 无档） | 300 |
| tencent | cn / hk 默认 | `end = before 所在日 − 1 自然日`（`YYYY-MM-DD`，闭区间；`start` 留空） | 仅 日/周/月（fqkline） | 800 |
| eastmoney | cn / hk 备选 | `end = before 所在日 − 1 自然日`（`YYYYMMDD`，闭区间） | 仅 日/周/月（klt≥101） | 未声明 |

- **tencent / eastmoney 的盘中周期带 `before` 一律抛 `TRADING_NOT_IMPLEMENTED`**
  （分钟端点无日期槽 / 日期语义未实证，宁窄勿错；绝不忽略参数返回最新页）；eastmoney
  的 `maxPageSize` **故意缺省**（`lmt` 大值上界未实证，交桥层 `MAX_KLINE_LIMIT` 约束）。
- **yahoo 本轮不接线**：Yahoo 自 2021-11-01 起对中国大陆整体关闭服务，取证返回区域
  通知页而非行情 JSON，故无法证实 `period1`/`period2` 语义；**us 市场维持降级**
  （证据 `spikes/impl-tv-history-paging/NET-VERIFY.md`，契约纪律「宁缺勿错」）。
- 未声明能力的源（如 ccxt）由桥层 fail-closed 判「不支持」，`before` 请求被拒。

### 客户端三层（纯逻辑与接线分离）
- `client/kline-history.ts`（纯领域逻辑，零 React/DOM/依赖）：页大小 / 阈值 / 冷却 /
  上限常量的**唯一家**——`klinePageSize(market, interval)` 是页大小的**唯一出口**、
  `LEFT_EDGE_TRIGGER_BARS=10`、`PAGE_REQUEST_COOLDOWN_MS=1000`、
  `EXHAUSTED_REPROBE_COOLDOWN_MS=60000`、`MAX_LOADED_BARS=12000`；分页状态机
  `reduceKlineHistory`；唯一请求放行判据 `shouldRequestEarlier`（页面可见 → `ready`
  → 非单飞中 → 声明支持 → 有游标 → 冷却已过 → 游标未重复，**全部为真才放行**）；
  页面结果判据 `classifyPageOutcome`；`mergeKlines`（并集 + `openTime` 去重 + 升序，
  重叠以「新响应」为准）。
- 状态机相位 `idle|ready|loading|terminated|unsupported|error`。**粘性**：`terminated`
  / `unsupported` **不因 resync 清除**，仅由 ①`reset`（`dataKey` 变化）②`capability`
  （provider 或 `supportsEarlier` 变化）③用户显式 `reprobe`（≥60s 冷却）解除；
  `reprobe` 仅 `terminated`（受冷却）或 `error` 推进，`idle`/`ready`/`loading`/
  `unsupported` 均为 no-op。
- `client/chart-viewport.ts`（纯数学，零 canvas / 零 lightweight-charts import）：
  `detectHeadChange`（返回 `reset|append|prepend`，**完全按 `time` 判定**、
  `prependCount` = 旧头部锚点在新序列中的下标）、`compensateViewport`（逻辑下标区间
  整体 +`prependCount`，**区间宽度不变**）、`reachesLeftEdge`（可视区最左逻辑下标
  ≤ `triggerBars`）。
- `client/useKlineHistory.ts`（React 接线，只做时序与竞态）：三类请求（初始 / resync /
  更早一页）；**竞态守卫按「数据键世代」**（`generationRef` 单调递增 + `keyRef` 快照）
  ——**仅换 `dataKey` 才使在途响应失效**，同 key 的 resync 与前插**互不作废**（每个
  分页响应最终都会派发 `pageOk` / `pageFailed` 释放单飞闸）；resync 单飞（`inflight`
  时不并发拉尾部窗口）；前插后经 `onPrepend(prependCount)` 在**同一 React 批次**内
  位移 `hoverIndex` / `rangeSelection`（R-3/P3）。ticker 尾部合并 `applyTailTicker`
  收敛到本 hook（原 `QuoteStage.withTickerBar` 同口径）。
- **视窗补偿纪律**：补偿量**只能**取 `detectHeadChange().prependCount`，**禁止**用
  `next.length − prev.length` —— 后者 = 前插 + 尾部新增，而 resync 与前插常在同一
  提交发生，用长度差会每次多平移一根（视窗每翻一页微跳）。补偿在**提交末位的单一
  effect** 应用（`setVisibleLogicalRange`），绝不 `resetTimeScale` /
  `scrollToRealTime` / `fitContent`；程序化设置期间置 `suppressEdge` 自抑制，免再
  触发左缘。

### UI（`client/TvChart.tsx`）
- 左缘判定**复用既有可见区间订阅** `subscribeVisibleLogicalRangeChange`（零新订阅、
  零新生命周期）：回调内 `reachesLeftEdge(...)` 为真即调 `onReachLeftEdge`。
- 左缘状态元素由 `KlineHistoryEdge` 驱动（`loading` / `terminated(source)` /
  `terminated(cap)` / `unsupported` / `error` + 重试按钮）；文案走双语词典键
  `quote.history.{loading,earliest,unsupported,failed,capped,recheck,aria}`
  （`client/locales.ts` 中英各一份）。

### 测试
- 纯模块（状态机 / 视窗数学 / 合并）零 mock 单测；`useKlineHistory` 暴露**仅测试用
  注入缝** `fetchPage?: FetchKlinePage`（缺省真 `fetchKlinesPage`），在零 mock 约束下
  用受控 deferred 复现「resync × 前插」竞态。

## Alternatives considered

- **「加载全部历史」按钮 / 一次性全量拉取**：违背用户口径 ②；且上游限频（OKX
  candles、binance 权重制）与单帧体积不可控，首次进入即拖慢首屏，否决。
- **用请求长度差（`next.length − prev.length`）做视窗补偿**：resync 尾部新增与前插
  常在同一提交发生，长度差 = 前插 + 尾部新增，会每次多平移一根、视窗每翻一页微跳，
  否决（改用 `detectHeadChange().prependCount`）。
- **前端在已拉序列里「凭空」向前补齐（插桩占位 K 线）**：数据源没有更早历史时属编造
  数据，违背「绝不静默假装支持」，否决。
- **桥层不设能力闸、直接透传 `before` 给所有实现方**：未声明的实现方会忽略参数返回
  最新页，客户端把重复数据当历史（静默错误），故改 fail-closed 闸，否决透传。
- **用「key + 游标」单槽 token 做竞态守卫**（首版实现）：同 `dataKey` 下 resync 的
  `load()` 会覆盖「更早一页」的 token，使在途分页响应命中 `token !== request` 被静默
  丢弃——既不派发 `pageOk` 也不派发 `pageFailed`，`inflight` 永久为真、状态机卡
  `loading`（QA 复现点，此后仅换标的 / 换周期才恢复）。改为**按数据键世代**的守卫，
  否决单槽 token。
- **把 yahoo 也一并接线**：Yahoo 自 2021-11-01 起对中国大陆关闭、取证不可达，无证据
  不实现（「宁缺勿错」），us 维持降级，否决臆断接线。

## Consequences

- 图表可向左连续加载更早历史（有游标的四源做真分页，其余源显「该数据源不支持更早
  历史」并在状态栏示明），视窗在前插时保持不跳。
- 退出条件：单飞 + ≤1 req/s 冷却（`PAGE_REQUEST_COOLDOWN_MS`）+ 游标去重；
  `terminated` 受控重试（用户显式、≥60s 冷却）；会话回溯上限 `MAX_LOADED_BARS=12000`
  （到顶进 `terminated(cap)`，**不淘汰**早期页，保持回溯连续性）。更早一页与 30s
  resync（尾部窗口）**共用同一 `klinePageSize` 出口**，杜绝两套数字漂移。
- 内存与指标成本：仅图表（非整个会话）持有序列；`MAX_LOADED_BARS`=12000 根 × 7
  字段的 `Kline[]` 量级约 12~20MB（粗估），可接受、**不设页淘汰**；指标序列由既有
  多 pane 路径按需重算，本轮**不改 `packages/indicators`**，单次全量指标重算 12000
  根 O(n) 量级约 1~3ms（MA/EMA/RSI/KDJ 族）。
- resync 与分页共用同一页大小函数与同一 `mergeKlines`；`prepend` 补偿与 `append`
  增量互不干扰。
- 新增「支持更早历史」的源 = 连接器实现 `getKlineHistoryCapability()`（中栏零改动）；
  新增 provider 能力声明即被桥层 `/klines` 响应自动带出。
- 已知边界：`unsupported` 仅在用户**确实拖到过左缘**时才在 UI 显形（`noticed` 门）；
  能力声明是 provider 级布尔，故 tencent/eastmoney 的「仅日/周/月」限制写在连接器
  运行时拒绝（`TRADING_NOT_IMPLEMENTED`）与本 Note 上，而非声明里。
