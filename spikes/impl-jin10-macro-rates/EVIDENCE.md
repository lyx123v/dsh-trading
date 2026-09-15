# 金十「央行利率 / 宏观指标」接口 —— 原始证据（2026-09-15）

## 结论

右侧栏「宏观/利率」页签的数据面裁决：

逆向来源：rili.jin10.com 前端 bundle `app.68c151f.js`（2026-09-15 抓取，函数 `getInterestRate`
→ `v.get('/web/interest_rates')`；`v` 客户端常量即下述 base/headers）。

- **央行利率**：金十日历（rili.jin10.com）网页版接口可用，一次返回 30 家央行最新利率。

      GET https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com/web/interest_rates
      headers: x-app-id: sKKYe29sFuJaeOCJ, x-version: 2.0, referer: https://rili.jin10.com/
      响应   : { status: 200, message: 'OK', data: { list: [{ id, bankName, flagImgUrl,
                 interestRate, publishTime, fromIndicatorId?, fromIndicatorName? }], updated_at } }

  条目样例（实测 2026-09-15）：美国联邦储备局 3.75（2025-12-11，美联储利率决定(上限)）、
  日本央行 1（2026-06-16，央行目标利率（上限））、中国人民银行 3（2025-05-20，
  一年期贷款市场报价利率）。地区取 flagImgUrl 文件名（`…/flag/美国.png` → 美国）。
  原始响应见 EVIDENCE/interest-rates.json。

- **宏观指标（当周经济数据）**：官方 MCP `list_calendar`（本仓 `econ_calendar` 工具底座）
  返回当周（周一~周日，北京时间）全量条目，字段 pub_time/star/title/previous/consensus/
  actual/revised/affect_txt；**标题一律以地区名开头**（「日本8月外汇储备(亿美元)」
  「德国7月季调后工业产出月率」），地区过滤只能按标题前缀做（上游无 country 参数）。
  真实返回样本见 ../impl-jin10-mcp/EVIDENCE/tool-list_calendar.json。

## 地区词汇

利率侧 flag 名与日历侧标题前缀共享一套中文地区名（美国/中国/日本/欧元区/英国/德国/…
见 indicator-list-sample.json 的 countries 全集，1091 条指标字典含 33 个地区值）。
地区归属在连接器解析层推断（标题 startsWith / flag 文件名），词汇表固定、未知 → 空。

## 不可用面（复核记录，失败即证据）

| 候选 | 结果 |
| --- | --- |
| cdn.jin10.com/dc/reports/dc_all_latest.js | 404 NoSuchKey（旧数据中心快照已下线） |
| datacenter-api.jin10.com（reports/list 等） | 502（网关全路径拒） |
| cdn-rili.jin10.com/web_data/<年>/week/<周>/economics.json（周/月日历静态文件） | 本机网络 SSL 握手被断（EVIDENCE/week-economics.txt） |
| /calendarGetSiteChartByDateRange（bundle 有引用） | 502，服务端未放行（EVIDENCE/chart-by-range.txt） |
| www.jin10.com 首页财经日历组件 | 走 Flash WebSocket（MSG_GET_RILI_BY_DATE），非 HTTP 面，不复刻 |

## 边界

- interest_rates 与热度快讯（impl-jin10-heat-flash）同属网页版公开接口逆向（非官方 MCP
  契约），仅用于 GUI 利率读数；MCP 仍是日历主入口。
- 只下发利率数值/央行名/公布日/所属指标名（元数据），不涉及正文再分发；不内置密钥
  （该接口无需凭证）。
- 日历 `actual=null` = 未公布；上游口径为快照值，可能后续修正（与 econ_calendar 工具
  描述同口径）。
