# spike：新浪财经 MCP（connector-sina 前置调研）

- 日期：2026-09-16
- 结论：**握手与工具面已实证可用；`tools/call` 全部被上游以「余额不足」（JSON-RPC
  error -32603）拒绝。平台计费为充值按次扣费，用户裁决（2026-09-16）成本模式不合意，
  connector-sina 剔除出接入名单，本 spike 止步于工具面取证**（裁决入
  `spikes/REVIEW-LOG.md`）。
- 凭证纪律：token 只走 `SINA_MCP_TOKEN` 环境变量，全部证据文件经 redact 落盘
  （已 grep 核验无 token 字面量）。

## 已实证事实

1. **端点**：`https://mcp.finance.sina.com.cn/mcp-http`（Streamable HTTP，推荐）
   握手成功；`initialize` 返回 `serverInfo = {"name":"sinafinance-mcpserver-sse","version":"1.0.0"}`，
   **下发 `mcp-session-id` 头，后续请求必须回带**（r1 证据）。
2. **鉴权**：`X-Auth-Token` 头与 `?token=` query 两种形态均实测通过（800 响应均为
   业务层「余额不足」，证明认证已过）。
3. **响应形态**：本出口为 `application/json` 直出（非 SSE data: 行）；实现仍按 jin10
   先例双形态兼容。
4. **协议版本**：请求按 `2025-11-25` 握手成功。
5. **工具面**：`tools/list` 实测 **75 个工具**（README 只列 47），完整 name/description/
   inputSchema 见 `evidence-tools-list.json`。相对 README 新增：`fund_*` 家族（18 个
   公募基金工具）、`swSymbolList`（申万行业分类）、`cnStockMinute`（分时）、
   `newsSearch/qNewsSearch/stockNewsSearch`、`usStockIntraday/us_min_all`、`future_quotes`。

## cn 域工具（22 个）与 symbol 方言

上游 symbol 方言不统一，连接器服务层必须按工具做规范化（接受规范形 `600519.SH`
映射到各工具方言）：

| 方言 | 工具 |
|---|---|
| 带前缀 `sh600519`/`sz000002`/`bj920982` | cnCompanyManagerInfo、cnFinance* 系列、cnStockKLine、cnStockMinute、cnStockLockup*、cnStockRatingHistory、cnStockTradingMarginList、cnStockValuationDetail、cnTradingBlockList、swSymbolList、cnSectorComponentsRanking(node) |
| 裸 6 位 `601127` | cnCompanyCapitalHistory、cnCompanyShareholderHistory |
| 调用链依赖 | cnFinanceReportsFull 必填 `rDate`（先调 cnFinanceReportDateList 取报告期）与 `source`（gjzb 等）；cnStockConnectHoldings 必填 type/sort/asc |
| 无参全市场 | cnMarketLimitUpPool、cnMarketUpdownDistribution、cnStockLianBC、cnVirtualSectorRanking、cnMarketStrongSectors |

## 计划的连接器形态（证据齐后动工）

- 传输层照 connector-jin10 的 mcp.ts（Streamable HTTP + 会话头回带 + structuredContent
  优先）；凭证 BYOK：settings `dshtrading.credentials.sina.token` 优先、`SINA_MCP_TOKEN`
  兜底，逐请求惰性解析。
- 工具面取 **cn 域 22 个**，agent 命名 `cn_<语义词>` snake_case（上游 camelCase 不外露）；
  不接 news/flash 族（与 jin10 撞语义，用户策略 jin10 为宏观/新闻第一优先级）、不接
  global_/us_/hk_ 行情（与 tencent/eastmoney/jin10 重叠）。fund_* 是否纳入二期再议。
- 行归属：cn bundle（packages/cn 依赖 + cn/cordis.patch.yml host 行）——内容 cn 域专属，
  不满足「市场无关归 base」。
- 新闻/列表纪律照 jin10：行情/数据类可回结构化数值；资讯类（若未来接入）只回元数据。

## 阻塞与下一步

- 阻塞：账户 `余额不足`，8 个样例调用全部被拒（两种鉴权同；r2 证据文件为错误体）。
- 用户侧：在 zyhub.finance.sina.cn（我的服务/充值页）确认计费模式并充值或领取免费额度。
- 恢复后：重跑 `SINA_MCP_TOKEN=<token> node r2-sample-calls.mjs` 拿真实 payload →
  按 payload 写 parse.ts 严格解析 → r3 全量核验 → 进 connector-sina 实现（feat 分支）。
