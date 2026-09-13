# Agent Note: cn 市场新增东财个股新闻检索源（按标的新闻覆盖）

Status: implemented

## Problem

用户报告 cn 新闻不完整、很多标的的新闻直接没有（2026-09-13）。诊断：`cn_get_news` 的新闻主源是东财
**全市场快讯** `getFastNewsList?fastColumn=102`（无 symbol 参数），取回后用 `matchesSymbol` 按标题/
`stockList` 过滤、24h 窗。全市场流里很少提及某个具体个股，symbol 查询近乎恒空；公告源本身是按标的
下钻的（东财公告 + 巨潮 + 基金公告），所以缺口只在新闻。这与 [移除宏观回退](./../bug-fix/2026-09-03-news-fallback-crowd-out-announcements.md)
的「无相关新闻就如实空」口径一致——本次是补数据源，不是恢复兜底。

金十与同花顺都补不了：金十快讯是市场综合线（条目无 symbol 字段，按代码搜恒 0），同花顺 fuyao 全量接口
清单无个股新闻/公告端点（[同花顺 K 线与新闻源](./2026-09-12-hithink-kline-and-news-sources.md)）。东财自家
的站内新闻检索端点能按代码召回标的新闻，且与现有 cn 源同 publisher、免 key。原始证据见
[`spikes/impl-cn-symbol-news/EVIDENCE.md`](../../../../spikes/impl-cn-symbol-news/EVIDENCE.md)。

## Decision

1. kit-cn `NewsSource` 新增 `eastmoney-symbol-news`：`GET search-api-web.eastmoney.com/search/jsonp`
   （JSONP，`keyword` = 6 位代码、`type=cmsArticleWebOld`、`sort=default` 相关度排序，须带
   `Referer: https://so.eastmoney.com/`）。标题剥 `<em>` 高亮标签；`source` + `relatedCodes=[code]`；
   正文 `content` 不下发（铁律 #5）。非 2xx / 坏 JSONP 抛错进 `unavailable`（fail-soft，带来源前缀）。
2. 门控：仅 6 位数字代码；上证指数 `000xxx.SH` 与深证指数 `399xxx.SZ` 排除（实测 `000001.SH` 全文
   命中全是无关 `.SH` 代码）。symbol 查询时该源**不再叠加** `matchesSymbol`——个股新闻标题常不含代码
   （如「i茅台再调整规则」），上游相关度负责相关性。
3. 时间窗：个股新闻回看 7 天（`SYMBOL_NEWS_WINDOW_MS`），**源自带窗、不随 `windowHours` 缩短**
   （与公告 90 天同款）。新增标题归一化**完全相等**且相差 ≤24h 的跨源去重（处理与全市场快讯命中同篇）。
4. 源配置化（issue #96）：GUI 新闻面板显示名同步（`NewsFeedPane` 的 `SOURCE_LABEL_KEY` + trading
   词典 zh/en + `contract.ts` 键联合）；默认源全集自动包含，用户无 per-market override 时刷新即生效。
   设置页的 cn 候选清单（`NEWS_SOURCE_CATALOG` + settings 词典）因该文件当时有其他会话未提交改动，未一并
   提交，留作后续小改（默认生效，不阻塞功能）。

## Evidence（真实网络，2026-09-13）

- 构建产物 live 实测 8 标的：旧行为 `sources=['eastmoney']`（全市场快讯 + 过滤）**全部 0 条**；新默认
  19–20 条（个股新闻 2–16 条 + 公告）。600519 从 0 → 19（含「贵州茅台(600519.SH)：中报净利润」类）。
- 精度取舍（实测）：`searchScope=default` 是全站全文检索，会带入仅在正文提及代码的行业/榜单类文章
  （如「深沪北百元股数量达200只」）；`searchScope=title` 精确但召回极低（600519 仅 2 条）。选择 recall
  优先，噪声由 `limit` 截尾与使用者判断吸收。
- **GUI 桥集成坑（重启实测暴露）**：`bridge.news()` 固定传 `windowHours: 24`，若个股新闻沿用该窗则
  GUI 实际恒空（只显示公告）。故改为源自带 7 天窗（不随 windowHours 缩短），与公告源同款；修复后
  bridge 实测返回个股新闻与公告。

## Alternatives considered

- 金十接入 `cn_get_news` 的 symbol 路径：放弃——快讯无 symbol 字段、按代码搜 0 条，只能按中文名关键词
  猜标的，属伪造关联；金十保持跨市场快讯独立线。
- 同花顺（fuyao）做个股新闻：放弃——全量接口清单无个股新闻/公告端点，唯一基金资讯端点实测空。
- `searchScope=title`：放弃——精确但召回个位数，回到「很多标的没有」的原问题。
- 恢复大盘要闻兜底：放弃——owner 2026-09-03 已裁决标的无相关内容就如实显示空态。

## Consequences

- 个股新闻页签由恒空变为有数据（8 标的 live 实证）；公告行为不变。
- 新增 1 个可配置源 id；`sources` 显式排除该源时零请求。
- 新增标题去重函数 `dedupeNewsByTitle`（保守：完全相等 + ±24h），公告源仍走原有前缀/后缀判重。
- 验证：`@dshtrading/kit-cn` 49 用例全绿（新增 6 例：JSONP 解析/7 天窗/显式窗/同名去重/
  fail-soft/源配置与指数门控）；`client-ui-trading` 46 文件 / 389 用例全绿 + 构建；live e2e 走构建产物。
- 已知边界：全站检索的精度噪声（行业/榜单类文章）；指数资讯不走本源（如需另评估）；运行中的 trading
  实例需刷新 profile / 新建会话才加载新构建。
