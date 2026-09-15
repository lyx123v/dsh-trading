# Agent Note: 主图指标读数行行数随悬停变化，图表容器高度跳变（KDAS 多锚点标的闪烁晃动）

Status: implemented

## Problem

用户报告：部分标的（如牧原股份 `cn:002714.SZ`）选中展示行情时，图表一直在闪烁晃动（附行情页截图，6 条 KDAS 关键日均价线）。

headless Chrome（trading-web 宿主 55001）复现，布局与截图一致（图表宽 1033.7 px、日K、6 条 KDAS）：把十字光标从 2026-09-05 锚点左侧移到右侧，主图读数行项目数 5→6、行高 15→38 px，下方图表容器高 1235.6→1212.4 px，pane 高 965.3/242.2→948.3/236.9 px，同一价位 42.75 的屏幕 y 360.47→354.10（整图 6.4 px 纵向位移 + 全量重绘一帧）。来回扫过锚点即反复跳动。

只有部分标的中招的原因：读数行项目数只在该指标「锚点/预热缺口落在可视区内」时随悬停变化——6 条 KDAS 关键日的标的（牧原股份、513050.SH 等）会变，1-2 个 output 的标的行数恒定，永远不跳。

## Root Cause

1. `QuoteStage` 的 `outputReadouts` 过滤掉 `output.values[readoutIndex] === undefined` 的项（KDAS 关键日锚点之前无值），**项目数因此取决于十字光标所在的那根 K 线**。
2. 读数行是流内元素（`.indicatorReadout { flex: none }`，位于 `.chartRow` 之上）：**它的行数就是图表容器的高度**。行数一变，lightweight-charts 随容器尺寸重排 pane、重算价格轴映射、resize 画布——表现为整图闪烁晃动。

## Decision

- 新增纯函数模块 `packages/client-ui-trading/src/client/indicator-readout.ts`：`readoutItems(groups, readoutIndex)` 对每个 output **恒定产出 1 项**，无值渲染 `'—'` 占位（与 fmtPrice/fmtChange 的缺值约定一致）；每项带 `width` = 该 output 全序列格式化后的最大字符数（ch）。
- `QuoteStage` 改消费 `readoutItems`（删除 `outputReadouts`），值列渲染为 `.readoutValue`（`display: inline-block`，`min-width: <width>ch`）——值与占位同宽。
- 两项合起来使「项目数」与「项目宽度」都与 `readoutIndex` 无关，读数行换行位置（行数）因此与悬停无关，图表容器高度恒定。

## Alternatives considered

- **只补占位不锁值列宽度**：占位 `'—'` 比数值串窄，某些宽度下仍会换行（实测同一行 6 项中含占位时总宽比全数值少 30+ px），跳变只是变少而非消失。
- **把主图读数搬进图内做绝对定位 overlay（照副图 pane legend 的做法）**：那是覆盖在蜡烛与 KDAS 线上的浮层，会挡图；现行设计有意把主图读数放在图表上方（见 [副图指标读数归位](../bug-fix/2026-08-31-sessionrail-uiworkspace-service-name-and-pane-legends.md)）。
- **CSS 固定行高（如 `height: 30px; overflow: hidden`）**：窄窗口下读数行实测需要 63-138 px（700 px 视口），固定高会静默裁掉读数。
- **不改代码，让用户缩小窗口/收起自选让行数稳定**：布局耦合与行为随宽度漂移依旧，换台机器就复发。

## Consequences

- 悬停/十字光标移动不再改变图表容器高度：修复后同一扫描（1530 视口）读数行高恒 38 px、容器高恒 1212.4 px、`priceToCoordinate(42.75)` 恒 354.1；900/1100/1300 视口同样恒定。
- 缺值项现在显示为 `KDAS_26-09-05: —`（此前整项消失）：读数行信息更完整，但也更长；语义上更准确（该条线在该根确实还没有值）。
- 值列按全序列最大字符数定宽，每项比旧实现宽约 3.6 px（172.9 vs 169.3 px，6 项时约 +21 px），极窄窗口下可能多占一行——换来行数不随悬停变化。数据量级变化（价格跨过 10/100 整数位）仍会一次性改变列宽，但那是数据事实而非悬停位置，且全序列取最大值时只在极值变化时发生。
- 验证：`packages/client-ui-trading` 401 用例全绿（新增 `test/indicator-readout.test.ts` 7 例）；`node scripts/typecheck-gate.mjs` 472 ≤ 基线 473；`node scripts/i18n-audit.mjs --check` OK；`tsdown` 重建 `lib/client.js`（与 profile 内 file: 副本同 inode，运行中的宿主按盘读取新产物，未重启、未 plugin install）。
- 残留：行数仍受「激活的指标集合」与「窗口宽度」影响（增删主图指标或改窗口宽度时读数行会有一次布局变化），这是内容事实变化，非本 bug 的悬停抖动。
- 后续（2026-09-15）：用户复测仍见"无操作时疯狂抖动"，且关掉 KDAS 后照抖 —— 那是另一条链路（右轴百分比标签宽度 ↔ 绘图区宽度互馈），见 [行情图蜡烛持续抖动](./2026-09-15-chart-axis-width-feedback-jitter.md)。本记录的缺陷（悬停跨锚点 23 px 跳变）已实测修复且独立成立。
