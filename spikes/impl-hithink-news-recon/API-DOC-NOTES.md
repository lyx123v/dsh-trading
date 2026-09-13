# 同花顺金融数据 API 新闻/公告覆盖核查笔记

核查日期：2026-09-12（周六，A 股非交易日）。核查对象：连接器现有上游 `https://fuyao.aicubes.cn`（同花顺金融数据 API，`X-api-key` 认证）。

## 文档证据（全量接口清单过筛）

- 文档入口：`https://fuyao.aicubes.cn/llms.txt`（索引）与 `/llms-full.txt`（全量，387KB / 11551 行， spike 当日已逐条过筛）。原文档不入库（387KB），结论见下，原始响应取证于 `EVIDENCE/`。
- 全量端点域仅五个：`/api/a-share/*`、`/api/a-share-index/*`、`/api/fund/*`、`/api/futures/*`、`/api/options/*`，外加 `/api/meta/tickers/*` 与 `/api/dump/*`。**无港股域、无美股域、无宏观/快讯域。**
- `asset_type` 官方枚举（`/api/meta/tickers/list` 参数表）：`a-share`、`a-share-index`、`fund-otc`、`fund-etf`、`fund-lof`、`fund-reits`、`forex`、`futures`、`options`。**无港股/美股资产类型。**
- 公告端点：**零**。全清单唯一含「公告」字样处是基金分红字段说明（公告日/权益登记日/除息日），非公告接口。
- 新闻端点：**仅一个** `/api/fund/news/article-list`（单只基金资讯，游标分页）。响应字段 `id / content_type / title / summary / source / url / image_url / author / publish_time_ms / top`——字段面满足 NewsItem 契约，但限定单只基金标的。

## 真实网络探测（EVIDENCE/，2026-09-12）

| 端点 | 样本 | 结果 |
|---|---|---|
| `/api/fund/news/article-list` | 510300.SH（ETF）、110022.OF（场外）、000001.OF（华夏成长） | 均 `code=0` 但 `item=[]`、`has_more=false`——端点可用、样本数据为空，回填程度未知 |
| `/api/a-share/special-data/anomaly-analysis-list` / `-stock` | 当日 / 600519.SH、000636.SZ（热榜第一） | 非交易日返回空（`code=0`）；字段 `stock_name/analysis_content/keyword_list/thscode/tag_name`，**无 url/发布时间** |
| `/api/a-share/special-data/hot-stock-list?period=day` | Top30 | 24h 滚动榜单周末有数据；字段 `thscode/name/rank/heat/rank_change/rank_trend`，**无 url/发布时间** |

复跑：`node spikes/impl-hithink-news-recon/verify.mjs`（交易日跑异动端点可能返回当日数据）。

## 覆盖矩阵（结论）

| 市场 | 新闻 | 公告 |
|---|---|---|
| A 股（cn） | 无个股新闻；仅异动原因/热榜/龙虎榜等事件快照（不满足 NewsItem 契约） | 无 |
| 港股（hk） | 平台不覆盖 | 平台不覆盖 |
| 美股（us） | 平台不覆盖 | 平台不覆盖 |
| 基金/ETF | 单基金资讯端点（字段满足契约，实测空数据） | 无 |
| 期货/期权/外汇 | 无 | 无 |

## 同花顺其他通道（未接入，供后续评估）

同花顺 iFinD 数据接口（`quantapi.10jqka.com.cn`，独立商业授权 + iFinD 账号登录，SDK `iFinDPy` / HTTP API）官方功能列表含「公告函数」，免费版公告下载限额 100 篇/周；第三方对比称其行情覆盖 A股/港股/美股。**与现有连接器是两套凭证体系**；其公告/新闻的实测市场覆盖与字段契约在本项目无凭证可用，未验证。如未来要做 HK/US 公告增强，需先开通 iFinD 授权再另行 spike。
