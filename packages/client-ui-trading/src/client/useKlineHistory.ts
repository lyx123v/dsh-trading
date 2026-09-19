/**
 * 左缘惰性历史分页的 React 接线（2026-09-19，N3）。
 *
 * 职责：
 * - `dataKey`（`market:symbol:interval`）变化 → 状态机 `reset`（游标 / 页列表 / 终止态全清，R4）；
 * - 三类请求：**初始**（首次尾部窗口，establish 游标与能力）、**resync**（30s 尾部窗口合并，
 *   不清粘性、不累加计数）、**更早一页**（`before = oldestOpenTime`，前插合并 + `onPrepend`）；
 * - 竞态守卫（`generationRef`：**仅换数据键**才使在途响应失效；同 key 的 resync 与前插互不作废）；
 * - 左缘触发 `onReachLeftEdge`（单飞 + 冷却 + 游标去重 + 页面可见，全部交给 `shouldRequestEarlier`）；
 * - 终止态受控重试 `onHistoryEdgeAction`（≥60s 冷却，Q1）；
 * - ticker 尾部合并 `applyTailTicker`（与原 `QuoteStage.withTickerBar` 同口径，收敛到单一实现）。
 *
 * 全部原始逻辑落在纯模块 `kline-history.ts` / `chart-viewport.ts`，本 hook 只做时序与竞态。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchKlinesPage } from './api.ts'
import type { KlinePage } from './api.ts'
import { detectHeadChange } from './chart-viewport.ts'
import {
  initialKlineHistoryState,
  klineHistoryKey,
  klinePageSize,
  mergeKlines,
  reduceKlineHistory,
  shouldRequestEarlier,
} from './kline-history.ts'
import type { KlineHistoryEdge, KlineHistoryEvent, KlineHistoryState } from './kline-history.ts'
import type { Kline, MarketId, Ticker } from './types.ts'

/** 尾部窗口重取（resync）节奏：与既有 K 线轮询一致（Q10 同一口径）。 */
export const KLINE_RESYNC_MS = 30000

/**
 * 取数函数签名（= `fetchKlinesPage`）。作为可选注入缝暴露，**仅供测试**在零 mock
 * 约束下用受控 deferred 复现「resync × 前插」竞态；生产恒用默认 `fetchKlinesPage`。
 */
export type FetchKlinePage = (
  market: MarketId,
  symbol: string,
  interval: string,
  limit: number,
  before?: number,
) => Promise<KlinePage>

export interface UseKlineHistoryOptions {
  market: MarketId | undefined
  symbol: string | undefined
  interval: string
  /** 前插 k 根后的回调（**同一 React 批次**内位移 hoverIndex / rangeSelection，R-3/P3）。 */
  onPrepend?: ((prependCount: number) => void) | undefined
  /** 取数注入缝（缺省 = `fetchKlinesPage`）。**仅供测试注入**，生产不传。 */
  fetchPage?: FetchKlinePage | undefined
}

export interface UseKlineHistoryResult {
  /** 当前序列（并集 + `openTime` 去重 + 升序）；null = 尚未加载。 */
  klines: Kline[] | null
  /** 初始 / resync 取数失败信息（更早页失败表现为 `edge.phase === 'error'`，不占本字段）。 */
  error: string | null
  /** 左缘状态（null = 不渲染任何左缘元素）。 */
  edge: KlineHistoryEdge | null
  /** 视窗进入左缘阈值区时调用（TvChart 左缘回调入口）。 */
  onReachLeftEdge: () => void
  /** 用户对左缘状态元素的显式动作（重试 / 重新检查更早历史；受 60s 冷却约束）。 */
  onHistoryEdgeAction: () => void
  /** ticker 尾部合并（修订最后一根的收/高/低，不改变数组长度 → 不触发视窗补偿）。 */
  applyTailTicker: (ticker: Ticker) => void
}

/** 状态相 → 左缘视图态（idle / ready 无需渲染 → null）。 */
function edgeOf(state: KlineHistoryState): KlineHistoryEdge | null {
  if (state.phase === 'loading') return { phase: 'loading' }
  if (state.phase === 'error') return { phase: 'error' }
  if (state.phase === 'unsupported') return state.noticed ? { phase: 'unsupported' } : null
  if (state.phase === 'terminated') {
    return state.terminatedReason === 'cap'
      ? { phase: 'terminated', terminalReason: 'cap' }
      : { phase: 'terminated', terminalReason: 'source' }
  }
  return null
}

/** 尾部 ticker 修订最后一根（原 `withTickerBar` 的同口径实现）。 */
function mergeTailTickerBar(prev: readonly Kline[], ticker: Ticker): Kline[] {
  const last = prev[prev.length - 1]
  if (last === undefined) return prev as Kline[]
  const price = ticker.price
  if (!Number.isFinite(price) || price <= 0) return prev as Kline[]
  if (last.close === price && last.high >= price && last.low <= price) return prev as Kline[]
  const merged: Kline = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  }
  return [...prev.slice(0, -1), merged]
}

export function useKlineHistory(options: UseKlineHistoryOptions): UseKlineHistoryResult {
  const { market, symbol, interval } = options
  const onPrependRef = useRef(options.onPrepend)
  onPrependRef.current = options.onPrepend

  const key = market !== undefined && symbol !== undefined ? klineHistoryKey(market, symbol, interval) : ''

  const [klines, setKlines] = useState<Kline[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edge, setEdge] = useState<KlineHistoryEdge | null>(null)

  const stateRef = useRef<KlineHistoryState>(initialKlineHistoryState(key))
  /** 最新序列镜像（供异步取数回调读取，规避闭包陈旧）。 */
  const klinesRef = useRef<Kline[] | null>(null)
  klinesRef.current = klines
  /** 取数函数（默认 `fetchKlinesPage`；注入缝仅供测试替换，保持引用稳定故经 ref 读取）。 */
  const fetchPageRef = useRef<FetchKlinePage>(options.fetchPage ?? fetchKlinesPage)
  fetchPageRef.current = options.fetchPage ?? fetchKlinesPage

  /**
   * 竞态守卫（2026-09-19 QA 缺陷修复：resync × 前插竞态致分页永久卡 loading）。
   *
   * 旧实现用「key + 游标」单槽 token：同一 `dataKey` 下，resync 的 `load()` 会覆盖
   * 「更早一页」的 token，使在途分页响应命中 `token !== request` 而被静默丢弃——
   * 既不派发 `pageOk` 也不派发 `pageFailed`，`inflight` 永久为真、状态机卡 `loading`，
   * 此后 `reprobe` 亦为 no-op，只能换标的 / 换周期才恢复。
   *
   * 新语义：**唯有「换数据键」才使在途响应失效**。同一 key 下的并发（resync 与分页）
   * 互不作废——每个分页响应最终都会派发 `pageOk` / `pageFailed` 释放单飞闸。
   * 用单调递增的 `generation` 表达「第几代数据键」：`reset`（换键）即 +1，在途响应按代比对。
   */
  const generationRef = useRef(0)
  /** 当前 key 的渲染期镜像：兜住「换键已提交、reset effect 尚未跑」的极小窗口。 */
  const keyRef = useRef(key)
  keyRef.current = key

  /** 把 ref 里的状态相派生为 edge，仅在真正变化时 setState（省重渲染、保 memo 稳定）。 */
  const commit = useCallback((): void => {
    setEdge(prev => {
      const next = edgeOf(stateRef.current)
      if (prev === null && next === null) return prev
      if (prev !== null && next !== null && prev.phase === next.phase && prev.terminalReason === next.terminalReason) return prev
      return next
    })
  }, [])

  const dispatch = useCallback((event: KlineHistoryEvent): void => {
    stateRef.current = reduceKlineHistory(stateRef.current, event)
    commit()
  }, [commit])

  /**
   * 取数。`before` 缺省 = 尾部窗口（初始 / resync）；给定时 = 更早一页。
   * 尾部窗口**只在首次**（`oldestOpenTime` 尚未建立）派发 `pageOk`——用于建立游标与计数；
   * 之后每次 resync 只合并 + 刷新能力，**不派发 pageOk**（否则 `loadedCount` 每 30s 虚增，
   * 会误触 `MAX_LOADED_BARS` 上限陷阱）。
   */
  const load = useCallback(async (before?: number): Promise<void> => {
    if (market === undefined || symbol === undefined) return
    const pageSize = klinePageSize(market, interval)
    // 请求发出时的「数据键世代」与 key 快照（见 generationRef 说明）。
    const generation = generationRef.current
    const requestKey = key
    const isEarlier = before !== undefined
    if (isEarlier) dispatch({ type: 'requestStarted', cursor: before, at: Date.now() })
    try {
      const page = await fetchPageRef.current(market, symbol, interval, pageSize, before)
      // 竞态守卫：仅「换数据键」后丢弃在途响应（同 key 的 resync 与前插互不作废）。
      if (generationRef.current !== generation || keyRef.current !== requestKey) return
      if (isEarlier) {
        const prev = klinesRef.current ?? []
        const merged = mergeKlines(prev, page.klines)
        setKlines(merged)
        // 补偿量 = 头部前插根数（detectHeadChange 精确给出；**禁止**用长度差，R-1）。
        // 注意：Kline 的时间字段是 openTime，chart-viewport 只认 time，故先做最小映射。
        const change = detectHeadChange(
          prev.map(k => ({ time: k.openTime })),
          merged.map(k => ({ time: k.openTime })),
        )
        if (change.kind === 'prepend' && change.prependCount > 0) onPrependRef.current?.(change.prependCount)
      } else {
        setError(null)
        setKlines(prev => mergeKlines(prev ?? [], page.klines))
      }
      // 能力只在「provider 或 supportsEarlier 变化」或首屏（idle）时重判 —— Q1：resync 不清粘性。
      const current = stateRef.current
      if (current.phase === 'idle' || current.supportsEarlier !== page.history.supportsEarlier || current.provider !== page.history.provider) {
        dispatch({
          type: 'capability',
          key,
          supportsEarlier: page.history.supportsEarlier,
          ...(page.history.provider !== undefined ? { provider: page.history.provider } : {}),
        })
      }
      if (isEarlier) {
        dispatch({ type: 'pageOk', rows: page.klines, pageSize, at: Date.now() })
      } else if (stateRef.current.supportsEarlier && stateRef.current.oldestOpenTime === undefined) {
        // 首次尾部窗口：建立游标 + 计数（仅此一次；resync 不再进入）。
        dispatch({ type: 'pageOk', rows: page.klines, pageSize, at: Date.now() })
      }
    } catch (caught) {
      if (generationRef.current !== generation || keyRef.current !== requestKey) return
      const code = (caught as { code?: string } | null)?.code
      if (isEarlier) {
        dispatch({ type: 'pageFailed', ...(code !== undefined ? { code } : {}), at: Date.now() })
      } else {
        setError(String((caught as { message?: string } | null)?.message ?? caught))
      }
    }
  }, [market, symbol, interval, key, dispatch])

  // dataKey 变化 → 状态机 reset（游标 / 页列表 / 终止态全清）+ 本地 state 清场 + 换代。
  // 声明在 poll effect 之前：同一提交里 reset 先跑，紧随的 poll 立即 tick 方拿到干净初态。
  useEffect(() => {
    generationRef.current += 1
    stateRef.current = initialKlineHistoryState(key)
    klinesRef.current = null
    setKlines(null)
    setError(null)
    setEdge(null)
  }, [key])

  // 尾部窗口 poll：挂载 / 换标的 / 换周期立即触发，此后每 30s resync（隐藏页不发，usePoll 礼仪）。
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = (): void => {
      // 分页在途时不并发 resync：既避免与「更早一页」争用守卫、也减少无谓上游调用。
      if (document.visibilityState === 'visible' && !stateRef.current.inflight) void load()
    }
    tick()
    timer = setInterval(tick, KLINE_RESYNC_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const onReachLeftEdge = useCallback((): void => {
    const now = Date.now()
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible'
    // 先记录「用户确实拖到过左缘」（unsupported 的显形门，PRD §5.4）。
    stateRef.current = reduceKlineHistory(stateRef.current, { type: 'edge' })
    commit()
    if (!shouldRequestEarlier(stateRef.current, now, visible)) return
    const cursor = stateRef.current.oldestOpenTime
    if (cursor === undefined) return
    void load(cursor)
  }, [commit, load])

  const onHistoryEdgeAction = useCallback((): void => {
    // 进入时已在 loading（有在途分页请求）→ 既不 reprobe 也不 load：reprobe 在 loading 相为
    // no-op，若继续向下会误判「reprobe 生效」而再发一次 load，形成双发（F2）。快照调用前的相。
    if (stateRef.current.phase === 'loading') return
    stateRef.current = reduceKlineHistory(stateRef.current, { type: 'reprobe', at: Date.now() })
    commit()
    // reprobe 推进条件（见 kline-history.ts）：仅 `terminated`（距 terminatedAt ≥ 60s 冷却）
    // 或 `error` → 推进到 `loading`；`idle`/`ready`/`unsupported` 均为 no-op。
    // 故此处按**推进后**的相判断：为 loading 才续拉更早一页（合法路径：terminated/error → load）。
    if (stateRef.current.phase !== 'loading') return
    const cursor = stateRef.current.oldestOpenTime
    if (cursor === undefined) return
    void load(cursor)
  }, [commit, load])

  const applyTailTicker = useCallback((ticker: Ticker): void => {
    setKlines(prev => (prev === null || prev.length === 0 ? prev : mergeTailTickerBar(prev, ticker)))
  }, [])

  return { klines, error, edge, onReachLeftEdge, onHistoryEdgeAction, applyTailTicker }
}
