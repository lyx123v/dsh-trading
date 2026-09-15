/**
 * MacroPanel 双数据源编排冒烟（2026-09-15 评审 M3/L1 回归）：经济数据（MCP 日历）与
 * 央行利率（网页版）各自记账——任一源失败只在自己那个页签出错误提示，绝不把「一个源
 * 挂了」画成「没有数据」；上游给负星号也不许炸掉整块面板。纯函数单测覆盖不到这层编排。
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'

/** 桥面桩：null = 该源不可用（fetchMacro* 的真实失败语义）。 */
const net = vi.hoisted(() => ({
  calendar: null as Array<Record<string, unknown>> | null,
  rates: null as Array<Record<string, unknown>> | null,
}))

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    fetchMacroCalendar: async () => net.calendar as never,
    fetchMacroRates: async () => net.rates as never,
  }
})

import { MacroPanel, calendarAnchorDate, localDateKeyOf } from '../src/client/MacroPanel.tsx'

/** key 直出翻译（断言用 key 而非文案，与词典解耦）。 */
const t = (key: MarketLocaleKey): string => key

const cal = (region: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ publishedAt: '2026-09-14T12:30:00.000Z', star: 3, region, title, ...extra })
const rate = (region: string, bankName: string): Record<string, unknown> =>
  ({ region, bankName, rate: '3.75', publishedAt: '2026-09-10' })

describe('MacroPanel 双源状态与地区筛选', () => {
  beforeEach(() => {
    net.calendar = null
    net.rates = null
  })
  afterEach(() => cleanup())

  it('默认只看美日中：日历与利率都按地区过滤，页签可切', async () => {
    net.calendar = [cal('美国', '美国9月核心CPI年率'), cal('德国', '德国8月CPI年率')]
    net.rates = [rate('日本', '日本央行'), rate('巴西', '巴西央行')]
    render(<MacroPanel t={t} onClose={() => {}} />)

    await waitFor(() => { expect(screen.queryByText('美国9月核心CPI年率')).not.toBeNull() })
    expect(screen.queryByText('德国8月CPI年率')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'macro.tab.rates' }))
    expect(screen.queryByText('日本央行')).not.toBeNull()
    expect(screen.queryByText('巴西央行')).toBeNull()
  })

  it('切到「全部」后放开地区过滤', async () => {
    net.calendar = [cal('美国', '美国9月核心CPI年率'), cal('德国', '德国8月CPI年率')]
    net.rates = []
    render(<MacroPanel t={t} onClose={() => {}} />)
    await waitFor(() => { expect(screen.queryByText('美国9月核心CPI年率')).not.toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: 'macro.regionAll' }))
    expect(screen.queryByText('德国8月CPI年率')).not.toBeNull()
  })

  it('只有利率失败：利率页签出错误提示、不冒充空数据；日历页签照常', async () => {
    net.calendar = [cal('美国', '美国9月核心CPI年率')]
    net.rates = null
    render(<MacroPanel t={t} onClose={() => {}} />)
    await waitFor(() => { expect(screen.queryByText('美国9月核心CPI年率')).not.toBeNull() })
    expect(screen.queryByText('macro.error')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'macro.tab.rates' }))
    await waitFor(() => { expect(screen.queryByText('macro.error')).not.toBeNull() })
    expect(screen.queryByText('macro.empty')).toBeNull()
  })

  it('只有日历失败：日历页签出错误提示，利率页签照常出数据', async () => {
    net.calendar = null
    net.rates = [rate('美国', '美国联邦储备局')]
    render(<MacroPanel t={t} onClose={() => {}} />)

    await waitFor(() => { expect(screen.queryByText('macro.error')).not.toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'macro.tab.rates' }))
    await waitFor(() => { expect(screen.queryByText('美国联邦储备局')).not.toBeNull() })
    expect(screen.queryByText('macro.error')).toBeNull()
  })

  it('两源都可用但过滤后为空 → 空态文案（不是错误）', async () => {
    net.calendar = [cal('德国', '德国8月CPI年率')]
    net.rates = []
    render(<MacroPanel t={t} onClose={() => {}} />)
    await waitFor(() => { expect(screen.queryByText('macro.empty')).not.toBeNull() })
    expect(screen.queryByText('macro.error')).toBeNull()
  })

  it('负星号不炸面板（repeat 前夹到 [0,5]）', async () => {
    net.calendar = [cal('美国', '美国9月核心CPI年率', { star: -1 })]
    net.rates = []
    render(<MacroPanel t={t} onClose={() => {}} />)
    await waitFor(() => { expect(screen.queryByText('美国9月核心CPI年率')).not.toBeNull() })
    expect(screen.queryByText('macro.error')).toBeNull()
  })
})

/** 相对 now 的本地时间构造行（时区无关：全部用 setHours 本地钟面）。 */
const relRow = (base: Date, days: number, hours: number): { publishedAt: string } => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  d.setHours(hours, 0, 0, 0)
  return { publishedAt: d.toISOString() }
}

describe('calendarAnchorDate 首屏锚定（2026-09-15「只有 9.14 的数据」回归）', () => {
  // t0 = 今天本地 10:00（避开午夜跨界歧义）。
  const t0 = new Date()
  t0.setHours(10, 0, 0, 0)

  it('今天有条目 → 锚定今天（而不是升序列表开头的周一）', () => {
    const rows = [relRow(t0, -1, 12), relRow(t0, 0, 8), relRow(t0, 0, 20), relRow(t0, 1, 9)]
    expect(calendarAnchorDate(rows, t0)).toBe(localDateKeyOf(t0.toISOString()))
  })

  it('今天没有条目 → 锚定第一条尚未公布的条目', () => {
    const rows = [relRow(t0, -2, 12), relRow(t0, 1, 9), relRow(t0, 2, 9)]
    expect(calendarAnchorDate(rows, t0)).toBe(localDateKeyOf(rows[1]!.publishedAt))
  })

  it('全部已公布 → 锚定最后一条；空列表 → 空串（不滚）', () => {
    const rows = [relRow(t0, -2, 12), relRow(t0, -1, 9)]
    expect(calendarAnchorDate(rows, t0)).toBe(localDateKeyOf(rows[1]!.publishedAt))
    expect(calendarAnchorDate([], t0)).toBe('')
  })

  it('localDateKeyOf 产出本地 YYYY-MM-DD（与面板行 data 属性一致）', () => {
    const d = new Date(2026, 8, 15, 23, 59)
    expect(localDateKeyOf(d.toISOString())).toBe('2026-09-15')
    expect(localDateKeyOf('not-a-date')).toBe('')
  })
})
