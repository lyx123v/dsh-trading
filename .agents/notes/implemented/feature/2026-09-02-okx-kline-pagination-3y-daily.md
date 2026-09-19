# Agent Note: K 线深度与上限对齐 — OKX after 游标分页、日K近三年、桥帽 1000

Status: implemented

## Problem

rebase 同步（见同日 process note）把客户端 KLINE_LIMIT 统一提到 500 后，
crypto（OKX）图表报 `TRADING_EXCHANGE_ERROR: OKX klines: limit must be an
integer within 1..300, got 500`——桥层设计是「透传，连接器自行校验各自
支持集」，客户端的全局常数撞上 OKX 单请求硬上限。同时 owner 提出日K深度
需求：尽量取多一点，最好近三年（~750 个交易日），而日K参考当时只拉 260
根（一年），Yahoo 日线窗口固定 1y，OKX 单请求 300 根也覆盖不到三年。

## Decision

1. **OKX 连接器游标分页**（connector-okx rest.getKlines）：单请求仍 ≤300，
   limit 更大时按 `after` 游标向前翻页——每页 min(剩余, 300) 根，游标 =
   已收最旧一根的 openTime（OKX 返回严格早于该 ts 的记录），取满 / 上游
   返回不足一页（窗口耗尽）/ 空页即停；跨页按 openTime 去重兜底，合并后
   翻转为旧→新。总量上限 1..1000（与 Binance/Bybit 单请求上限、桥层协议
   帽一致）；candles 端点可回看深度随 bar 档位（日线约 1440 根），三年日K
   在窗口内。原来「>300 拒绝」的带测试决定由分页取代（该决定成文时仓内
   尚无会请求 >300 的一方消费）。
2. **桥层协议帽** MAX_KLINE_LIMIT 500 → 1000：协议面只做 sanity 封顶，
   逐连接器的真实约束仍由连接器自行校验（架构既定）。
3. **客户端限深策略**（2026-09-19 起唯一的家搬到
   `client-ui-trading/src/client/kline-history.ts`，原 QuoteStage 内联常数退役）：
   - `KLINE_PAGE_SIZE_BY_MARKET = { crypto: 300 }`：crypto 盘中周期 300（**300 不
     触发连接器内部翻页**、每 30s resync 轮询不放大限频消耗），其余市场回落
     `KLINE_PAGE_SIZE_DEFAULT = 500`（远端 edge-limits 意图保留）。
   - `KLINE_PAGE_SIZE_DAILY = 750`（≈三年交易日）：日线参考与日线图表（1d
     分支）都走这个深度；OKX 超出 300 的部分由连接器分页补足。
   - `klinePageSize(market, interval)` 是页大小的**唯一出口**：更早一页与 30s
     resync（尾部窗口）共用同一函数，杜绝两套数字漂移。
4. **Yahoo 日线窗口** 1d: 1y → 3y（连接器是「全窗口拉取、服务层按 limit
   截尾」模式，窗口不给足则 limit 再大也拿不到三年）。**注：Yahoo 的分页（往更早
   一页）本轮不接线**——其域自 2021-11-01 起对中国大陆整体关闭、取证不可达，日线
   窗口加深仅覆盖「最近三年」这一段，更早历史无法从该源取得。
5. **（2026-09-19 增量）OKX `after` 同时充当跨 provider 分页契约
   `KlineQuery.before` 的外部种子**：`after` 语义 = 「返回**严格早于**所请求 ts 的
   记录」，与 `before` 契约逐字同构，故桥层把 `before` **原样**透传给连接器、连接器
   用它**直接充当翻页循环的游标种子**（`let cursor = parseOkxBefore(query)`，**零单位
   / 零边界换算**，这是 okx 零摩擦落地的依据）。缺席 `before` 时种子 undefined →
   首个请求即「取最新一页」，既有行为逐字不变。能力经 `getKlineHistoryCapability()`
   声明（`supportsEarlier: true` / `maxPageSize: 300`）。跨 provider 契约、桥层能力闸
   与客户端状态机/视窗补偿见
   [./2026-09-19-kline-history-lazy-paging.md](./2026-09-19-kline-history-lazy-paging.md)。

## Consequences

- 其余连接器对 750 日K的兼容性核查：binance/bybit 1000 单请求 ✓、
  tencent 钳制 800 ✓、alpaca safeLimit 1000 ✓、ibkr period=750d ✓、
  eastmoney/akshare/qmt lmt 直传 ✓、ccxt(binance) 1000 ✓、futu 1000 ✓。
- OKX 日K成本：每次日线取数 ≈3 个请求（750/300 向上取整）；日线图表
  resync 30s 一次、日线参考每标的一次，对 candles 端点限频（20 req/2s）
  无压力。
- 测试：OKX「>300 拒绝」用例改写为游标翻页合并 / 窗口耗尽即停 / >1000
  拒绝三例；Yahoo 两处 range=1y 断言改 3y。
- 后续若把盘中 crypto 图表也加深，直接改 `KLINE_PAGE_SIZE_BY_MARKET` 即可，
  连接器分页已就位。
