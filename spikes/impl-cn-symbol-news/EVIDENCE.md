# cn 按标的新闻源探针证据（`spikes/impl-cn-symbol-news/`）

- 抓取时间：2026-09-13（北京时间，A 股非交易日）；出口 = 本机；无 key、无凭证。
- 脚本：`probe.mjs` —— 对东财站内新闻检索端点取证，原始响应落 `EVIDENCE/*.raw.txt` / `*.parsed.json`。

## 探针端点

`GET https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=<json>`

`param = { keyword, type:['cmsArticleWebOld'], param:{ cmsArticleWebOld:{ searchScope:'default', sort:'default', pageIndex:1, pageSize:10 } } }`

需带 `Referer: https://so.eastmoney.com/` 与浏览器 UA。返回 JSONP，载荷：
`result.cmsArticleWebOld[] = { date, title, url, mediaName, content(摘要) }`，`hitsTotal` 命中数（上限 10000）。

## 实测（relevance 排序，`sort:default`）

| 关键词 | hitsTotal | 前 3 条相关性 |
|---|---|---|
| `600519`（A 股代码） | 616 | 直接相关（茅台中报、i茅台调价、融资客净买入） |
| `贵州茅台`（中文名） | 4630 | 直接相关（自营店调价、茅台报道） |
| `00700`（港股代码） | 941 | 直接相关（腾讯控股连续回购） |
| `AAPL`（美股代码） | 93 | 弱相关（美股盘后综述，含代码提及） |
| `000001.SH`（指数） | 10000 | 不相关（全文命中其它 `.SH` 代码，非指数本身） |

## 结论

1. 东财新闻主源（`getFastNewsList?fastColumn=102`，全市场快讯 + 客户端 symbol 过滤）是「很多标的
   新闻为空」的根因：全市场流里很少提到某个具体标的，24h 窗内 `symbol` 查询近乎恒空。
2. 同一 publisher 的**按关键词检索**端点能补个股新闻：A 股/港股代码 relevance 排序下前几条即
   标的自身新闻；美股代码弱一些（英文代码在中文财经流里多为综述）。
3. 指数不适用该端点（`000001.SH` 全文命中噪声大），指数新闻仍需另想办法。
4. 本端点与现有 cn 源同源、免 key、字段满足 NewsItem（title/date/url/mediaName），正文 `content`
   按铁律 #5 不下发。

## 与金十/同花顺的关系

- 金十：市场综合线（`list_flash` 仅 cursor、`search_flash` 仅 keyword，条目无 symbol 字段）。
  实测个股按中文名有零星命中（贵州茅台/宁德时代/比亚迪），但混入泛化条目、按全历史 newest-first、
  按代码搜（`600519`）返回 0。适合宏观/大宗/外汇补充，不是个股新闻主源。
- 同花顺（fuyao.aicubes.cn）：见 `spikes/impl-hithink-news-recon/API-DOC-NOTES.md` —— 无 A 股个股
  新闻端点、零公告端点，唯一新闻端点为单只基金资讯且实测空；补不了本缺口。

## 落地后 live 效果（2026-09-13，构建产物 `packages/kit-cn/lib/news.js`，`live-check.mjs`）

8 标的对比「旧 `sources=['eastmoney']`（全市场快讯 + symbol 过滤）」与「新默认（加 `eastmoney-symbol-news`）」：

| 标的 | 旧 | 新 | 其中个股新闻 / 公告 |
|---|---|---|---|
| 600519 | 0 | 19 | 11 / 8 |
| 002594 | 0 | 20 | 13 / 7 |
| 300750 | 0 | 20 | 16 / 4 |
| 600036 | 0 | 20 | 8 / 12 |
| 000858 | 0 | 20 | 2 / 18 |
| 601398 | 0 | 20 | 14 / 6 |
| 002714 | 0 | 20 | 7 / 13 |
| 300059 | 0 | 20 | 11 / 9 |

- 精度取舍：`searchScope=default` 是全站全文检索，会带入仅在正文提及代码的行业/榜单类文章
  （如 600519 出现「深沪北百元股数量达200只」）；`searchScope=title` 精确但召回极低
  （600519 仅 2 条、300750 仅 4 条）。实现选 recall 优先。
- 指数不适用：`000001.SH` 的 default/title 检索前几条均非指数本身，实现对该类代码直接跳过。
