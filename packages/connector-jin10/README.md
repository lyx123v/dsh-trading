# @dshtrading/connector-jin10

金十数据（Jin10）MCP 连接器：把 `https://mcp.jin10.com/mcp` 的**市场快讯、财经资讯、财经日历与全球品种行情**封装成本仓的 agent 工具面。

与交易所连接器的区别：本包**没有行情/交易服务面**（不 provide `trading<Market>MarketData`，不进市场路由），只注册只读工具——金十内容是跨市场的（宏观/大宗/外汇/A 股/地缘），故为**市场无关共享行**，归 `@dshtrading/base` 所有（README 设计铁律 #1）。

## 工具面

| 工具 | 上游 MCP 工具 | 说明 |
| :--- | :--- | :--- |
| `flash_list` | `list_flash` | 最新快讯流，`cursor` 翻页 |
| `flash_search` | `search_flash` | 关键词搜快讯（一次最多 150 条，上游不支持翻页） |
| `news_list` | `list_news` | 最新财经资讯列表，`cursor` 翻页 |
| `news_search` | `search_news` | 关键词搜资讯，`cursor` 翻页 |
| `news_get` | `get_news` | 单篇资讯元数据（标题/时间/链接/导语） |
| `econ_calendar` | `list_calendar` | 本周财经日历（时间/星级/前值/预期/公布/影响） |
| `global_instruments` | `quote://codes` 资源 | 品种代码名册（现货/能源/外汇/指数），可关键词过滤 |
| `global_quote` | `get_quote` | 单品种实时报价 |
| `global_klines` | `get_kline` | 分钟级 K 线（`time` 起点后 24h 窗内，`count` ≤ 100） |

工具名不带 provider 名：换快讯源不改工具面（与 `symbol_search`、`knowledge_search` 同族的跨市场命名）。

## 配置（Config）

```yaml
- id: dsh-trading-connector-jin10
  name: '@dshtrading/connector-jin10'
  config:
    enabled: true                                   # 缺省 true
    endpoint: https://mcp.jin10.com/mcp             # 缺省即此
    tokenRef: JIN10_MCP_TOKEN                       # 环境变量名（BYOK）
    timeoutMs: 15000
```

凭证解析（BYOK，不内置密钥）：设置中心 `dshtrading.credentials.jin10.token` 优先，`process.env[tokenRef]` 兜底；**每次请求惰性解析**，所以 settings 用户层在插件 apply 之后加载/修改同样生效。缺凭证时调用报 `TRADING_CREDENTIALS_MISSING`，消息里带配置路径。

## 上游契约（2026-09-13 实测，证据见 `spikes/impl-jin10-mcp/EVIDENCE/`）

- 传输：Streamable HTTP，JSON-RPC 2.0；响应是 `text/event-stream` 里的单行 `data: {...}`（也吃直出 JSON）。协议版本 `2025-11-25`，`initialize → notifications/initialized → tools/list / resources/list / resources/read → tools/call`。
- 鉴权：`Authorization: Bearer <token>`；上游当前不返回 `mcp-session-id`（有则该头原样回带）。
- 结果读取：`result.structuredContent` 优先；`result.content[].text` 只在 structuredContent 缺席时作机器可读兜底。
- 分页：请求 `cursor`、响应 `data.next_cursor` + `data.has_more`（不传未声明参数，例如不要用 `offset`）。
- 错误：`isError=true`、`status !== 200`、`data === null` 一律抛错（不冒充空数据）；限流文案「今日该工具调用次数已达上限」映射 `TRADING_RATE_LIMITED`，未知品种映射 `TRADING_UNSUPPORTED_SYMBOL`。
- 限流：每用户每工具每北京时间自然日 1500 次。

## 数据边界（铁律 #5 数据零再分发）

- 快讯只下发**标题（从 `【标题】正文` 提取）/时间/链接**，`content` 正文丢弃；
- 资讯下发标题/时间/链接/`id`，详情额外给上游 `introduction`（导语），`content` 正文丢弃；
- 时间解析失败一律丢弃该条，绝不回退「现在」；
- 不缓存、不落盘、不批量抓取。

## 验证

```sh
pnpm --filter @dshtrading/connector-jin10 test     # 50 例：传输/握手/错误映射/解析/工具渲染/插件接线
JIN10_TOKEN=sk-... node spikes/impl-jin10-mcp/verify.mjs   # 出网验证（构建产物 + 真实 MCP）
```

`verify.mjs` 覆盖资源 → 快讯两页翻页 → 快讯搜索 → 资讯列表/搜索/详情 → 财经日历 → 报价 → K 线，以及缺凭证/非法 code 两条错误语义；证据 JSON 落 `spikes/impl-jin10-mcp/EVIDENCE/`。

已知限制：`global_klines` 在闭市（周末）返回空数组（上游 `status: 200` + `klines: []`），属真实语义而非故障，工具描述已写明；2026-09-13（周日）实测全品种为空，非空 K 线待交易日复测。
