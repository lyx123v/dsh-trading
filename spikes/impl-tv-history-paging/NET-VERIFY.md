# TV 历史分页 · 四源嵌套游标能力 · 真实网络原始响应证据

- 任务：为 DSH 交易插件中栏 TradingView 图表「向左滚动加载更多历史 K 线」所需的
  `getKlines(symbol, interval, limit?, before?)` 分页契约（`before` = 取 `openTime`
  **严格早于** `before` 的 K 线），逐个默认 provider 取得真实网络原始响应证据。
- 时间：2026-09-19T07:28:45Z ~ 07:31Z（UTC）
- 命令：`node spikes/impl-tv-history-paging/net-verify.mjs`（Node v22.22.2，全局 fetch，零第三方依赖）
- 方法：每个源做「两页衔接」验证——取最新一页（limit 小值）→ 以第一页最旧一根为游标取第二页
  → 断言「第二页最新一根严格早于第一页最旧一根」（无重叠）且「两页无缝」（无缺口）。
- 原始响应：本目录 `raw/` 下逐请求落盘；机器可读汇总见 `raw/summary.json`。
- **本 spike 未修改任何连接器源码（`packages/connector-*/`），未做任何 `getKlines` 接线。**

> 网络前提（重要）：本取证环境为受控出口，部分主机被拦截。逐源结论已就「本出口可达的部分」
> 给出；不可达者一律记为**证据不足**并说明原因，**未伪造任何响应数据**。

---

## 四源汇总表

| # | provider | 市场 | 结论 | 证据文件 | 游标参数 | 单位/口径 |
|---|---|---|---|---|---|---|
| 1 | **binance** | crypto 默认 | **支持**（经官方公开镜像取证） | `raw/01..03-binance-*.json` | `endTime` | epoch **ms**，**闭区间**（含端） |
| 2 | **yahoo** | us 默认 | **证据不足**（HTTP 403 边缘拦截） | `raw/04-yahoo-page1.json` | `period1`/`period2`（未验证） | epoch **秒** |
| 3 | **tencent** | cn 默认 | **支持** | `raw/05..07-tencent-cn-*.json` | `param` 的 `end` 槽位 | `YYYY-MM-DD`，**闭区间**（含端） |
| 4 | **tencent** | hk 默认 | **支持** | `raw/08..10-tencent-hk-*.json` | `param` 的 `end` 槽位 | `YYYY-MM-DD`，**闭区间**（含端） |
| 5 | **eastmoney** | cn / hk | **支持**（本出口不可达，由**主理人补证**） | `raw/12-eastmoney-teamlead-supplement.md`（本地失败留证 `raw/11-*`） | `end` | `YYYYMMDD`，**闭区间**（含端） |

**能取得证据并支持分页的：binance、tencent（cn+hk）、eastmoney（主理人补证）。**
**未能取得证据：yahoo（地理封锁，非沙箱问题）。**

> 补充（2026-09-19 主理人裁决）：yahoo 的 403 **不是**沙箱出口问题——Yahoo 自 2021-11-01
> 起对中国大陆用户整体关闭服务，返回的是**区域通知页**而非 JSON；故 yahoo 无法取证，本次**不接线**。
> eastmoney 的 `end` 闭区间语义由主理人在本机出口补证（本 spike 沙箱对该端点不可达），
> 转录见 `raw/12-eastmoney-teamlead-supplement.md`。

---

## 1) binance — crypto 默认 provider

| 字段 | 内容 |
|---|---|
| 结论 | **支持** |
| 取证主机 | `https://data-api.binance.vision`（Binance 官方公开行情镜像，同一 `/api/v3` 契约）；**默认主机 `api.binance.com` 本出口不可达**（`UND_ERR_CONNECT_TIMEOUT`，10.7s 超时） |
| 请求 URL（第一页） | `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5` |
| 请求 URL（第二页） | `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5&endTime=1789786799999` |
| 请求 URL（边界验证） | `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5&endTime=1789786800000` |
| 关键原始响应片段 | 第一页 openTime：`[1789786800000,1789790400000,1789794000000,1789797600000,1789801200000]`；第二页 openTime：`[1789768800000,1789772400000,1789776000000,1789779600000,1789783200000]` |
| 衔接判定 | 第一页最旧 `d0 = 1789786800000`（2026-09-19T03:00:00Z） **vs** 第二页最新 `1789783200000`（2026-09-19T02:00:00Z）→ **第二页最新 < 第一页最旧**，差值恰 `3600000ms = 1×1h`（无缺口、无重叠） |
| 边界口径（实测） | `endTime = d0` 时返回末根 openTime **仍为 `d0`** → **`endTime` 为闭区间（含端，`openTime ≤ endTime`）** |
| 实现提示 | 游标参数名 `endTime`，单位 **epoch 毫秒**，闭区间。取「**严格早于** `before`」须做换算：**`endTime = before − 1`（ms）**。`limit` 上限 1000（源码 `:296` 已有校验）；`interval` 用小写，同源码词表。 |

> 备注：`api.binance.com` 在受控出口超时，故改由其官方公开镜像 `data-api.binance.vision`
> 取证——该主机返回与 `/api/v3/klines` 完全一致的行结构（`[openTime,open,high,low,close,volume,closeTime,...]`），
> 契约语义等价。接线时仍写 `api.binance.com`（连接器默认 base），仅需新增 `endTime` 参数即可，
> `data-api.binance.vision` 可作为该源在受限网络下的备用 base。

---

## 2) yahoo — us 默认 provider

| 字段 | 内容 |
|---|---|
| 结论 | **证据不足** |
| 请求 URL | `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&period1=1788938937&period2=1789802937` |
| 原始响应 | **HTTP 403**，响应体为 Yahoo 拦截页（`<!DOCTYPE html><html lang="zh"><head><title>Yahoo</title>…` 页面），非行情 JSON（见 `raw/04-yahoo-page1.json`） |
| 缺什么 | 端点语义**未被观测**：Yahoo 边缘对本出口 IP 返回 403 拦截页（非端点不存在、非参数错误）。因此**无法**证实也无法证伪 `period1`/`period2` 是否可用。 |
| 追加尝试（均失败，如实记录） | `query1` / `query2` 两主机、裸 UA 与完整浏览器 UA、`v7/finance/download`、`finance.yahoo.com/quote/AAPL` 一律 `403`；有/无环境代理各 5/5 次全部 403。 |
| **实测时间 / UA**（便于后人区分「地理封锁」与「代码问题」） | 测得窗口 **2026-09-19T07:28:45Z ~ 07:31Z（UTC，本机出口）**；请求头 `user-agent: Mozilla/5.0`（`net-verify.mjs` L25 常量），另试完整 Chrome UA 亦 `403`。响应 `content-type: text/html`（**非** `application/json`）→ 判定依据：**区域通知页 HTML + HTTP 403**，不是端点不存在、不是参数错误。 |
| 附注 | 现源码 `connector-yahoo/src/rest.ts:218` 实际只发 `interval=` + `range=`，**尚未使用 `period1`/`period2`**；即便该参数可用，也属**新增用法**，必须在真实网络下另行取证后才可接线。 |

---

## 3) tencent — cn / hk 默认 provider

| 字段 | cn | hk |
|---|---|---|
| 结论 | **支持** | **支持** |
| 端点 | `web.ifzq.gtimg.cn/appstock/app/fqkline/get` | `web.ifzq.gtimg.cn/appstock/app/hkfqkline/get` |
| 请求 URL（第一页） | `…/fqkline/get?param=sh600519,day,,,6,qfq` | `…/hkfqkline/get?param=hk00700,day,,,6,qfq` |
| 请求 URL（第二页） | `…/fqkline/get?param=sh600519,day,,2026-09-10,6,qfq` | `…/hkfqkline/get?param=hk00700,day,,2026-09-10,6,qfq` |
| 请求 URL（参考校验） | `…/fqkline/get?param=sh600519,day,,,12,qfq` | `…/hkfqkline/get?param=hk00700,day,,,12,qfq` |
| 关键原始响应片段 | 响应键 `data.<wire>.qfqday`，行 `[date,open,close,high,low,volume,…]`（**开收高低量**） | 同左 |
| 衔接判定 | 第一页最旧 `2026-09-11` **vs** 第二页最新 `2026-09-10` → **严格更早**；两页（各 6 根）**拼接后与参考页 12 根逐日完全一致**（`2026-09-03 … 2026-09-18`），**无重叠、无缺口** | 同左（hk 日期集合与 cn 恰好一致） |
| 边界口径（实测） | `end` 为**闭区间（含端）**：`end=2024-01-10` 的窗口请求返回末行即 `2024-01-10` | 同左 |

**参数格式（源码复刻）**：`param=<wire>,<tf>,<start>,<end>,<count>,qfq`
- `<wire>`：cn=`sh600519`/`sz000001`；hk=**`hk00700`**（非 `r_hk` 前缀，见源码 `#klineWireCode`）。
- `<tf>`：`day` / `week` / `month`（分钟线走另一端点 `kline/mkline`，本次未覆盖）。
- `<start>`/`<end>`：`YYYY-MM-DD`，留空表示不设边界。
- `<count>`：保留**窗口内最新的 count 根**（实测行为，见下）。
- 末尾固定 `qfq`（前权）。

**取「严格早于 `before`」的换算**：
- `before` 为一根 bar 的日期（`YYYY-MM-DD`）。因 `end` 闭区间，**`end = before 的日期 − 1 个自然日`**，`start` 留空。
- 例：第一页最旧 `2026-09-11` → 第二页 `end=2026-09-10`（= 09-11 − 1 日），实测取得 09-03..09-10，与参考无缝。
- **游标粒度为「自然日」**：tencent 的 start/end 槽位只接受日期字符串，**无毫秒粒度**；日/周/月线够用，分钟级分页需另行验证 `mkline` 的 `param=<code>,<tf>,<start>,<count>` 形态（本次未覆盖）。

---

## 4) eastmoney — cn / hk 默认 provider

| 字段 | 内容 |
|---|---|
| 结论 | **支持**（证据来源：**主理人 WebFetch 补证**；本 spike 沙箱对该端点不可达） |
| 端点 | 与 `packages/connector-eastmoney/src/rest.ts:253` 现有构造一致，仅改 `end` 值 |
| 请求 URL | `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=1&lmt=5&end=<YYYYMMDD>&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58` |
| 关键观测（主理人转述） | `end=20500101` → 2026-09-14..2026-09-18；`end=20200102` → 末根 **2020-01-02**（恰为上界）；`end=20191225` → 末根 **2019-12-25**；三次各 5 根 |
| 衔接判定 | `end=20191225`（末根 2019-12-25）与相邻页 `2019-12-26` **相邻且不重叠**；`2020-01-02` 与相邻页间的跳跃落在周末，**非数据缺口** |
| 边界口径 | `end` 为**闭区间（含端）日期上界**，格式 `YYYYMMDD` |
| 实现提示 | 取「**严格早于** `before`」须 **`end = (before 所在日) − 1 自然日`**（`YYYYMMDD`）。响应含 `data.dktotal`（该标的日线总根数），可作辅助判据（可选）。 |
| 本出口状况（如实） | 本 spike 沙箱对 `push2his.eastmoney.com` **不可达**（`UND_ERR_SOCKET`，curl 侧 `schannel: server closed abruptly`；直连与代理各 5/5 失败），故未能自行抓取原始 JSON——见 `raw/11-eastmoney-page1-error.txt` 与转录 `raw/12-eastmoney-teamlead-supplement.md` |

---

## 与架构师假设的差异（**直接决定接线能否照原假设做**）

1. **tencent 的 `count` 语义**（架构师假设未提及，实为关键）：`count` 返回的是**窗口内最新的 N 根**，
   而非窗口内最早的 N 根。实测：窗口 `2020-06-01..2020-06-10`（共 8 行）配 `count=5` → 返回
   末 5 行 `2020-06-04..2020-06-10`。**这正是分页想要的语义**（配空 `start` 即「取 end 之前最新的 N 根」），
   但必须写进实现注释，否则会被误当成「取窗口头部」。
2. **tencent 的边界口径**：`end` 是**闭区间（含端）**。架构师说「`end` 取更早日期即往前翻页」方向正确，
   但**必须做 `−1 自然日` 换算**（直接传第一页最旧日期会**重叠**）。
3. **tencent 槽位顺序**：`<wire>,<tf>,<start>,<end>,<count>,qfq`——`start` 在前、`end` 在后，两者均可留空；
   翻页只需填 `end`、`start` 留空即可（`start` 全空时下界开放）。
4. **binance 边界换算已证实**：`endTime` 为**闭区间**，故取严格更早必须 **`endTime = before − 1` (ms)**。
   架构师假设的 `endTime = before − 1` **成立**。
5. **binance 默认主机在本出口不可达**：证据取自官方公开镜像 `data-api.binance.vision`（同 `/api/v3` 契约）。
   接线仍按默认 `api.binance.com`，仅增 `endTime`。
6. **yahoo ≠ 沙箱问题，而是地理封锁**：`period1`/`period2` 未取得任何证据；且现源码用的是 `range=`，
   属**新增参数用法**。Yahoo 自 2021-11-01 起对中国大陆整体关闭，返回区域通知页 → **本次不接线**。
7. **eastmoney 的 `end` 闭区间语义已由主理人补证**（本沙箱出口不可达）：`end=YYYYMMDD` 为**含端**上界，
   取严格更早须 **`end = (before 所在日) − 1 自然日`**。架构师假设的「改成 `oldest − 1 日` 即取更早一页」**成立**。

---

## 未能取得证据的源及原因

| 源 | 原因 | 处置 |
|---|---|---|
| **yahoo** | **地理封锁**（非沙箱问题）：Yahoo 自 2021-11-01 起对中国大陆用户整体关闭服务，返回**区域通知页**而非 JSON（本出口观测为 HTTP 403 拦截页；`query1`/`query2`、多 UA、有无代理皆然） | **本次不接线**，保持降级；`period1/period2` 假设**未验证**，不得据此实现 |
| **eastmoney** | 本 spike 沙箱对该端点不可达；已由**主理人 WebFetch 补证** | 已升级为**支持**，见上（转录 `raw/12-*`） |

## 本机补证命令（us 市场 / yahoo 闭环的**唯一入口**）

yahoo 被地域封锁，本出口**永久取证不到**；**无需改任何代码**——在**可访问 Yahoo 的网络**
（用户在境外/美区网络，或经合规代理）**直接重跑同一脚本**即可自动补齐 yahoo 的断言与原始响应：

```bash
# 在仓库根目录执行（Node 22+，全局 fetch，零第三方依赖；只读公开端点，不写仓库源码）
node spikes/impl-tv-history-paging/net-verify.mjs
```

**为什么无需改代码**：`net-verify.mjs` 的 `verifyYahoo()` 已实现完整的「两页衔接」流程——
先用 `period1/period2` 绝对窗口取第一页，命中后以第一页最旧一根为游标
（`period2 = floor(before/1000) − 1`，**秒**）取第二页，断言「第二页最新 < 第一页最旧」且无缝，
最后汇总进 `raw/summary.json`。本出口因 `403` 在第一步即短路（拦截页留证 `raw/04-yahoo-page1.json`），
故**只需换网络重跑**，脚本对可达源已全程跑通。

**预期输出形态**：

- **出口可达时**：stdout 打印
  `{"source":"yahoo","conclusion":"支持","urlPage1":"…","urlPage2":"…","firstPageOldest":<ms>,"secondPageNewest":<ms>,"cursorRule":"period2 = floor(before/1000) − 1 (秒)"}`；
  并落盘 `raw/04-yahoo-page1.json`（**真实行情 JSON**）+ `raw/05-yahoo-page2-strict.json`（更早一页）；
  `raw/summary.json` 中 yahoo 条目 `conclusion` 由 `证据不足` 变为 `支持`。
- **出口仍不可达时**：保持 `{"source":"yahoo","conclusion":"证据不足","reason":"HTTP 403…"}`，仅覆盖 `raw/04-*`（幂等，可反复跑）。
- **汇总尾行**形如 `- yahoo: 支持` 或 `- yahoo: 证据不足 (HTTP 403…)`。
- **判定标准**：`conclusion === "支持"` 即证明 `period1/period2` 绝对窗口**可用**，可据此在
  `packages/connector-yahoo/src/rest.ts` 现行 `range=` 之外**新增**该用法并接线；否则**维持降级**，
  **不得**据未证实的假设实现（契约纪律：宁缺勿错）。

> 注：eastmoney 本出口同样不可达，但其 `end` 闭区间语义已由**主理人补证**（`raw/12-*`）升级为**支持**，
> 用户无需再跑；上面这条命令的目标**仅为 yahoo**。重跑会重写 `raw/0x-*` 与 `raw/summary.json`，
> 属幂等操作，不影响已裁决的 binance/tencent/eastmoney 结论。

---

## 脚本与证据文件清单

```
spikes/impl-tv-history-paging/
├─ net-verify.mjs                 # 四源两页衔接取证脚本（零依赖，Node ESM）
├─ NET-VERIFY.md                  # 本文件
└─ raw/
   ├─ 01-binance-page1.json
   ├─ 02-binance-endtime-inclusive-d0.json
   ├─ 03-binance-page2-strict.json
   ├─ 04-yahoo-page1.json         # 403 拦截页（负证据）
   ├─ 05-tencent-cn-page1.json
   ├─ 06-tencent-cn-page2-strict.json
   ├─ 07-tencent-cn-reference.json
   ├─ 08-tencent-hk-page1.json
   ├─ 09-tencent-hk-page2-strict.json
   ├─ 10-tencent-hk-reference.json
   ├─ 11-eastmoney-page1-error.txt # 本出口网络错误文本（负证据）
   ├─ 12-eastmoney-teamlead-supplement.md # 主理人补证转录（eastmoney end 闭区间）
   └─ summary.json                # 机器可读逐源结论
```
