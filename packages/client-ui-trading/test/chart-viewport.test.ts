/**
 * `chart-viewport.ts` 纯函数单测（2026-09-19 图表左缘惰性分页 · T02）。
 *
 * 覆盖设计文档 §12.2 的必须断言：A3（`detectHeadChange` 三态，含 R-1 守门）/
 * A4（`compensateViewport` 不变量）/ 左缘阈值。
 *
 * 纯函数直调，零 canvas、零 lightweight-charts、零 mock（项目测试棘轮要求）。
 */
import { describe, expect, it } from 'vitest'
import { compensateViewport, detectHeadChange, reachesLeftEdge } from '../src/client/chart-viewport.ts'

/** 造一段只有 time 的序列。 */
function seq(times: readonly number[]): Array<{ time: number }> {
  return times.map(time => ({ time }))
}

describe('detectHeadChange（A3 / R-1 守门）', () => {
  it('用户 纯前插时判定为 prepend 且补偿量为前插根数', () => {
    // Given 旧序列 10..14，新序列在头部前插 5..9（保留原段）
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    // When 判定头部变化
    const change = detectHeadChange(prev, next)
    // Then prepend 且 prependCount = 5（不是长度差 10-5=5 之外的任何值）
    expect(change).toMatchObject({ kind: 'prepend', prependCount: 5 })
  })

  it('管理员 前插 5 根且尾部同时 +1 时补偿量仍为 5 而非 6', () => {
    // Given 旧序列 10..14，新序列前插 5..9 且尾部追加 15（长度差 = 6）
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    // When 判定头部变化
    const change = detectHeadChange(prev, next)
    // Then 补偿量是 prependCount=5 —— 这正是不能用「长度差（6）」的守门断言
    expect(change).toMatchObject({ kind: 'prepend', prependCount: 5 })
    expect(next.length - prev.length).toBe(6)
  })

  it('客户 头部未变仅尾部增长时判定为 append 并给出尾部起点', () => {
    // Given 旧序列 10..14，新序列在其后追加 15
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([10, 11, 12, 13, 14, 15])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then append（不做视窗补偿），起点为旧尾下标 4
    expect(change).toEqual({ kind: 'append', appendedFrom: 4 })
  })

  it('用户 头部被改写（锚点时间不在新序列）时判定为 reset', () => {
    // Given 旧序列以 10 打头，新序列整体前移丢弃了 10
    const prev = seq([10, 11, 12, 13, 14])
    const next = seq([11, 12, 13, 14, 15])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then reset（fail-safe 走全量重置）
    expect(change).toEqual({ kind: 'reset' })
  })

  it('运营 锚点后错位（历史被改写）时判定为 reset', () => {
    // Given 旧序列 10/11/12；新序列锚点 10 的下标为 1，但其后一位是 99 而非 11
    const prev = seq([10, 11, 12])
    const next = seq([5, 10, 99, 11, 12])
    // When 判定
    const change = detectHeadChange(prev, next)
    // Then reset（数据源改写了历史，不可当 append/prepend 处理）
    expect(change).toEqual({ kind: 'reset' })
  })

  it('访客 空序列或首屏无旧序列时判定为 reset', () => {
    // Given 空的新序列 / 空的旧序列
    // When / Then 一律 reset（首屏或清空）
    expect(detectHeadChange(seq([]), seq([1, 2]))).toEqual({ kind: 'reset' })
    expect(detectHeadChange(seq([1, 2]), seq([]))).toEqual({ kind: 'reset' })
  })
})

describe('compensateViewport（A4）', () => {
  it('用户 平移后区间宽度恒定且两端同加 prependCount', () => {
    // Given 可视区逻辑下标 [100, 159]，前插 30 根
    const range = { from: 100, to: 159 }
    // When 补偿
    const moved = compensateViewport(range, 30)
    // Then 两端各 +30，宽度（缩放级别）不变
    expect(moved).toEqual({ from: 130, to: 189 })
    expect(moved.to - moved.from).toBe(range.to - range.from)
  })

  it('客户 零前插补偿为恒等变换', () => {
    // Given 任意区间
    const range = { from: -3.5, to: 12.25 }
    // When prependCount = 0
    const moved = compensateViewport(range, 0)
    // Then 区间原样不动
    expect(moved).toEqual(range)
  })
})

describe('reachesLeftEdge 左缘阈值', () => {
  it('用户 可视区最左下标落在阈值内时判定已到左缘', () => {
    // Given from = 10、阈值 10
    // When / Then 命中左缘
    expect(reachesLeftEdge({ from: 10, to: 40 }, 10)).toBe(true)
  })

  it('客户 可视区最左下标刚越过阈值时判定未到左缘', () => {
    // Given from = 11、阈值 10
    // When / Then 不命中
    expect(reachesLeftEdge({ from: 11, to: 40 }, 10)).toBe(false)
  })

  it('访客 图表未就绪（range 为 null）时判定未到左缘', () => {
    // Given 空的逻辑区间
    // When / Then 一律为假
    expect(reachesLeftEdge(null, 10)).toBe(false)
  })
})
