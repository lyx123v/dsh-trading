/**
 * `chart-viewport.ts` 的**对抗性单测**（QA 独立验证第一轮，2026-09-19 图表左缘惰性分页）。
 *
 * 核心使命是**试图证伪最高风险点 R-1**：视窗补偿量必须是「头部前插根数」，
 * 绝不能是 `next.length − prev.length`（后者 = 前插 + 尾部新增，resync 与前插同拍时
 * 会每次多平移一根，表现为每翻一页微跳）。本文件用**与工程师不同的组合**反复构造：
 * - 尾部 +3 且头部前插 1；尾部新增 0 且同拍发生 reset 判定；前插 0 而尾部 +5；纯前插；等长不变。
 * - 并对 `compensateViewport` 锁定「宽度恒定 + 两端同加」不变量。
 */
import { describe, expect, it } from 'vitest'
import { compensateViewport, detectHeadChange, reachesLeftEdge } from '../src/client/chart-viewport.ts'

/** 造一段只有 time 的序列。 */
function seq(times: readonly number[]): Array<{ time: number }> {
  return times.map((time) => ({ time }))
}

describe('detectHeadChange 前插补偿量（R-1 对抗）', () => {
  it('用户 尾部新增三根且头部前插一根时补偿量仍为一', () => {
    // Given 旧序列 10..14；新序列前插 1 根（9）且尾部新增 3 根（15/16/17）→ 长度差 4
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([9, 10, 11, 12, 13, 14, 15, 16, 17])
    // When 判定头部变化
    const change = detectHeadChange(prev, next)
    // Then 补偿量 = 前插根数 1（若误用长度差 4 则视窗每翻一页多跳 3 根）
    expect(change).toMatchObject({ kind: 'prepend', prependCount: 1 })
    expect(next.length - prev.length).toBe(4)
    expect(change.kind === 'prepend' && change.prependCount).not.toBe(next.length - prev.length)
  })

  it('用户 尾部无新增但头部被改写时判定为重置', () => {
    // Given 旧序列 10/11/12；新序列整体换成更早但锚点 10 已消失，长度相同
    const prev = seq([10, 11, 12])
    const next = seq([5, 6, 7])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then reset（fail-safe 走全量重置，绝不误当前插）
    expect(change).toEqual({ kind: 'reset' })
    expect(next.length - prev.length).toBe(0)
  })

  it('客户 头部前插为零而尾部新增五根时判定为追加', () => {
    // Given 旧序列 10..14；新序列头部不变、尾部追加 15..19
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then append（不做任何视窗补偿；补偿量为长度差 5 会错，但此分支根本不补偿）
    expect(change).toEqual({ kind: 'append', appendedFrom: 4 })
  })

  it('访客 纯前插且无尾部新增时补偿量等于长度差', () => {
    // Given 旧序列 10..14；新序列仅在头部前插 5..9
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then 此时长度差与补偿量一致（无尾部污染），仍取 prependCount 口径
    expect(change).toMatchObject({ kind: 'prepend', prependCount: 5 })
    expect(next.length - prev.length).toBe(5)
  })

  it('管理员 等长且头部不变时判定为追加而非前插', () => {
    // Given 旧序列与新序列完全相同长度与头部（仅尾部值被修订）
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([10, 11, 12, 13, 14])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then append（不补偿），尾部起点为旧末下标
    expect(change).toEqual({ kind: 'append', appendedFrom: 4 })
  })

  it('运营 前插与尾部同时增长时补偿量只认前置根数（尾部 +7 前插 2）', () => {
    // Given 旧序列 20..24；前插 2 根（18/19）+ 尾部新增 7 根 → 长度差 9
    const prev = seq([20, 21, 22, 23, 24])
    const next = seq([18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then 补偿量 2，长度差 9 被明确排除
    expect(change).toMatchObject({ kind: 'prepend', prependCount: 2 })
    expect(next.length - prev.length).toBe(9)
  })
})

describe('compensateViewport 不变量（A4 对抗）', () => {
  it('用户 平移后区间宽度恒定且两端同加前置根数', () => {
    // Given 可视区 [100, 159]、前插 30 根
    const range = { from: 100, to: 159 }
    // When 补偿
    const moved = compensateViewport(range, 30)
    // Then 两端各 +30、宽度不变（缩放级别保持）
    expect(moved).toEqual({ from: 130, to: 189 })
    expect(moved.to - moved.from).toBe(range.to - range.from)
  })

  it('客户 前插为零时补偿为恒等变换', () => {
    // Given 含小数的任意区间
    const range = { from: -3.5, to: 12.25 }
    // When 前插 0
    const moved = compensateViewport(range, 0)
    // Then 原样返回（不引入任何漂移）
    expect(moved).toEqual(range)
  })

  it('访客 一页规模的前置根数也保持宽度', () => {
    // Given 前插一整页 750 根
    const range = { from: 0, to: 120 }
    // When 补偿
    const moved = compensateViewport(range, 750)
    // Then 宽度不变、起点右移到 750
    expect(moved).toEqual({ from: 750, to: 870 })
    expect(moved.to - moved.from).toBe(120)
  })
})

describe('reachesLeftEdge 阈值边界（对抗）', () => {
  it('用户 可视起点为小数且落在阈值内时命中左缘', () => {
    // Given from = 9.5、阈值 10
    // When / Then 命中
    expect(reachesLeftEdge({ from: 9.5, to: 40 }, 10)).toBe(true)
  })

  it('客户 可视起点为小数且刚越过阈值时不命中', () => {
    // Given from = 10.5、阈值 10
    // When / Then 不命中
    expect(reachesLeftEdge({ from: 10.5, to: 40 }, 10)).toBe(false)
  })

  it('访客 可视起点为负（左端已在数据之外）时命中左缘', () => {
    // Given from 为负
    // When / Then 命中（避免负起点漏触发）
    expect(reachesLeftEdge({ from: -2, to: 8 }, 10)).toBe(true)
  })

  it('运营 阈值取零时仅起点不为正才命中', () => {
    // Given 阈值 0
    // When / Then 边界包含零
    expect(reachesLeftEdge({ from: 0, to: 20 }, 0)).toBe(true)
    expect(reachesLeftEdge({ from: 1, to: 20 }, 0)).toBe(false)
  })
})
