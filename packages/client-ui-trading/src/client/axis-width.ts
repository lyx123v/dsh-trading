/**
 * 价格轴宽度下限（px）：锁死「轴宽 ↔ 绘图区宽」这条正反馈。
 *
 * lwc 的价格轴宽度 = 当前刻度标签里最宽的那一条（+ 轴内边距），而绘图区宽度 =
 * 容器宽 - 左轴宽 - 右轴宽。绘图区一变，可视 K 线根数随之变，自缩放的价格区间
 * 随之变，刻度标签随之变，轴宽又变……右侧「相对涨跌幅」轴的标签长度尤其不稳
 * （正数不带正号、量级跨 10/100 各差一个字符、参考价还来自可视区最左一根），
 * 于是某些容器宽度下整条链路无限抖动：2026-09-15 headless 实测同一张图在
 * 625px 容器宽下右轴在 58 ↔ 66 ↔ 72px（5/6/7 字符标签）之间反复跳，蜡烛随
 * 绘图区宽度重排重定标，肉眼就是「图表疯狂抖动」。
 *
 * 解法：给轴一个与可视区无关的宽度下限。按当前数据的价格极值算出可能出现的
 * 最宽标签，取其浏览器文本宽度 + lwc 轴内边距。下限只随数据变化，可视区再变
 * 也改不动轴宽，反馈断开（实测下限 84px 时该宽度下只剩 1 个稳定状态）。
 */
/** 轴标签字体：与 TvChart 的 getChartThemeOptions 同源，改动须同步。 */
export const AXIS_FONT_SIZE = 10.5
export const AXIS_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, sans-serif'

/** lwc 轴标签内边距（实测 26.4-28.1px，取 32 保守值：偏大只多几像素留白，偏小会重新抖）。 */
const AXIS_LABEL_MARGIN = 32

export interface PercentAxisExtremes {
  /** 价格轴自缩放包络的下/上界（蜡烛高低 ∪ 主图指标输出）。 */
  minPrice: number
  maxPrice: number
  /** 闭区间收盘价极值——参考价（可视区最左一根收盘）必落在此区间内。 */
  minClose: number
  maxClose: number
}

/** 与 TvChart 的 mirrorPercentFormat 同口径：正数不带正号、两位小数、带 %。 */
function percentLabel(percent: number): string {
  return `${percent.toFixed(2)}%`
}

/**
 * 右轴可能出现的两个最宽标签：正向极值在「参考价取最小收盘、价格取最高」时取到，
 * 负向极值在「参考价取最大收盘、价格取最低」时取到。返回文本即 formatter 输出。
 */
export function percentLabelCandidates(extremes: PercentAxisExtremes): string[] {
  const { minPrice, maxPrice, minClose, maxClose } = extremes
  const rise = minClose > 0 ? (maxPrice - minClose) / minClose * 100 : 0
  const fall = maxClose > 0 ? (minPrice - maxClose) / maxClose * 100 : 0
  return [percentLabel(rise), percentLabel(fall)]
}

/** 标签集合里最宽一条的浏览器文本宽度 + 轴内边距；无 DOM（node 单测）时回 0。 */
export function axisMinimumWidth(labels: readonly string[]): number {
  if (typeof document === 'undefined') return 0
  const context = document.createElement('canvas').getContext('2d')
  if (context === null) return 0
  context.font = `${AXIS_FONT_SIZE}px ${AXIS_FONT_FAMILY}`
  let widest = 0
  for (const label of labels) widest = Math.max(widest, context.measureText(label).width)
  return Math.ceil(widest) + AXIS_LABEL_MARGIN
}
