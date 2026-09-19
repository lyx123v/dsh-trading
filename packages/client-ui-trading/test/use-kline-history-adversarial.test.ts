/**
 * @vitest-environment jsdom
 *
 * `useKlineHistory` 时序 / 竞态**对抗性**回归（2026-09-19，第二轮）。
 *
 * 与 `use-kline-history.test.ts`（钉死 QA 缺陷工单 #1：resync × 前插竞态）互补，
 * 本文件在同一注入缝（`fetchPage`，零 mock、零 fake timer）上继续压测**修复后的语义边界**：
 * - error 态**不受 60s 冷却**约束，可立即重试（`reprobe` 只对 terminated 设冷却）；
 * - terminated(source) / unsupported **粘性**不被 30s resync 清除；
 * - terminated 后 60s 冷却内 `reprobe` 为 no-op（不放大上游）；
 * - 桥闸拒绝码 `TRADING_KLINE_HISTORY_UNSUPPORTED` → 进 unsupported（粘性）；
 * - 同 key 的「尾部 resync 在途 × 左缘前插」并发：两个响应都得被应用，不得卡 loading；
 * - 换数据键 = `reset` 全清（终止粘性一并清除）；
 * - 页大小经注入缝实测：日线（hk/crypto）恒 750、crypto 非日线 300 —— 证明页大小单一出口。
 *
 * 合规：棘轮禁 `vi.*` / `setTimeout` / `sleep`；叶标题以角色词起头；叶内含 Given/When/Then 标记。
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

/** 一根 K 线（仅 openTime 参与分页断言，其余补齐类型）。 */
function bar(openTime: number): Kline {
  return { openTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000, closeTime: openTime + DAY }
}

/** `[start, start + count*DAY)` 的连续 K 线数组。 */
function bars(start: number, count: number): Kline[] {
  const out: Kline[] = []
  for (let i = 0; i < count; i += 1) out.push(bar(start + i * DAY))
  return out
}

/** 声明支持更早历史的一页。 */
function page(rows: Kline[]): KlinePage {
  return { klines: rows, history: { supportsEarlier: true } }
}

/** 声明**不支持**更早历史的一页（尾部窗口仍可返回，仅能力为 false）。 */
function pageNoEarlier(rows: Kline[]): KlinePage {
  return { klines: rows, history: { supportsEarlier: false } }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error?: unknown) => void
}

/** 手写受控 deferred（棘轮禁 mock 工具）。 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

interface Call {
  readonly limit: number
  readonly before: number | undefined
  readonly d: Deferred<KlinePage>
}

interface Recorder {
  readonly fetchPage: FetchKlinePage
  readonly calls: Call[]
}

/** 手写记录器 + 受控 deferred：按调用顺序挂起 promise，测试逐条注入 resolve/reject 时机。 */
function makeRecorder(): Recorder {
  const calls: Call[] = []
  const fetchPage: FetchKlinePage = (_market, _symbol, _interval, limit, before) => {
    const d = deferred<KlinePage>()
    calls.push({ limit, before, d })
    return d.promise
  }
  return { fetchPage, calls }
}

/** 稳定 props（供 rerender 换标的 / 换周期）。 */
interface Props {
  market: MarketId
  symbol: string
  interval: string
}

function useWith(props: Props, recorder: Recorder) {
  return useKlineHistory({ ...props, fetchPage: recorder.fetchPage })
}

describe('useKlineHistory 分页失败 / 粘性 / 并发 对抗性回归（R2）', () => {
  it('用户 更早一页失败进入 error 后可立即重试且不受 60s 冷却约束', async () => {
    // Given 首屏尾部满页就绪（游标 = 最旧 openTime）
    const rec = makeRecorder()
    const { result } = renderHook(() => useWith({ market: 'hk', symbol: '00700', interval: '1d' }, rec))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    const tail = 2_000_000 * DAY
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())

    // When 左缘前插失败（通用错误码，无 code）
    await act(async () => { result.current.onReachLeftEdge() })
    expect(rec.calls).toHaveLength(2)
    expect(rec.calls[1]!.before).toBe(tail)
    await act(async () => { rec.calls[1]!.d.reject(new Error('upstream hiccup')) })
    await waitFor(() => expect(result.current.edge).toEqual({ phase: 'error' }))

    // Then 立即显式 reprobe（0ms 间隔）不被「60s 冷却」拦下：发出新请求并最终前插成功
    await act(async () => { result.current.onHistoryEdgeAction() })
    expect(rec.calls).toHaveLength(3)
    expect(rec.calls[2]!.before).toBe(tail)
    const earlier = tail - KLINE_PAGE_SIZE_DAILY * DAY
    await act(async () => { rec.calls[2]!.d.resolve(page(bars(earlier, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines?.[0]?.openTime).toBe(earlier)
  })

  it('用户 数据源窗口耗尽（短页）进 terminated 后 30s resync 不得清除粘性', async () => {
    // Given 首屏尾部返回**不足一页**（< 页大小）→ 运行时探测判为窗口耗尽 → terminated(source)
    const rec = makeRecorder()
    const { result } = renderHook(() => useWith({ market: 'hk', symbol: '00700', interval: '1d' }, rec))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(1_000_000 * DAY, 100))) })
    await waitFor(() => expect(result.current.edge).toEqual({ phase: 'terminated', terminalReason: 'source' }))
    const callsBefore = rec.calls.length

    // When 尾部 resync（visibilitychange）触发一次尾部窗口取数
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rec.calls.length).toBe(callsBefore + 1) // 尾部窗口重取（非前插）
    await act(async () => { rec.calls[callsBefore]!.d.resolve(page(bars(1_000_000 * DAY, 100))) })

    // Then 粘性保持 terminated(source)：resync 不得把它洗回 ready
    expect(result.current.edge).toEqual({ phase: 'terminated', terminalReason: 'source' })
    // 且不因 resync 自动追加「更早一页」请求（无 before 的新请求）
    expect(rec.calls.length).toBe(callsBefore + 1)
  })

  it('用户 终止后 60s 冷却内显式 reprobe 为 no-op 不新增上游请求', async () => {
    // Given 已进 terminated(source)
    const rec = makeRecorder()
    const { result } = renderHook(() => useWith({ market: 'hk', symbol: '00700', interval: '1d' }, rec))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(1_000_000 * DAY, 100))) })
    await waitFor(() => expect(result.current.edge?.phase).toBe('terminated'))
    const callsBefore = rec.calls.length

    // When 立即显式 reprobe（距 terminatedAt 约 0ms，< 60000ms）
    await act(async () => { result.current.onHistoryEdgeAction() })

    // Then 冷却未过 → 仍 terminated 且未发任何请求
    expect(result.current.edge).toEqual({ phase: 'terminated', terminalReason: 'source' })
    expect(rec.calls.length).toBe(callsBefore)
  })

  it('用户 桥闸拒绝码 TRADING_KLINE_HISTORY_UNSUPPORTED 使状态机进 unsupported 且粘性不被 resync 清除', async () => {
    // Given 首屏尾部满页就绪
    const rec = makeRecorder()
    const { result } = renderHook(() => useWith({ market: 'hk', symbol: '00700', interval: '1d' }, rec))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    const tail = 2_000_000 * DAY
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())

    // When 左缘前插被桥层 fail-closed 拒绝（能力缺失错误码）
    await act(async () => { result.current.onReachLeftEdge() })
    expect(rec.calls).toHaveLength(2)
    await act(async () => { rec.calls[1]!.d.reject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' }) })

    // Then 进 unsupported；未拖到左缘前不显形（edge 为 null）
    await waitFor(() => expect(result.current.edge).toBeNull())
    const callsBefore = rec.calls.length
    // When 再来一次 resync：尾部窗口返回的能力**仍为不支持**（与 unsupported 一致，不构成能力变化）
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { rec.calls[callsBefore]!.d.resolve(pageNoEarlier(bars(tail, KLINE_PAGE_SIZE_DAILY))) })
    // Then 能力未变 → 粘性 unsupported 未被 resync 洗成 ready（仍不显形）
    expect(result.current.edge).toBeNull()
    // 用户真正拖到左缘后方显形 unsupported，且不再发请求
    await act(async () => { result.current.onReachLeftEdge() })
    expect(result.current.edge).toEqual({ phase: 'unsupported' })
    expect(rec.calls.length).toBe(callsBefore + 1)
  })

  it('用户 尾部 resync 在途时左缘前插并发 两个响应都被应用且不卡 loading', async () => {
    // Given 首屏尾部满页就绪
    const rec = makeRecorder()
    const { result } = renderHook(() => useWith({ market: 'hk', symbol: '00700', interval: '1d' }, rec))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    const tail = 2_000_000 * DAY
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())

    // When 先触发一次尾部 resync（在途），再触发左缘前插（并发在途）
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rec.calls).toHaveLength(2)
    await act(async () => { result.current.onReachLeftEdge() })
    expect(rec.calls).toHaveLength(3)
    expect(rec.calls[2]!.before).toBe(tail)
    expect(result.current.edge).toEqual({ phase: 'loading' })

    // Then 两个响应（尾部 resync 先到、前插后到）都被应用，状态机回到 ready
    await act(async () => { rec.calls[1]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DAILY))) })
    const earlier = tail - KLINE_PAGE_SIZE_DAILY * DAY
    await act(async () => { rec.calls[2]!.d.resolve(page(bars(earlier, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines).toHaveLength(KLINE_PAGE_SIZE_DAILY * 2)
    expect(result.current.klines?.[0]?.openTime).toBe(earlier)
    expect(result.current.klines?.[result.current.klines.length - 1]?.openTime).toBe(tail + (KLINE_PAGE_SIZE_DAILY - 1) * DAY)
  })

  it('用户 换标的后 terminated 粘性被 reset 全清并重发尾部请求', async () => {
    // Given 以 hk/00700 进 terminated(source)（短页）
    const rec = makeRecorder()
    const { result, rerender } = renderHook(
      (props: Props) => useWith(props, rec),
      { initialProps: { market: 'hk' as MarketId, symbol: '00700', interval: '1d' } },
    )
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(1_000_000 * DAY, 100))) })
    await waitFor(() => expect(result.current.edge?.phase).toBe('terminated'))

    // When 换到 us/AAPL
    rerender({ market: 'us' as MarketId, symbol: 'AAPL', interval: '1d' })
    await waitFor(() => expect(rec.calls).toHaveLength(2))

    // Then reset 后本地序列清空、终止粘性清除（尚未就绪前 edge 为 null）
    expect(result.current.klines).toBeNull()
    expect(result.current.edge).toBeNull()
    // 新标的尾部响应到达 → 正常就绪
    const usStart = 3_000_000 * DAY
    await act(async () => { rec.calls[1]!.d.resolve(page(bars(usStart, KLINE_PAGE_SIZE_DAILY))) })
    await waitFor(() => expect(result.current.edge).toBeNull())
    expect(result.current.klines?.[0]?.openTime).toBe(usStart)
  })

  it('运营 分页页大小经注入缝实测：日线恒 750（hk/crypto 一致） crypto 非日线 300', async () => {
    // Given 以 hk/1d 挂载，捕获首个分页请求的 limit
    const rec = makeRecorder()
    const { rerender } = renderHook(
      (props: Props) => useWith(props, rec),
      { initialProps: { market: 'hk' as MarketId, symbol: '00700', interval: '1d' } },
    )
    await waitFor(() => expect(rec.calls).toHaveLength(1))

    // When 日线（hk）→ 日线（crypto）→ crypto 小时线 依次换周期
    expect(rec.calls[0]!.limit).toBe(KLINE_PAGE_SIZE_DAILY)
    rerender({ market: 'crypto' as MarketId, symbol: 'BTCUSDT', interval: '1d' })
    await waitFor(() => expect(rec.calls).toHaveLength(2))
    rerender({ market: 'crypto' as MarketId, symbol: 'BTCUSDT', interval: '1h' })
    await waitFor(() => expect(rec.calls).toHaveLength(3))

    // Then 日线覆盖市场表恒 750；非日线走 crypto 市场表 300（页大小单一出口的运行时证据）
    expect(rec.calls[1]!.limit).toBe(KLINE_PAGE_SIZE_DAILY)
    expect(rec.calls[2]!.limit).toBe(300)
  })
})
