# Agent Note: 同花顺期货中金所 8888 加权码无行情，getTicker 不再返回假 0

Status: implemented

## Problem

用户配置同花顺后加入「沪深300 加权 `IF8888.CFE`」，自选列表显示 `0.000000`、昨收/开/高/低/量全为 `—`（2026-09-14 11:48 截图）。直连上游实测根因有两层：

1. **上游目录有码、行情无数据**：`/api/meta/tickers/list|search` 登记了中金所(CFFEX) 8888 加权码（`IF8888.CFE`/IH/IC/IM/T/TF/TL/TS），但 `/api/futures/prices/daily?thscode=IF8888.CFE` 返回 `code=0` 且 `item: []`，`/api/futures/prices/intraday` 返回 `code=5003`（pre/intraday/post 三个 session 一致）。其他交易所的 8888 加权码（`RB8888.SHF`、`AU8888.SHF`）与中金所主连 `IFZL.CFE` 日K/分时都正常，故缺口仅限中金所加权。
2. **连接器把空数据伪造成 0**：`HiThinkFuturesMarketDataService.getTicker` 用 `lastDaily?.close_price ?? 0`，日K为空即为 0；分时 5003 又被 `catch` 静默吞掉，最终返回一个 `price: 0` 的合法 `Ticker`，GUI 如实渲染成 0 而非报错。

## Decision

- `packages/connector-hithink/src/futures.ts` `getTicker`：日K与分时都取不到价格时抛 `TradingServiceError('TRADING_UNSUPPORTED_SYMBOL')`，不再返回 `price=0`。GUI 行情桥因此走 `ok:false` 错误分支显示取数失败。
- 同文件新增 `isUnpricedCffexWeighted(symbol)`（`/^[A-Z]+8888\.CFE$/i`），`listInstruments` 的检索与名册两个分支都剔除这些无行情码，避免用户再次加入。其他交易所 8888 加权码与中金所主连 `…ZL.CFE` 不受影响。
- 手动替代标的：`IFZL.CFE`（沪深300 主连，实测日K 100 根 + 当日分时 121 点，最新 4488）。已存在的自选条目不做自动改写，由用户自行替换。

## Alternatives considered

- **把 8888 加权码自动映射到同名 `…ZL.CFE` 主连**：加权是成交加权指数、主连是可交易合约，两者口径不同；静默替换会让用户以为在看加权序列，语义错误。
- **保留 `price=0`、交由 UI 判断**：假 0 会被当成真实价格进入均线、涨跌幅与后续计算，比显式报错危险得多。
- **剔除所有 8888 加权码**：非中金所加权（`RB8888.SHF` 等）上游有完整数据，全剔会误伤可用标的。

## Consequences

- 自选里的 `IF8888.CFE` 现在显示取数失败而非 `0.000000`；要看到行情需改成 `IFZL.CFE` 或具体月合约（`IF2609.CFE`/`IF2610.CFE`）。
- 检索「加权」时中金所品种不再返回结果；`listInstruments` 返回的中金所连续码只剩主连。
- 已加入自选的不可用码仍可点开图表：`getKlines` 未在本变更内改动，其 `1d` 对空日K仍返回空数组。属已知残留，若需一并收口另立变更。
- 验证：`connector-hithink` vitest 25 用例全绿（新增 4 例：`isUnpricedCffexWeighted` 边界、日K+分时皆空报错、分时 5003 报错、检索/名册过滤）；`tsdown` 构建通过；`tsc --noEmit -p packages/connector-hithink/tsconfig.json` 0 错误（基线 0）。

上游边界与承载决策见 [2026-09-12 期货市场分组](../feature/2026-09-12-futures-market-group.md)。
