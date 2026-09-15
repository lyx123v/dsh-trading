# Agent Note: SessionRail 宏观/利率页签（金十经济数据 + 央行利率）

Status: implemented

## Problem

右缘竖条已有定时任务/资产/快讯/文件四个功能页签，但交易会话还缺一块只读宏观面：
美/日/中的当周经济数据（CPI、社融、美债拍卖…）与央行政策利率读数。用户要的是
「与快讯同源的入口」：仍用金十数据，共用会话列容器，放在快讯与文件之间，且默认
只看美、日、中。此前这类数据只有 agent 工具面（`econ_calendar`），GUI 无处可看；
央行利率则连工具面都没有。

## Decision

- **入口与容器**：SessionRail 新增 4 号功能页签（地球图标，快讯与文件之间），
  MacroPanel 与定时任务/资产/快讯/文件同款模式——fixed 原位覆盖对话列
  （shell-pad.css 规则 15，`body[data-dshtrading-macro-open]`），五页签互斥。
  文件页签顺位改称 5 号（注释级修正，无行为变化）。
- **数据面（两条腿，见 spikes/impl-jin10-macro-rates/EVIDENCE.md）**：
  - 经济数据 = 官方 MCP `list_calendar` 当周（周一~周日，北京时间）。上游无
    country 参数，地区在连接器解析层按**标题前缀**推断（`regions.ts` 封闭词汇表 =
    字典 33 个 country 取值的母集，匹配顺序一律**按长度降序推导**——手写顺序不算数；
    未识别 = 空串，仅「全部」视图可见）。
  - 央行利率 = 金十日历网页版 `GET e0430d…z3c.jin10.com/web/interest_rates`
    （x-app-id `sKKYe29sFuJaeOCJ`，实测 30 家央行全量），地区按 flagImgUrl 文件名
    推断，再经同一张同义表归一（`印尼` → `印度尼西亚`），两条路径产出同一标签。与热度快讯同款「网页版公开接口逆向、仅 GUI 读数」边界；旧数据中心
    cdn/datacenter-api 均已 404/502，周/月静态文件 cdn-rili 在本机网络不可达，
    `/calendarGetSiteChartByDateRange` 502——全部复核留痕。
- **契约与链路**：`@dshtrading/api` 新增 `MacroFeedService`（`listCalendar/
  listRates`）与 Context 键 `tradingMacroFeed`；connector-jin10 `macro-service.ts`
  provide（与 flash-service 同款普通对象形态，桥与工具面共用同一 Jin10Service）；
  桥新增 `GET /dshtrading/api/macro/calendar`（limit ≤ 250）与 `/macro/rates`，
  服务缺席报 `TRADING_NOT_IMPLEMENTED`，绝不伪装成空列表。
- **面板交互**：页签切换（经济数据/央行利率）+ 地区段选（美日中=默认/全部）；
  日历行 = 时间/星级/标题/地区 + 前值/预期/公布（未公布 `--`）/影响词色签/修正；
  利率行 = 央行名 + 大号利率 + 地区/指标名/公布日。**轮询 5 分钟**而非快讯的
  60s：MCP 上游限流 1500 次/天/工具，60s 会吃穿配额，且日历是日级发布流。

## 评审后续修复（2026-09-15）

同日 review-spd（三个提交）对本面板提出四条，已同变更修掉：

- **单源失败被画成空数据**：原实现只在**两个源都失败**时进 error 态；只挂一个源（日历走
  MCP、利率走网页版逆向接口，独立失败很现实）时该页签既不显示错误、也不显示空态，只剩空
  列表——与本文「绝不伪装成空列表」相反。改为 `calendarState`/`ratesState` 两套独立状态，
  错误提示落在各自页签内。
- **地区前缀顺序**：`JIN10_REGIONS` 手写顺序里「中国」在「中国香港/中国台湾」之前，标题
  前缀匹配把港澳台归入「中国」并进入默认美日中视图（字典里 中国香港 18 个、中国台湾 17 个
  指标）。匹配顺序改为按长度降序推导，书写顺序不再参与语义。
- **词表缺口与两路口径**：字典 33 个 country 里的 意大利/西班牙/印尼 不在词表内（`印度尼西亚`
  反而在上游命名里不出现），意大利/西班牙条目地区恒空；利率侧 `regionOfFlagUrl` 直接回
  flag 文件名（`印尼`）。补入三个取值并加同义归一（`印尼` → `印度尼西亚`）。
- **星号夹取**：`'★'.repeat(Math.min(star, 5))` 在上游给负值时抛 RangeError 炸掉整块面板；
  先夹到 `[0,5]`。
- **i18n 门禁**（跑门禁时发现，非评审提出）：`MacroPanel.tsx` 的地区数组与影响词匹配字面量
  是 CJK 代码字面量，`node scripts/i18n-audit.mjs --check` 报 3 条 ERROR——该文件自本记录
  提交（92ce268）起即红（提交时只记了测试与截图验证，未跑 i18n 门禁）。按既有机制补行级
  `i18n-allow:` 说明后门禁转绿。

回归：新增 `test/macro-panel.smoke.test.tsx`（双源独立失败/空态/地区筛选/负星号），
`packages/connector-jin10/test/web-rates.test.ts` 补地区顺序、别名与词表断言。

## Alternatives considered

- **经济数据也走网页版**（cdn-rili 周/月 economics.json 或首页 WebSocket 日历）：
  cdn-rili SSL 握手被断、WebSocket 属私有协议不复刻；MCP 是契约内主入口，放弃。
- **地区过滤放桥/服务端**：MCP 与利率接口都不支持服务端 country 过滤（利率 30 家
  一次全回）；桥只做 limit 校验，过滤留在客户端（payload ~30KB 级），放弃服务端方案。
- **面板内再加国家多选 chips**（快讯热度同款）：用户裁决是「默认只看美日中」二元
  视图，两态段选零歧义；chips 属 YAGNI，放弃。
- **利率数值化（number 类型）**：上游原样字符串（"3.75"/"0"），数值化要在展示层
  造格式，违背「快照原样透传」口径，放弃。

## Consequences

- 日历条目多了 `region` 字段（parse 层 always-set，空串语义 = 未识别）；econ_calendar
  工具输出不变（region 不进 agent 文本行）。
- 宏观面板挂载期间每 5 分钟打一次 list_calendar + interest_rates；interest_rates 是
  网页版接口、无文档配额，list_calendar 占 MCP 配额约 288 次/天（单客户端）。
- 桌面壳/其他 profile 要吃到本功能，需按 profile 刷新契约重挂 @dshtrading 副本并
  重启实例（本轮只刷新并验证了 trading-web）。
- 金十网页版接口属逆向面：`x-app-id`/端点漂移时利率页签报数据源不可用（错误横幅），
  日历不受影响（MCP 契约内）。该横幅自「评审后续修复」的 M3 起才真正成立——此前只有
  两源同时失败才进 error 态。
