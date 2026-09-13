# Agent Note: cn 市场新增东财基金公告源（ETF 公告覆盖）

Status: implemented

## Problem

自选 A 股 ETF（159869.SZ、513050.SH）在桌面壳新闻/公告页签恒为空态。诊断（2026-09-12，运行中宿主 API + headless Chrome UI 实证）确认无任何报错，属结构性覆盖缺口：现有 cn 公告源面向上市公司——巨潮按代码段门控（仅 6/0/3），东财股票公告接口对基金代码实测恒空；7x24 快讯在 24h 窗内几乎不提及 ETF 代码。而基金公告上游存在：东财基金 F10 公告接口对两只 ETF 均有 90 天窗内公告。源配置化机制（issue #96，见 [hithink K 线与新闻源 note](./2026-09-12-hithink-kline-and-news-sources.md)）可直接承载新源。

## Evidence（接口契约实证，2026-09-12 curl 原始探测）

- `GET api.fund.eastmoney.com/f10/JJGG?fundcode=<code>&pageIndex=1&pageSize=<n>&type=0`，须带 `Referer: https://fundf10.eastmoney.com/jjgg_<code>.html`——**缺 Referer 时 HTTP 200 但 Data 恒空**（静默空数据，比 4xx 更难排查）。
- 省略 `type` 恒空；`type=0` = 全类（发行运作/分红送配/定期报告/人事调整）单请求，且按 `FUNDCODE` 单基金归因（抽样 12 条全为请求基金）。
- 条目字段 `FUNDCODE / TITLE / PUBLISHDATEDesc`（YYYY-MM-DD 日精度）`/ ID`；详情页 URL 模式 `fund.eastmoney.com/gonggao/{FUNDCODE},{ID}.html` 实测 200（`gonggao/{ID}.html` 漏代码前缀会 301 到 notfound）。
- **代码空间冲突实证**：`fundcode=002714` 返回鹏华金城混合（场外基金）公告——与股票 002714 牧原股份同码不同物，股票代码进基金接口必查错公司。

## Decision

1. kit-cn `NewsSource` 新增 `eastmoney-fund-announcement`：F10 全类公告接口（type=0 单请求）；`FUNDCODE` 与请求代码不符的条目丢弃（与巨潮源第二道守卫同款，零假数据红线）；`PUBLISHDATEDesc` 日精度按东八区 00:00 解析，解析失败丢弃绝不回退「现在」；详情 URL 按 `gonggao/{code},{ID}.html` 构造。
2. 硬门控 `isCnExchangeTradedFundCode`（15/16/50/51/52/56/58 前缀，与股票 60/00/30/68/43/83/87/92 无交集）：股票代码严禁进基金接口。源保持 symbol 门控 + sources 开关门控；source id 含 announcement，90 天公告放宽窗自动生效。
3. 设置页 cn 候选清单新增「东财基金公告」（NEWS_SOURCE_CATALOG + settings 词典 zh/en 类型联合），NewsFeedPane 源显示名 + trading 词典 zh/en + contract 键联合同步。默认源全集自动包含该源：用户无 per-market override 时刷新即生效。

## Alternatives considered

- 并入 `eastmoney-announcement` 源：放弃——独立开关才能只关基金公告；且该源语义是上市公司公告，混合后源标签失真。
- type=1..4 四类并行请求合并：放弃——type=0 单请求即全类，四请求徒增轮询尾延迟。
- 抓取 jjgg HTML 页：放弃——页面为 `{{value}}` 模板渲染，比 JSON 接口脆弱。

## Consequences

- ETF/场内基金标的公告页签有数据（159869/513050 实测各 20 条），股票行为不变（002714 实测仍 20 条股票公告、零基金污染）。公司级归因条目（如「旗下部分基金提示性公告」）会进入单基金公告流——这是上游对该基金的官方归因，FUNDCODE 守卫保证不越界到其他基金。
- 验证：`pnpm build` 全绿；`pnpm test` 173 文件 / 1438 用例全部通过（新增 4 例：解析与 Referer/FUNDCODE 守卫、坏 JSON 归因、股票代码门控、sources 装配排除）；真实网络端到端走构建产物三标的实证如上。
- 已知边界：F10 接口 pageSize 上游未声明上限，GUI limit=50 未单独实测（20 实测正常；若上游钳制仅表现为少页，不致错误数据）。
