/**
 * 图表视窗保持的**纯数学**（零 canvas、零 lightweight-charts import、零 React，2026-09-19）。
 *
 * 只做三件事：判定「新序列相对旧序列的头部变化」、按**逻辑下标**平移视窗、判定左缘。
 * 把「体验核心」的数学从 `TvChart` 里抽出来，无 canvas 也能单测（项目测试棘轮禁 mock）。
 *
 * 核心纪律（R-1）：前插后的补偿量**只能**取 `detectHeadChange().prependCount`，
 * **绝不**能用 `next.length − prev.length` —— 后者 = `prependCount + 尾部新增`，
 * 而 resync 与前插常同拍发生，用长度差会每次多平移一根（视窗每翻一页微跳一次）。
 */

/** 时间序列点（只需 `time`；图表 bar 的 `time` 为 UTC 秒，本模块不关心单位，只做比较）。 */
export interface TimePoint {
  readonly time: number
}

/** 与 lightweight-charts `LogicalRange` 同构的最小面（便于无依赖单测）。 */
export interface LogicalRangeLike {
  readonly from: number
  readonly to: number
}

/**
 * 新序列相对旧序列的头部变化：
 * - `reset`    头部无法对齐（换标的 / 数据源改写历史 / 序列清空）→ 走全量重置；
 * - `append`   头部未变，只有尾部增长 → 尾部增量更新（`appendedFrom` = 起始下标）；
 * - `prepend`  头部前插 `prependCount` 根，尾部可能同时增长 → 全量 setData + 视窗补偿。
 */
export type HeadChange =
  | { kind: 'reset' }
  | { kind: 'append'; appendedFrom: number }
  | { kind: 'prepend'; prependCount: number; appendedFrom: number }

/**
 * 判定新序列相对旧序列的头部变化。判定**完全基于 `time`**（不依赖长度差）。
 *
 * 算法（§5.2）：
 *   anchor = prev[0].time
 *   offset = next 里 anchor 所在下标
 *   offset < 0                      → reset（锚点不在新序列，头部被改写/前移丢弃）
 *   offset === 0                    → append（头部未变，尾部增长）
 *   offset > 0 且逐位对得上          → prepend{prependCount = offset}
 *   否则                            → reset（fail-safe：数据源改写了历史）
 *
 * 注：设计文档 §5.2 伪码写「offset ≤ 0 → reset」，但 §4 步骤⑥与 H2/H4 明确要求
 * 「头部未变 → append → 尾部增量」，若 offset===0 也 reset，则每次 30s resync 都会
 * 全量重置（`resetTimeScale + scrollToRealTime`）——与「resync 不跳视窗」直接冲突。
 * 故此处把 offset===0 归为 append（与既有 `firstTimeDiffers` 增量的行为一致）。
 */
export function detectHeadChange(prev: readonly TimePoint[], next: readonly TimePoint[]): HeadChange {
  if (prev.length === 0 || next.length === 0) return { kind: 'reset' }
  const anchor = prev[0]?.time
  if (anchor === undefined) return { kind: 'reset' }
  const offset = next.findIndex(point => point.time === anchor)
  if (offset < 0) return { kind: 'reset' }
  if (offset === 0) return { kind: 'append', appendedFrom: Math.max(prev.length - 1, 0) }
  // offset > 0：新序列必须逐位包含旧的整段（否则视为头部改写 → fail-safe reset）
  for (let index = 0; index < prev.length; index++) {
    const candidate = next[offset + index]
    if (candidate === undefined || candidate.time !== prev[index]?.time) return { kind: 'reset' }
  }
  return {
    kind: 'prepend',
    prependCount: offset,
    appendedFrom: Math.max(offset + prev.length - 1, 0),
  }
}

/**
 * 视窗保持：把逻辑下标区间整体平移 `prependCount`，**区间宽度（= 缩放级别）不变**。
 * 头部前插 k 根 ⇒ 所有既有柱的逻辑下标整体 +k，故可视区间的 from/to 同加 k，
 * 时间范围与缩放级别保持不变。`to − from` 恒定是本函数唯一的不变量（单测断言）。
 */
export function compensateViewport(range: LogicalRangeLike, prependCount: number): LogicalRangeLike {
  return { from: range.from + prependCount, to: range.to + prependCount }
}

/**
 * 左缘判定：可视区最左侧逻辑下标落入最左 `triggerBars` 根内即为真。
 * `null`（图表未就绪 / 无数据）一律为假。
 */
export function reachesLeftEdge(range: LogicalRangeLike | null, triggerBars: number): boolean {
  if (range === null) return false
  return range.from <= triggerBars
}
