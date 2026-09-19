/**
 * @vitest-environment jsdom
 *
 * `useKlineHistory` 时序 / 竞态回归（2026-09-19，钉死 QA 缺陷工单 #1）。
 *
 * 缺陷：30s resync（或 `visibilitychange` 触发的尾部取数）与「前插更早一页」并发时，
 * 旧实现用「key + 游标」单槽 token，resync 会顶替前插 token → 前插响应命中
 * `token !== request` 被静默丢弃：既不派发 `pageOk` 也不派发 `pageFailed`，`inflight`
 * 永久为真、状态机永久卡 `loading`（此后 `reprobe` 亦 no-op）。
 *
 * 本文件用**手写受控 deferred 注入缝**（零 mock，棘轮禁 vi.* / setTimeout）复现该序列，
 * 断言两条不变量：①同 key 的并发（resync × 前插）互不作废、前插响应必须被应用；
 * ②换数据键（换标的）后在途响应必须被丢弃、不得污染新标的。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { KlinePage } from '../src/client/api.ts'
import { KLINE_PAGE_SIZE_DAILY } from '../src/client/kline-history.ts'
import type { Kline, MarketId } from '../src/client/types.ts'
import { useKlineHistory } from '../src/client/useKlineHistory.ts'
import type { FetchKlinePage } from '../src/client/useKlineHistory.ts'

afterEach(cleanup)

const DAY = 86_400_000

/** 一根 K 线（测试只关心 openTime，其余字段补齐类型）。 */
function bar(openTime: number): Kline {
  return { openTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000, closeTime: openTime + DAY }
}

/** 生成 `[start, start + count*DAY)` 的**满页**（满页 = classify 判为 'page'，非终止）。 */
function fullPage(start: number, count: number): KlinePage {
  const klines: Kline[] = []
  for (let i = 0; i < count; i += 1) klines.push(bar(start + i * DAY))
  return { klines, history: { supportsEarlier: true } }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error?: unknown) => void
}

/** 手动 deferred（替代 vi 的受控 promise；棘轮禁 mock 工具）。 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

interface Recorder {
  readonly fetchPage: FetchKlinePage
  readonly calls: Array<{ before: number | undefined; d: Deferred<KlinePage> }>
}

/** 手写记录器 + 受控 deferred 取数假件：按调用顺序返回挂起 promise，测试逐条注入时机。 */
function makeRecorder(): Recorder {
  const calls: Array<{ before: number | undefined; d: Deferred<KlinePage> }> = []
  const fetchPage: FetchKlinePage = (_market, _symbol, _interval, _limit, before) => {
    const d = deferred<KlinePage>()
    calls.push({ before, d })
    return d.promise
  }
  return { fetchPage, calls }
}

describe('useKlineHistory 竞态守卫（resync × 前插 / 换标的）', () => {
  it('用户 前插更早一页与 resync 并发时不得卡在 loading 且前插响应终被应用', async () => {
    // Given 首屏尾部窗口已就绪（满页 → ready，游标 = 最旧 openTime）
    const recorder = makeRecorder()
    const { result } = renderHook(() => useKlineHistory({ market: 'hk', symbol: '00700', interval: '1d', fetchPage: recorder.fetchPage }))
    await waitFor(() => expect(recorder.calls).toHaveLength(1)) // 挂载即发尾部窗口
    const tailStart = 2_000_000 * DAY
    await act(async () => { recorder.calls[0]!.d.resolve(fullPage(tailStart, KLINE_PAGE_SIZE_DAILY)) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines).toHaveLength(KLINE_PAGE_SIZE_DAILY)

    // When 触发左缘前插（响应挂起，phase=loading），紧随 resync（visibilitychange）并发
    await act(async () => { result.current.onReachLeftEdge() })
    expect(recorder.calls).toHaveLength(2)
    expect(recorder.calls[1]!.before).toBe(tailStart) // 前插以最旧游标为 before
    expect(result.current.edge).toEqual({ phase: 'loading' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    // 分页在途 → resync 被单飞闸拦下（不新增尾部请求，单槽守卫不再被顶替）
    expect(recorder.calls).toHaveLength(2)

    // 前插响应到达（比尾部更早的一整页）
    const earlierStart = tailStart - KLINE_PAGE_SIZE_DAILY * DAY
    await act(async () => { recorder.calls[1]!.d.resolve(fullPage(earlierStart, KLINE_PAGE_SIZE_DAILY)) })

    // Then 前插被应用（序列增长）且状态机回到 ready（**不得**停在 loading）
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines).toHaveLength(KLINE_PAGE_SIZE_DAILY * 2)
    expect(result.current.klines?.[0]?.openTime).toBe(earlierStart)
  })

  it('用户 换标的后旧标的在途尾部响应被丢弃且不污染新标的序列', async () => {
    // Given 先以 hk/00700 挂载，尾部响应尚未返回（在途）
    const recorder = makeRecorder()
    const { result, rerender } = renderHook(
      (props: { market: MarketId; symbol: string }) => useKlineHistory({ ...props, interval: '1d', fetchPage: recorder.fetchPage }),
      { initialProps: { market: 'hk' as MarketId, symbol: '00700' } },
    )
    await waitFor(() => expect(recorder.calls).toHaveLength(1))

    // When 未等旧响应返回即换到 us/AAPL（reset 换代 + 新尾部请求）
    rerender({ market: 'us' as MarketId, symbol: 'AAPL' })
    await waitFor(() => expect(recorder.calls).toHaveLength(2))
    // 旧标的在途尾部响应此刻才回来
    await act(async () => { recorder.calls[0]!.d.resolve(fullPage(9_000_000 * DAY, KLINE_PAGE_SIZE_DAILY)) })

    // Then 旧响应被丢弃（不污染新标的；新标的序列仍为未加载）
    expect(result.current.klines).toBeNull()

    // 新标的响应到达 → 正常就绪
    const newStart = 3_000_000 * DAY
    await act(async () => { recorder.calls[1]!.d.resolve(fullPage(newStart, KLINE_PAGE_SIZE_DAILY)) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines).toHaveLength(KLINE_PAGE_SIZE_DAILY)
    expect(result.current.klines?.[0]?.openTime).toBe(newStart)
  })

  it('用户 分页在途时触发左缘重试动作不新增取数请求（防双发）', async () => {
    // Given 首屏尾部分页已就绪（满页 → ready）
    const recorder = makeRecorder()
    const { result } = renderHook(() => useKlineHistory({ market: 'hk', symbol: '00700', interval: '1d', fetchPage: recorder.fetchPage }))
    await waitFor(() => expect(recorder.calls).toHaveLength(1))
    const tailStart = 2_000_000 * DAY
    await act(async () => { recorder.calls[0]!.d.resolve(fullPage(tailStart, KLINE_PAGE_SIZE_DAILY)) })
    await waitFor(() => expect(result.current.edge).toBeNull())

    // When 触发前插使其处于 loading（在途），随后调用左缘重试动作
    await act(async () => { result.current.onReachLeftEdge() })
    expect(recorder.calls).toHaveLength(2)
    expect(result.current.edge).toEqual({ phase: 'loading' })
    await act(async () => { result.current.onHistoryEdgeAction() })

    // Then loading 相下重试动作被短接：不 reprobe、不重复 load（请求数不增，防双发）
    expect(recorder.calls).toHaveLength(2)

    // And 原在途请求仍正常收敛（未被重试动作破坏）
    const earlierStart = tailStart - KLINE_PAGE_SIZE_DAILY * DAY
    await act(async () => { recorder.calls[1]!.d.resolve(fullPage(earlierStart, KLINE_PAGE_SIZE_DAILY)) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines).toHaveLength(KLINE_PAGE_SIZE_DAILY * 2)
  })
})
