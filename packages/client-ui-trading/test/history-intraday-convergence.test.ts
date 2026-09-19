/**
 * @vitest-environment jsdom
 *
 * 盘中周期（5m）左缘分页的**收敛性实测** + `maxPageSize` 缺省下的客户端页大小（2026-09-19 第二轮；
 * F1 修复后更新为「落粘性 unsupported」口径）。
 *
 * 回答两个具体问题（零 mock：手写受控 deferred + `renderHook`）：
 * - 腾讯/东财 **分钟线** 能力是 provider 级布尔（声明 `supportsEarlier: true`），但带 `before`
 *   的分钟请求会被连接器抛 `TRADING_NOT_IMPLEMENTED`（见 connector-tencent/rest.ts:653、
 *   connector-eastmoney/rest.ts:288）→ 客户端落**粘性 unsupported**（诚实示明「此源此周期能力
 *   不足」，由 KLINE_HISTORY_UNSUPPORTED_CODES 统一裁决），而非可重试 error；resync 不清除、
 *   反复拖左缘**不自动重发**（实测请求次数）。
 * - `maxPageSize` 缺省（东财故意不声明）是否影响客户端下行请求的 `limit`？
 *
 * 合规：零 `vi.*` / 零 `setTimeout` / 零 sleep；叶标题角色词起头；叶含 Given/When/Then；每叶 ≥1 expect。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { KlinePage } from '../src/client/api.ts'
import { KLINE_PAGE_SIZE_BY_MARKET, KLINE_PAGE_SIZE_DAILY, KLINE_PAGE_SIZE_DEFAULT } from '../src/client/kline-history.ts'
import type { Kline, MarketId } from '../src/client/types.ts'
import { useKlineHistory } from '../src/client/useKlineHistory.ts'
import type { FetchKlinePage } from '../src/client/useKlineHistory.ts'

afterEach(cleanup)

const DAY = 86_400_000
const MIN5 = 5 * 60_000

/** 一根 K 线（步长可配，便于分钟周期）。 */
function bar(openTime: number, step = DAY): Kline {
  return { openTime, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1000, closeTime: openTime + step }
}

/** `[start, start+count*step)` 连续 K 线。 */
function bars(start: number, count: number, step = DAY): Kline[] {
  const out: Kline[] = []
  for (let i = 0; i < count; i += 1) out.push(bar(start + i * step, step))
  return out
}

/** 声明支持更早历史的一页。 */
function page(rows: Kline[]): KlinePage {
  return { klines: rows, history: { supportsEarlier: true } }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error?: unknown) => void
}

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

function makeRecorder(): Recorder {
  const calls: Call[] = []
  const fetchPage: FetchKlinePage = (_market, _symbol, _interval, limit, before) => {
    const d = deferred<KlinePage>()
    calls.push({ limit, before, d })
    return d.promise
  }
  return { fetchPage, calls }
}

interface Props { market: MarketId; symbol: string; interval: string }

describe('盘中周期左缘分页收敛性 + maxPageSize 缺省（Q3/Q4 实测）', () => {
  it('用户 盘中周期前插遇 TRADING_NOT_IMPLEMENTED 落粘性 unsupported（非 error）且 resync 不清除', async () => {
    // Given cn/5m 首屏尾部满页就绪（页大小 = 500；能力声明 true）
    const rec = makeRecorder()
    const { result } = renderHook(() => useKlineHistory({ market: 'cn' as MarketId, symbol: '600519', interval: '5m', fetchPage: rec.fetchPage }))
    await waitFor(() => expect(rec.calls).toHaveLength(1))
    expect(rec.calls[0]!.limit).toBe(KLINE_PAGE_SIZE_DEFAULT) // cn 非日线 → 500
    const tail = 2_000_000 * MIN5
    await act(async () => { rec.calls[0]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DEFAULT, MIN5))) })
    await waitFor(() => expect(result.current.edge).toBeNull())

    // When 拖到左缘触发前插，上游按分钟未实现抛 TRADING_NOT_IMPLEMENTED（pageFailed）
    await act(async () => { result.current.onReachLeftEdge() })
    expect(rec.calls).toHaveLength(2)
    expect(rec.calls[1]!.before).toBe(tail)
    await act(async () => { rec.calls[1]!.d.reject({ code: 'TRADING_NOT_IMPLEMENTED' }) })

    // Then 落**粘性 unsupported** —— **不是**可重试 error：error 会立即显形 {phase:'error'}；
    // 此处与桥闸拒绝码**同一归宿**（沿用既有 `noticed` 显形门，未再触达左缘前为 null）
    expect(result.current.edge).toBeNull()

    // And 用户再次触达左缘 → 显形为 unsupported（证明状态是 unsupported 而非 error），且不新增请求
    await act(async () => { result.current.onReachLeftEdge() })
    expect(result.current.edge).toEqual({ phase: 'unsupported' })
    expect(rec.calls).toHaveLength(2)

    // And resync（尾部窗口，visibilitychange 触发）发 1 次尾部请求，但**不清除** unsupported 粘性
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rec.calls).toHaveLength(3)
    await act(async () => { rec.calls[2]!.d.resolve(page(bars(tail, KLINE_PAGE_SIZE_DEFAULT, MIN5))) })
    await waitFor(() => expect(result.current.edge).toEqual({ phase: 'unsupported' }))

    // And unsupported 下「重新检查」为 no-op（reprobe 仅 terminated/error 生效）→ 0 次增量
    await act(async () => { result.current.onHistoryEdgeAction() })
    expect(rec.calls).toHaveLength(3)
  })

  it('运营 连接器不声明 maxPageSize 时客户端仍按本地固定页大小下行 limit（逐组合）', async () => {
    // Given cn/600519 以日线挂载，捕获分页请求 limit
    const rec = makeRecorder()
    const { rerender } = renderHook(
      (props: Props) => useKlineHistory({ ...props, fetchPage: rec.fetchPage }),
      { initialProps: { market: 'cn' as MarketId, symbol: '600519', interval: '1d' } },
    )
    await waitFor(() => expect(rec.calls).toHaveLength(1))

    // When 依次切：cn 日线 → cn 5m → crypto 1h
    expect(rec.calls[0]!.limit).toBe(KLINE_PAGE_SIZE_DAILY) // 日线恒 750（与 provider/provider 的 maxPageSize 无关）
    rerender({ market: 'cn' as MarketId, symbol: '600519', interval: '5m' })
    await waitFor(() => expect(rec.calls).toHaveLength(2))
    rerender({ market: 'crypto' as MarketId, symbol: 'BTCUSDT', interval: '1h' })
    await waitFor(() => expect(rec.calls).toHaveLength(3))

    // Then 客户端 limit 只由 market×interval 决定（东财不声明 maxPageSize 不影响下行）
    expect(rec.calls[1]!.limit).toBe(KLINE_PAGE_SIZE_DEFAULT) // 非日线非 crypto → 500
    expect(rec.calls[2]!.limit).toBe(KLINE_PAGE_SIZE_BY_MARKET.crypto) // crypto 非日线 → 300
  })
})
