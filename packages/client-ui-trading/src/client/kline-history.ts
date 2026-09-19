/**
 * K 线历史惰性分页的**领域纯逻辑**（零 React、零 DOM、零第三方依赖，2026-09-19）。
 *
 * 职责边界：
 * - 页大小 / 阈值 / 冷却 / 上限**常量**的唯一家（「一个数字只有一个家」）；
 * - 分页状态机（`reduce` 纯函数，可枚举验证，无需 mock）；
 * - 单一请求放行判据 `shouldRequestEarlier`（单飞 + 冷却 + 游标去重 + 页面可见）；
 * - 页面结果判据与序列合并（并集 + `openTime` 去重 + 升序）。
 *
 * 非职责：图表视窗（见 chart-viewport.ts）、React 接线（见 useKlineHistory.ts）、
 * 网络取数（见 api.ts）。本模块只做「算」，把时间戳与可见性**当参数传入**，
 * 因而测试无需任何 fake timers（项目测试棘轮禁 setTimeout/sleep）。
 */
import type { Kline, MarketId } from './types.ts'

/* ── 常量：全部数字的唯一家（一个数字只有一个家）────────────────── */

/** 非 crypto 盘中周期的页大小（沿用现状 QuoteStage 的 KLINE_LIMIT_DEFAULT）。 */
export const KLINE_PAGE_SIZE_DEFAULT = 500

/**
 * 按市场覆盖的页大小。crypto=300：OKX 单请求上限 300，**300 不触发连接器内部翻页**，
 * 30s resync 的上游调用数不放大（既有已定口径）。
 */
export const KLINE_PAGE_SIZE_BY_MARKET: Partial<Record<MarketId, number>> = { crypto: 300 }

/** 日线页大小（≈三年交易日）。 */
export const KLINE_PAGE_SIZE_DAILY = 750

/**
 * 会话内已加载根数硬上限（Q5 上限保护）：超限进 `terminated(reason='cap')` 并**停止
 * 继续往早**。不淘汰早期页，保持回溯连续性；提示文案区分于「已到达最早历史」。
 */
export const MAX_LOADED_BARS = 12000

/** 左缘触发阈值（逻辑根数，与缩放无关）。 */
export const LEFT_EDGE_TRIGGER_BARS = 10

/** 分页请求冷却（单飞之外的第二道闸：请求速率硬上限 ≤1 req/s）。 */
export const PAGE_REQUEST_COOLDOWN_MS = 1000

/** 终止后受控重试冷却（用户显式 `reprobe`，60s 内最多一次，不放大上游消耗）。 */
export const EXHAUSTED_REPROBE_COOLDOWN_MS = 60000

/**
 * 「能力缺失」失败码集合：`pageFailed` 命中即进**粘性 `unsupported`**（诚实示明「此数据源
 * / 此周期不具备更早历史」），**不**落入可重试的 `error`：
 * - `TRADING_KLINE_HISTORY_UNSUPPORTED`：桥闸 fail-closed 拒绝（实现方未声明往早能力）；
 * - `TRADING_NOT_IMPLEMENTED`：实现方**声明**支持（`getKlineHistoryCapability` 是 provider 级
 *   单布尔）但该请求未实现——典型如 tencent / eastmoney 的**分钟线**带 `before`（桥按布尔放行、
 *   连接器才抛 `TRADING_NOT_IMPLEMENTED`）。语义同属「此源此周期能力不足」，与桥闸拒绝同归宿。
 */
export const KLINE_HISTORY_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'TRADING_KLINE_HISTORY_UNSUPPORTED',
  'TRADING_NOT_IMPLEMENTED',
])

/**
 * 页大小：分页请求（更早一页）与 30s resync（尾部窗口）**共用同一函数**
 * （Q10 同一口径，杜绝两套数字漂移）。**它是页大小的唯一出口**——其它位置不得再
 * 出现这些数字。日线走 `KLINE_PAGE_SIZE_DAILY`，否则走按市场表 / 默认值。
 */
export function klinePageSize(market: MarketId, interval: string): number {
  if (interval === '1d') return KLINE_PAGE_SIZE_DAILY
  return KLINE_PAGE_SIZE_BY_MARKET[market] ?? KLINE_PAGE_SIZE_DEFAULT
}

/** dataKey（= 分页游标重置锚点，与 TvChartProps.dataKey 同构：`market:symbol:interval`）。 */
export function klineHistoryKey(market: MarketId, symbol: string, interval: string): string {
  return `${market}:${symbol}:${interval}`
}

/* ── 状态机 ─────────────────────────────────────────────────────── */

/**
 * 分页状态相。可选值语义：
 * - `idle`        首屏尚未拿到能力（不渲染任何左缘元素）；
 * - `ready`       可翻页 · 空闲；
 * - `loading`     加载中（单飞中）；
 * - `terminated`  终止（数据源窗口耗尽 / 会话上限，见 terminatedReason）；
 * - `unsupported` 当前源不支持更早历史（能力缺失，不发请求）；
 * - `error`       失败可重试（已加载历史保留）。
 */
export type KlineHistoryPhase = 'idle' | 'ready' | 'loading' | 'terminated' | 'unsupported' | 'error'

/**
 * 左缘分页的 **UI 视图态**（hook 从 `KlineHistoryState` 派生；`TvChart` 仅消费呈现）。
 * 只在需要显示左缘元素时非 null（`idle` / `ready` → hook 回 `null`，不渲染任何东西）。
 */
export interface KlineHistoryEdge {
  readonly phase: 'loading' | 'terminated' | 'unsupported' | 'error'
  /** terminated 的成因：source = 数据源窗口耗尽；cap = 会话上限保护。 */
  readonly terminalReason?: 'source' | 'cap'
}

export interface KlineHistoryState {
  readonly key: string
  readonly phase: KlineHistoryPhase
  /** terminated 的成因：source = 数据源窗口耗尽；cap = 会话上限保护。 */
  readonly terminatedReason?: 'source' | 'cap'
  readonly failureCode?: string
  /** 当前已加载序列里最旧一根的 openTime（= 下次分页游标 before）。 */
  readonly oldestOpenTime?: number
  /** 会话内累计加载根数（上限保护依据）。 */
  readonly loadedCount: number
  /** 是否有在途分页请求（单飞闸）。 */
  readonly inflight: boolean
  readonly supportsEarlier: boolean
  readonly provider?: string
  /** 用户是否已真正拖到过左缘（unsupported 的显形门）。 */
  readonly noticed: boolean
  readonly lastRequestAt: number
  /** 上一次已发出的分页游标（游标去重闸）。 */
  readonly lastRequestedCursor?: number
  readonly terminatedAt?: number
}

export type KlineHistoryEvent =
  | { type: 'reset'; key: string }
  | { type: 'capability'; key: string; supportsEarlier: boolean; provider?: string }
  | { type: 'edge' }
  | { type: 'requestStarted'; cursor: number; at: number }
  | { type: 'pageOk'; rows: readonly Kline[]; pageSize: number; at: number }
  | { type: 'pageTerminated'; reason: 'source' | 'cap'; at: number }
  | { type: 'pageFailed'; code?: string; at: number }
  | { type: 'reprobe'; at: number }

/** 首屏状态：`idle`，游标/页列表/终止态全空。 */
export function initialKlineHistoryState(key: string): KlineHistoryState {
  return {
    key,
    phase: 'idle',
    loadedCount: 0,
    inflight: false,
    supportsEarlier: false,
    noticed: false,
    lastRequestAt: 0,
  }
}

/**
 * 复制状态但丢弃终止/失败粘性字段（terminatedReason / failureCode / terminatedAt）。
 * 用显式字段构造（而非解构省略）以适配 `exactOptionalPropertyTypes`。
 */
function withoutSticky(s: KlineHistoryState): KlineHistoryState {
  return {
    key: s.key,
    phase: s.phase,
    loadedCount: s.loadedCount,
    inflight: s.inflight,
    supportsEarlier: s.supportsEarlier,
    noticed: s.noticed,
    lastRequestAt: s.lastRequestAt,
    ...(s.oldestOpenTime !== undefined ? { oldestOpenTime: s.oldestOpenTime } : {}),
    ...(s.lastRequestedCursor !== undefined ? { lastRequestedCursor: s.lastRequestedCursor } : {}),
    ...(s.provider !== undefined ? { provider: s.provider } : {}),
  }
}

/**
 * 分页状态机归约（§2.6 转移表）。
 *
 * 粘性语义（Q1）：`terminated` / `unsupported` **不因 resync 清除**；仅由
 * ①`reset`（`dataKey` 变化）②`capability`（provider 或 supportsEarlier 变化）
 * ③用户显式 `reprobe`（≥60s 冷却）解除。
 *
 * 纯函数：请求放行/冷却/可见性判据由 `shouldRequestEarlier` 在 hook 侧完成，
 * 本函数只接收已达成的 `requestStarted` 等事件并推进状态。
 */
export function reduceKlineHistory(s: KlineHistoryState, e: KlineHistoryEvent): KlineHistoryState {
  switch (e.type) {
    case 'reset': {
      // dataKey 变化：游标 / 页列表 / 终止态全清（R4）。
      return initialKlineHistoryState(e.key)
    }
    case 'capability': {
      if (e.key !== s.key) return s // 迟到事件（reset 已换 key）→ 丢弃
      const core = withoutSticky(s)
      const providerOverride = e.provider !== undefined ? { provider: e.provider } : {}
      if (!e.supportsEarlier) {
        // 声明不支持：能力缺失，桥层 fail-closed；此处进 unsupported（粘性）。
        return { ...core, ...providerOverride, phase: 'unsupported', supportsEarlier: false, inflight: false }
      }
      // 声明支持：清 terminated/unsupported 粘性并重新判定（R3③ 切 provider 正确刷新）。
      const revives = s.phase === 'idle' || s.phase === 'terminated' || s.phase === 'unsupported'
      return { ...core, ...providerOverride, phase: revives ? 'ready' : s.phase, supportsEarlier: true }
    }
    case 'edge': {
      // unsupported 的显形门：用户确实拖到过左缘才显形（PRD §5.4）；不发请求。
      if (s.phase === 'unsupported') return { ...s, noticed: true }
      // 其余态的请求放行由 shouldRequestEarlier 裁决，reducer 不越权改相。
      return s
    }
    case 'requestStarted': {
      return {
        ...withoutSticky(s),
        phase: 'loading',
        inflight: true,
        lastRequestAt: e.at,
        lastRequestedCursor: e.cursor,
      }
    }
    case 'pageOk': {
      let oldest = s.oldestOpenTime
      for (const row of e.rows) {
        if (oldest === undefined || row.openTime < oldest) oldest = row.openTime
      }
      const loadedCount = s.loadedCount + e.rows.length
      const next: KlineHistoryState = {
        ...withoutSticky(s),
        phase: 'ready',
        inflight: false,
        loadedCount,
        ...(oldest !== undefined ? { oldestOpenTime: oldest } : {}),
      }
      // 不足一页（含 0）⇒ 数据源窗口耗尽（运行时探测 = 终止态真相源）。
      if (classifyPageOutcome(e.rows, e.pageSize) === 'exhausted') {
        return { ...next, phase: 'terminated', terminatedReason: 'source', terminatedAt: e.at }
      }
      // 满页但已达会话上限 ⇒ terminated(cap)，停止继续往早。
      if (loadedCount >= MAX_LOADED_BARS) {
        return { ...next, phase: 'terminated', terminatedReason: 'cap', terminatedAt: e.at }
      }
      return next
    }
    case 'pageTerminated': {
      return {
        ...withoutSticky(s),
        phase: 'terminated',
        terminatedReason: e.reason,
        terminatedAt: e.at,
        inflight: false,
      }
    }
    case 'pageFailed': {
      const code = e.code
      if (code !== undefined && KLINE_HISTORY_UNSUPPORTED_CODES.has(code)) {
        // 能力缺失 → 粘性 unsupported（与桥闸拒绝**同一归宿**，见 KLINE_HISTORY_UNSUPPORTED_CODES）。
        // **不改写 supportsEarlier**：它镜像 provider 级声明；连接器可能「provider 声明支持、但该
        // interval 无实现」，若写 false 会与后续 resync 回带的 true 冲突 → capability 误清粘性
        // unsupported（界面闪烁）。不改写则仅在「换 provider / 显式 reprobe」时解除（粘性，Q1）。
        // 显形仍由既有 `noticed` 门裁决（用户拖到左缘后经 `edge` 事件置真），与桥闸拒绝码完全一致。
        return {
          ...withoutSticky(s),
          phase: 'unsupported',
          inflight: false,
          failureCode: code,
        }
      }
      // 其它失败：进 error（已加载历史保留），可重试（R11）。
      return {
        ...withoutSticky(s),
        phase: 'error',
        inflight: false,
        ...(code !== undefined ? { failureCode: code } : {}),
      }
    }
    case 'reprobe': {
      // 仅 terminated 受 60s 冷却约束；error 态允许立即重试（冷却门由 shouldRequestEarlier 兜底）。
      if (s.phase === 'terminated' && e.at - (s.terminatedAt ?? 0) < EXHAUSTED_REPROBE_COOLDOWN_MS) return s
      if (s.phase !== 'terminated' && s.phase !== 'error') return s
      if (!s.supportsEarlier) return s
      if (s.oldestOpenTime === undefined) return s
      return {
        ...withoutSticky(s),
        phase: 'loading',
        inflight: true,
        lastRequestAt: e.at,
        lastRequestedCursor: s.oldestOpenTime,
      }
    }
  }
}

/**
 * 单一请求放行判据：**全部放行才为真**（§2.6 `ready + edge` 的发请求闸，R5）。
 * 依次为：页面可见 → `ready` → 非单飞中 → 声明支持 → 有游标 → 冷却已过 → 游标未重复。
 * 时间戳 `now` 与可见性 `visible` 一律由调用方传入（纯函数，无需 fake timers）。
 */
export function shouldRequestEarlier(s: KlineHistoryState, now: number, visible: boolean): boolean {
  if (!visible) return false
  if (s.phase !== 'ready') return false
  if (s.inflight) return false
  if (!s.supportsEarlier) return false
  if (s.oldestOpenTime === undefined) return false
  if (now - s.lastRequestAt < PAGE_REQUEST_COOLDOWN_MS) return false
  if (s.lastRequestedCursor !== undefined && s.lastRequestedCursor === s.oldestOpenTime) return false
  return true
}

/**
 * 页面结果判据：满页 ⇒ `'page'`；不足一页（含 0）⇒ `'exhausted'`。
 * 运行时探测是终止态的**最终真相源**（声明只用于 UI 提前示明）。
 */
export function classifyPageOutcome(rows: readonly Kline[], pageSize: number): 'page' | 'exhausted' {
  if (pageSize <= 0) return 'exhausted'
  return rows.length >= pageSize ? 'page' : 'exhausted'
}

/**
 * 合并两段 K 线序列：并集 + 按 `openTime` 去重 + 升序；**重叠以「新响应」为准**
 * （resync 需要用它修订尾部的开高低/量）。这是交给 lightweight-charts 的数组
 * 「按 openTime 升序且唯一」不变量的单点保证，禁止旁路构造。
 */
export function mergeKlines(prev: readonly Kline[], rows: readonly Kline[]): Kline[] {
  const byTime = new Map<number, Kline>()
  for (const k of prev) byTime.set(k.openTime, k)
  for (const k of rows) byTime.set(k.openTime, k) // 后写覆盖前写 = 新响应为准
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime)
}
