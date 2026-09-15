/**
 * 价格轴宽度下限纯计算层单测（axis-width.ts）：候选标签的口径与保守界。
 * 这是「图表宽度抖动」修复的判据层——标签一旦取窄，轴宽下限压不住 lwc 的
 * 「轴宽 ↔ 绘图区宽」正反馈，抖动会回来。
 */
import { describe, expect, it } from 'vitest'
import { axisMinimumWidth, percentLabelCandidates } from '../src/client/axis-width.ts'

describe('percentLabelCandidates', () => {
  it('参考价两个极端各取一条：正向用最小收盘、负向用最大收盘', () => {
    // rise = (45 - 32) / 32 * 100 = 40.625；fall = (30 - 44) / 44 * 100 = -31.8181…
    expect(percentLabelCandidates({ minPrice: 30, maxPrice: 45, minClose: 32, maxClose: 44 }))
      .toEqual(['40.63%', '-31.82%'])
  })

  it('正数不带正号（与 mirrorPercentFormat 同口径）', () => {
    expect(percentLabelCandidates({ minPrice: 90, maxPrice: 90, minClose: 90, maxClose: 90 })[0]).toBe('0.00%')
  })

  it('参考价为 0/负数等不可除情形回落到 0.00%（不产生 NaN/Infinity 标签）', () => {
    expect(percentLabelCandidates({ minPrice: 0, maxPrice: 0, minClose: 0, maxClose: 0 })).toEqual(['0.00%', '0.00%'])
  })

  it('大幅区间给出更长的标签（量级跨 10/100 各差一个字符）', () => {
    // rise = (1000 - 10) / 10 * 100 = 9900 → '9900.00%'（8 字符）
    const labels = percentLabelCandidates({ minPrice: 10, maxPrice: 1000, minClose: 10, maxClose: 1000 })
    expect(labels[0]).toBe('9900.00%')
    // fall = (10 - 1000) / 1000 * 100 = -99 → '-99.00%'（7 字符）
    expect(labels[1]).toBe('-99.00%')
  })
})

describe('axisMinimumWidth', () => {
  it('node 环境（无 DOM）返回 0：调用方据此跳过 applyOptions，不误锁轴宽', () => {
    expect(axisMinimumWidth(['42.93%'])).toBe(0)
  })
})
