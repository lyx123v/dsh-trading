# Agent Note: 资产面板总资产虚高——现金行被当标的盯市

Status: implemented

## Problem

资产面板「总资产」出现量级失真：用户台账 15 条持仓（约 6.9 万美元等值）显示为 927,680.664 USD，
其中浮动盈亏（+7,196.97 / +16.46%）却与持仓成本同口径、并无异常——同一屏的两个数来自同一个聚合
结果，却相差 13 倍。

根因不在币种折算（FX 快照 `{CNY:0.149, HKD:0.1275}` 正确，人民币/港币行都按汇率折成 USD），
而在**现金行的盯市**：台账没有独立现金实体，现金余额按「symbol = 币种代码」的约定记成持仓
（`{market:'us', symbol:'USD', size:8746.49, currency:'USD'}`）。面板展开时对这些「持仓」逐市场
批量 fetchTickers，而 `USD` / `HKD` / `CNY` 在行情 API 里都是真实标的：

| 台账现金行 | 行情实际命中 | 市值被算成 |
|---|---|---|
| us:USD 8,746.49（大象银行） | `USD` = ProShares Ultra Semiconductors，78.43 | 685,987.2 USD |
| us:USD 2,432.04（盈立证券） | 同上 | 190,744.9 USD |
| hk:HKD 120.87 | `HKD` = 某港股，1.72 | 207.90 HKD |
| cn:CNY 45,482.84 + 3,094.46 | `CNY` 非合法 A 股代码，行情报错 | 无价 → `marketValue` undefined → **静默消失**（总资产反而不含这 48,577.30 CNY ≈ 7,241 USD，且不标「近似」） |

即：现金行同时造成两个方向的错误——有同代码标的的被放大 78 倍，没有的被整条丢弃。实测复现
（真实 book.json + 桥 /fx + 桥 /tickers 喂给 `aggregateHoldings`）得 927,628.93，与截图
927,680.664 的差异只来自两次取价的行情浮动。

## Decision

现金行在客户端聚合引擎里按**面值**估值，并与行情完全隔离：

- `holdings-aggregate.ts` 新增 `isCashPosition(position)`：`symbol` 去空白、忽略大小写后
  等于行币种（`position.currency ?? MARKET_DEFAULT_CURRENCY[market]`）即判为现金。
- `detailRowOf`：现金行 `markPrice = 1`、`marketValue = size`（原币，再按 FX 折算）、
  `unrealizedPnl` 与 `costBase` 恒 undefined（面值即成本，不进成本合计，避免浮动盈亏比例
  被现金稀释）、连行情价键都不查——即使有人塞进 `us:USD` 报价也不参与。
- `HoldingsPanel.m2mTargetsKey`：现金行不进批量盯市目标（不是报价标的，少发无用请求）。
- 约定随契约与工具走：`docs/design/holdings-ledger.md` §2/§6.2/§6.3 写明现金行约定，
  `holdings_stage` 解析纪律加第 ⑦ 条、`holdings_add` 纪律加一句——现金余额
  `symbol` 用币种代码、`size` 为余额、不填 `entryPrice`。

同一台账数据修复后总资产 ≈ 69,305.52 USD（含被丢掉的 48,577.30 CNY 现金），无「近似」标记。

## Alternatives considered

- **给 `Holding` 加显式 `cash: true` 字段**：语义无歧义、能挡住「真持有 USD(ProShares) 这只
  标的」的极端情形，但要动 @dshtrading/holdings schema + 校验 + 桥 + client 类型 + 面板，
  且存量 5 条现金行没有标记，仍需读侧推断或一次性数据迁移；收益只是消掉一个低概率歧义，
  当期成本高于该修复本身。保留为后续演进方向（届时 symbol=币种代码 仍可作迁移推断规则）。
- **只在 `m2mTargetsKey` 里跳过现金行**：能挡住 `us:USD` 的伪价，但现金行随即失去 `marketValue`，
  会以「无现价」名义整条退出总资产——正是 cn:CNY 那条现金今天的错误形态。估值规则必须落在
  纯函数聚合引擎（单一事实来源），面板只做「不发无用请求」的表层收敛。
- **把现金从台账里删掉、只用「余额」tab 看**：live 连接器的余额面只覆盖已配置交易连接器的账户，
  用户口述的多账户现金（大象银行、盈立证券等）没有落点，总资产会漏掉真实现金；否决。
- **在行情层拒绝「币种代码」symbol**：连接器是行情词汇的单一事实来源，`USD` 在那里就是合法
  美股代码；把台账的行语义塞进行情层会让两个平面互相污染；否决。

## Consequences

- 现金行显示为「市值 = 余额 + 币种、开仓均价 —、未实现盈亏 —」，不再有伪价；同市场同币种的多账户
  现金合并成一条汇总行（可展开分账户明细）。
- `symbol` 恰为币种代码的**真实标的**（如美股 `USD`）会被当现金按面值估值——低概率歧义，
  与「现金按约定记入」冲突时以约定为准；解法是显式 `cash` 字段（见备选），当前不做。
- `cn:CNY` 这类查不到行情的现金不再静默消失；反之，任何「无现价行不进总资产且不标近似」的老行为
  对现金行不再适用（现金不需要现价）。
- 验证：`holdings-aggregate.test.ts` 新增 5 条现金行用例（面值估值/忽略同代码报价/按 market 推导
  币种/非现金行不受影响/总资产复现旧误算），`packages/client-ui-trading` 与 `packages/holdings`
  测试全绿；真实台账数据复跑聚合 = 修正后 69,305.52 USD。
- 已知边界：宿主 `holdings_list` 等工具不做估值（只列记录），本次不涉及；运行中的桌面实例需重建
  client 产物并按 profile 刷新契约更新副本后重启才可见。
