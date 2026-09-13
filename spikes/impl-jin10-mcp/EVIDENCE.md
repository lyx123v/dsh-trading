# 金十数据 MCP spike 证据（`spikes/impl-jin10-mcp/`）

- 抓取时间：2026-09-13 01:32–01:54 UTC（北京时间 09:32–09:54，周日）；出口 = 本机。
- 纪律（与 `spikes/impl-uscnhk-news/EVIDENCE.md` 同口径）：原始响应作仓内证据（铁律 #5）；**连接器实现只下发元数据**（标题/时间/链接 + 文章导语），正文不取、不缓存、不落盘。
- 脚本：
  - `recon.mjs` —— 裸 MCP 探路：`initialize` → `notifications/initialized` → `tools/list` / `resources/list` / `resources/read quote://codes` → 8 个工具各一次（含 `list_flash` 翻页、`get_news` 详情）。原始响应落 `EVIDENCE/`（`00-recon-log.json` 为逐步结论摘要）。
  - `verify.mjs` —— **构建产物** `packages/connector-jin10/lib/index.js` 的出网验证（13 步，含两条错误语义），结果落 `EVIDENCE/verify-<ts>.json`。

## 协议与端点（实测）

| 项 | 实测值 |
|---|---|
| 端点 | `POST https://mcp.jin10.com/mcp` |
| 鉴权 | `Authorization: Bearer <token>`（缺失/无效 → HTTP 401） |
| 响应形态 | `HTTP/2 200` + `content-type: text/event-stream`，`event: message` + 单行 `data: {jsonrpc…}` |
| 协商 | `initialize`（`protocolVersion: 2025-11-25`）→ `serverInfo.name = jin10-mcp`、`version 1.0.0`；`capabilities = { logging, resources, tools }` |
| 会话头 | **无 `mcp-session-id`**（服务端无状态；连接器仍支持有则该头回带） |
| `notifications/initialized` | `HTTP 202`、空 body（解析层必须容忍空响应） |
| 资源 | `resources/list` → 1 项 `quote://codes`（`application/json`）；`resourceTemplates`/`prompts` 均为空数组 |
| 工具数 | 8（`get_quote` / `get_kline` / `list_flash` / `search_flash` / `list_news` / `search_news` / `get_news` / `list_calendar`），每个都有 `outputSchema` 与 `structuredContent` |

## 数据形状（实测，与用户给定契约一致）

- 信封：`{ status: 200, message: '', data }`；`status` 非 200 时 `data` 常为 `null` 且 `message` 为中文业务说明。
- `list_flash` → `data = { items: [{ content: '【标题】正文…', time: '2026-09-13T09:13:49+08:00', url }], next_cursor: '1789244909607', has_more: true }`；**快讯条目无 id、无 title 字段**（标题从 `content` 的 `【】` 段提取）；每页 20 条。
- `search_flash` → `data = { items }`，**无 `next_cursor`/`has_more`**（上游文档：最多 150 条、不支持翻页；实测 keyword=黄金 返回 150 条）。
- `list_news` / `search_news` → `data = { items: [{ id, title, introduction, time, url }], next_cursor, has_more }`。
- `get_news` → `data = { id, title, introduction, time, url, content }`（`content` 为正文，**连接器不下发**）。
- `list_calendar` → `data` 为**数组**（本周 231 条），条目 `{ pub_time: 'YYYY-MM-DD HH:MM'(无时区，东八区), star: 2, title, previous/consensus/actual/revised: string|null, affect_txt }`。
- `get_quote` → `{ code, name, time, open, close, high, low, volume, ups_price, ups_percent }`（价格字段是**字符串**）。
- `get_kline` → `{ code, name, klines: [{ time(秒), open, high, low, close, volume }] }`（OHLC 字符串）。
- `quote://codes` → 97 个品种 `{ code, name }`（现货贵金属/能源/外汇/工行账户品种/全球与 A 股指数；**无加密货币**）。

## 错误与限制（实测）

- 未知品种：`get_quote(code='NOT_A_CODE')` → `structuredContent = { status: 400, message: '不支持该品种 "NOT_A_CODE"，请通过 quote://codes 资源查询支持的品种列表', data: null }`（连接器映射 `TRADING_UNSUPPORTED_SYMBOL`）。
- 限流文案（用户给定，未触达）：`今日该工具调用次数已达上限，请明日再试` → `TRADING_RATE_LIMITED`；额度 = 每用户每工具每北京时间自然日 1500 次。
- `get_kline`：**周末/闭市恒空**。2026-09-13（周日）实测 `XAUUSD` 在 `time = now-2h / -20h / -3d` 三档全部返回 `status 200` + `klines: []`（黄金/外汇/指数/期货周末均闭市，非故障）。非空 K 线待交易日复测；连接器工具已写明「空 = 窗口内无数据（闭市）≠ 故障」。
- 未声明参数不要传（如分页用 `cursor`，不要 `offset`）；上游工具 `inputSchema` 均为 `additionalProperties: false`。
