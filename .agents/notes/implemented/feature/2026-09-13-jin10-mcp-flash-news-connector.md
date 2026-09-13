# Agent Note: 金十数据 MCP 连接器 —— 跨市场快讯/资讯/财经日历工具面

Status: implemented

## Problem

新闻面现状是**按标的**的：`cn/us/hk/crypto_get_news` 与 GUI 新闻面板都按当前标的过滤（2026-09-03 owner 裁决：无相关新闻就返回空，不回退大盘要闻），源也各市场自带（东财快讯/公告、Yahoo、Google News RSS、HKEX、CryptoPanic）。缺的是一类**跨市场快讯**：宏观数据、大宗商品、外汇、地缘事件的实时流，与任何单一标的无关，也不属于任何单一市场。

金十数据（Jin10）以**免费 MCP 服务**提供这类内容（快讯流、财经资讯、本周财经日历，外加现货贵金属/原油/铜、外汇、全球与 A 股指数的报价与分钟 K 线），用户 2026-09-13 给定接入契约并要求「转成本仓的连接器」。上游是标准 MCP（Streamable HTTP + JSON-RPC 2.0，协议 2025-11-25，Bearer Token），与本仓既有 HTTP 连接器形态不同，需要一层协议适配。

## Decision

1. **新包 `@dshtrading/connector-jin10`**（`packages/connector-jin10`）：MCP 客户端（`mcp.ts`：`initialize → notifications/initialized → tools/list / resources/list / resources/read → tools/call`，SSE 单行 `data:` 与直出 JSON 双形态，`mcp-session-id` 有则回带，握手失败不缓存以便补配凭证后重试）+ 解析层（`parse.ts`，坏形状抛错、时间解析失败丢弃该条）+ 取数层（`service.ts`，分页统一 `cursor → next_cursor / has_more`）+ 工具面（`tools.ts`）。
2. **九个市场无关只读工具**：`flash_list` / `flash_search` / `news_list` / `news_search` / `news_get` / `econ_calendar` / `global_instruments` / `global_quote` / `global_klines`。工具名不带 provider 名（与 `symbol_search`、`knowledge_search` 同族），换快讯源不改工具面。纯只读，不命中下单闸门正则（铁律 #3 不涉及）。
3. **归属 base（铁律 #1：base 拥有全部市场无关行）**：行 `dsh-trading-connector-jin10` 插在 `packages/base/cordis.patch.yml` 的 host 平面工具行区（与 `dsh-trading-market-tools` 同款形态），依赖进 `packages/base/package.json`（profile 安装闭包，S3 坑 3）。**不进任何市场 preset**——内容是跨市场的，host 行注册一次全会话/全角色可见。
4. **结果读取按用户契约**：`result.structuredContent` 优先，`result.content[].text` 仅在 structuredContent 缺席时作机器可读兜底；`isError=true` / `status !== 200` / `data === null` 一律抛错（不冒充空数据）；限流文案映射 `TRADING_RATE_LIMITED`（每用户每工具每北京时间自然日 1500 次），未知品种映射 `TRADING_UNSUPPORTED_SYMBOL`。
5. **数据零再分发（铁律 #5）**：快讯只下发标题（从 `【标题】正文` 提取）/时间/链接，资讯下发标题/时间/链接/`id`，`news_get` 额外给上游 `introduction`（导语）；`content` 正文不下发、不落盘、不缓存。与 `cn_get_news`（东财快讯只引 title/showTime/链接）同口径。
6. **凭证 BYOK 且惰性**：`dshtrading.credentials.jin10.token` 优先、`JIN10_MCP_TOKEN` 兜底，每次请求解析（settings 用户层晚于插件 apply 也生效，2026-09-12 hithink 凭证失效根因的同款纪律）；缺凭证报 `TRADING_CREDENTIALS_MISSING` 并给出配置路径。插件不内置密钥。
7. **边界（本轮不做）**：不接 GUI 新闻面板与 `dshtrading.news.sources` 源配置（面板按标过滤，金十快讯无 `relatedCodes`，塞进去只能靠关键词猜标的，属伪造关联）；不接市场路由与符号词汇（金十代码自成一系，与 `docs/symbol-vocabulary.md` 五市场词汇无交集）；设置面板暂无金十 Token 卡片。

## Alternatives considered

- **作为 cn 市场的 kit 内新闻源**（照东财/同花顺先例，让 `cn_get_news` 与新闻面板带上金十）：落选——内容跨市场（美联储/原油/霍尔木兹），塞进 cn 后 us/hk/futures 会话拿不到；且面板是 per-symbol 语义，金十条目无关联代码，只能靠中文名关键词猜测标的，违反 2026-09-03「只显示标的相关条目」的裁决精神。
- **逐市场 preset 行**（5 个市场 × 各角色各挂一份）：落选——同一份跨市场内容重复 5 份、角色 × 市场组合爆炸；host 平面单行即可全会话可见（`base/market-tools` 先例）。
- **用 connector-template 生成器建包**：落选——模板面向交易所行情/交易面（`MarketDataService`/`TradeService`/签名/三态闸门/dataplane 注册表），本连接器是 MCP 数据源、无交易面，套模板会留下大量无关骨架且误导后续复制者。
- **引入 `@modelcontextprotocol/sdk`**：落选——只需 5 个 JSON-RPC 方法与 SSE 解析，自实现约 200 行、零新依赖；给 profile 安装闭包再加一层依赖不符合 YAGNI，且 SDK 的会话/重连语义本出口用不上（上游无会话头）。
- **本轮把 `get_quote`/`get_kline` 接进市场路由**（futures 或新 global 市场）：落选——需要先定符号映射、GUI 承载面与 provider 归属（现货黄金/WTI/外汇不属于现有五市场），属独立决策；本轮以只读工具形态交付（`global_instruments` 提供代码名册），路由接入留待下一步。

## Consequences

- 工具清单 +9（全角色、全市场会话可见）。这是 context 成本，换来跨市场快讯/资讯/日历/全球品种行情能力；工具描述里写明元数据边界、翻页与限流语义，避免模型拿 `news_get` 去要正文。
- 出网限制：`global_klines` 在闭市（周末）返回空数组（上游 `status: 200` + `klines: []`），属真实语义而非故障；2026-09-13（周日）实测全品种为空，非空 K 线待交易日复测。工具描述已写明「空 = 窗口内无数据（闭市）≠ 故障」。
- 用户启用路径：设置中心 `credentials.jin10.token`（settings.yaml 可直接写）或环境变量 `JIN10_MCP_TOKEN`；**已装 profile 需刷新**（坑 #15 overrides 行 + 重装 base bundle）才能拿到新行与包。
- 后续步骤（未做）：设置面板「快讯数据源」卡片（金十 Token 输入 + 源开关）、GUI 快讯流面板、更多快讯源（财联社等，工具面已 provider 无关）、金十行情面的符号映射与路由接入。

## Verification

- 单测 50 例全绿（`pnpm --filter @dshtrading/connector-jin10 test`）：握手顺序与一次握手、会话头回带、缺凭证不发请求且补配后可重试、401/429/5xx/JSON-RPC error/坏形状映射、structuredContent 优先与文本兜底、限流与未知品种文案识别、解析层（标题提取/东八区时间/分页字段/正文丢弃/坏条目丢弃）、工具渲染与参数透传、插件注册与重名不覆盖、apply→工具 execute 的真实链路（打桩 fetch + 设置中心凭证）。
- 出网验证 `JIN10_TOKEN=... node spikes/impl-jin10-mcp/verify.mjs`：13/13 通过（约 1–3s；闭市时段上游响应偏慢），跑的是构建产物 `lib/index.js`，覆盖 `quote://codes` 资源 → 快讯两页翻页 → 快讯搜索 → 资讯列表/搜索/详情 → 财经日历 → XAUUSD 报价 → 分钟 K 线 → 缺凭证与非法 code 两条错误语义；原始证据 `spikes/impl-jin10-mcp/EVIDENCE/`（含 `recon.mjs` 的 8 工具/资源原始响应）。
- `pnpm -r build` 全绿；`node scripts/typecheck-gate.mjs` 棘轮通过（新 tsconfig 入基线，0 错）；`packages/base/test` 46 例全绿。
- 未做的验证：真实客户端（桌面壳/CLI）挂载后的工具可见性与 UI 无改动；profile 刷新由用户在实例空闲时执行。
