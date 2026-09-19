/**
 * `kline-history.ts` 纯逻辑单测（2026-09-19 图表左缘惰性分页）。
 *
 * 覆盖设计文档 §12.2 的必须断言：A1(合并) / A2(页结果判据) / A5(放行判据) /
 * A8(粘性与重置) / A9(页大小硬上界)。
 *
 * 全部为纯函数直调——时间戳与可见性一律当参数传入，**无需** fake timers 或任何
 * mock（项目测试棘轮禁 vi.* 与 setTimeout/sleep）。`MAX_KLINE_LIMIT` 从桥模块
 * 导入，使「页大小不得越桥帽」成为真实的跨文件棘轮断言。
 */
import { describe, expect, it } from 'vitest'
import { MAX_KLINE_LIMIT } from '../src/bridge.ts'
import type { Kline } from '../src/client/types.ts'
import {
  EXHAUSTED_REPROBE_COOLDOWN_MS,
  KLINE_PAGE_SIZE_BY_MARKET,
  KLINE_PAGE_SIZE_DAILY,
  KLINE_PAGE_SIZE_DEFAULT,
  MAX_LOADED_BARS,
  classifyPageOutcome,
  initialKlineHistoryState,
  klineHistoryKey,
  klinePageSize,
  mergeKlines,
  reduceKlineHistory,
  shouldRequestEarlier,
  type KlineHistoryState,
} from '../src/client/kline-history.ts'

/** 一根 K 线（测试只关心 openTime 与收盘价，其余字段补齐类型）。 */
function bar(openTime: number, close = openTime): Kline {
  return { openTime, open: close, high: close, low: close, close, volume: 0, closeTime: openTime + 60_000 }
}

/** 就绪态骨架（显式字段构造，避免 Partial 展开与 exactOptionalPropertyTypes 打架）。 */
function readyState(): KlineHistoryState {
  return {
    key: 'us:AAPL:1d',
    phase: 'ready',
    supportsEarlier: true,
    oldestOpenTime: 1_000,
    loadedCount: 3,
    inflight: false,
    noticed: false,
    lastRequestAt: 0,
  }
}

/** 加载中骨架。 */
function loadingState(): KlineHistoryState {
  return { ...readyState(), phase: 'loading', inflight: true }
}

describe('kline-history 合并与页大小（A1 / A9）', () => {
  it('用户 合并前插页与尾部修订页时无重复且严格升序并以新响应为准', () => {
    // Given 已加载尾部三根（300/400/500），其中 500 将被修订
    const prev = [bar(300), bar(400), bar(500, 500)]
    // When 叠加一页更早（100/200）与一页尾部（修订 500 + 新增 600）
    const merged = mergeKlines(prev, [bar(600), bar(500, 999), bar(100), bar(200)])
    // Then 升序且 openTime 唯一，重叠的 500 采用新响应的收起价 999
    expect(merged.map((k) => k.openTime)).toEqual([100, 200, 300, 400, 500, 600])
    expect(new Set(merged.map((k) => k.openTime)).size).toBe(merged.length)
    expect(merged.find((k) => k.openTime === 500)?.close).toBe(999)
  })

  it('用户 三种市场周期解析出的页大小都不超过桥的硬上界', () => {
    // Given 桥的 K 线 limit 硬上界
    // When 逐档解析页大小
    const crypto = klinePageSize('crypto', '1m')
    const us = klinePageSize('us', '5m')
    const daily = klinePageSize('us', '1d')
    // Then 全部 ≤ 硬上界，且各档落到约定取值
    expect(crypto).toBe(KLINE_PAGE_SIZE_BY_MARKET.crypto)
    expect(us).toBe(KLINE_PAGE_SIZE_DEFAULT)
    expect(daily).toBe(KLINE_PAGE_SIZE_DAILY)
    expect([crypto, us, daily].every((n) => n <= MAX_KLINE_LIMIT)).toBe(true)
  })

  it('访客 dataKey 由市场符号周期三段拼成且随周期变化', () => {
    // Given 三个标识维度
    // When 拼接 dataKey
    const key = klineHistoryKey('crypto', 'BTCUSDT', '1m')
    // Then 形如 market:symbol:interval，且周期不同即 key 不同
    expect(key).toBe('crypto:BTCUSDT:1m')
    expect(klineHistoryKey('crypto', 'BTCUSDT', '1d')).not.toBe(key)
  })
})

describe('classifyPageOutcome 页面结果判据（A2）', () => {
  it('用户 取到的根数恰好等于页大小时判定仍有更早一页', () => {
    // Given 一页恰好填满
    // When 判定
    // Then 判为 page（可继续翻）
    expect(classifyPageOutcome([bar(1), bar(2)], 2)).toBe('page')
  })

  it('客户 取到的根数不足一页时判定数据源窗口耗尽', () => {
    // Given 一页未填满
    // When 判定
    // Then 判为 exhausted
    expect(classifyPageOutcome([bar(1)], 2)).toBe('exhausted')
  })

  it('访客 取到空页时判定数据源窗口耗尽', () => {
    // Given 空页
    // When 判定
    // Then 判为 exhausted（运行时探测即终止态真相源）
    expect(classifyPageOutcome([], 2)).toBe('exhausted')
  })
})

describe('shouldRequestEarlier 放行判据（A5）', () => {
  it('用户 就绪且有游标且冷却已过且页面可见时放行分页', () => {
    // Given 就绪态（无在途、无重复游标、冷却已过）
    // When 判据
    // Then 放行
    expect(shouldRequestEarlier(readyState(), 5_000, true)).toBe(true)
  })

  it('用户 页面不可见时不放行分页', () => {
    // Given 就绪态但页面不可见
    // When 判据
    // Then 不放行
    expect(shouldRequestEarlier(readyState(), 5_000, false)).toBe(false)
  })

  it('用户 非就绪态（加载中）时不放行分页', () => {
    // Given 加载中态
    // When 判据
    // Then 不放行
    expect(shouldRequestEarlier(loadingState(), 5_000, true)).toBe(false)
  })

  it('用户 有在途请求（单飞中）时不放行分页', () => {
    // Given 就绪态但 inflight 为真
    const s = { ...readyState(), inflight: true }
    // When / Then 不放行
    expect(shouldRequestEarlier(s, 5_000, true)).toBe(false)
  })

  it('用户 冷却时间未到时不放行分页', () => {
    // Given 上一次请求刚发生在 4800，now=5000（冷却 1000ms 未过）
    const s = { ...readyState(), lastRequestAt: 4_800 }
    expect(shouldRequestEarlier(s, 5_000, true)).toBe(false)
  })

  it('用户 同一游标已请求过时不重复放行分页', () => {
    // Given 上一次请求游标与当前最旧 openTime 相同
    const s = { ...readyState(), lastRequestedCursor: 1_000 }
    expect(shouldRequestEarlier(s, 5_000, true)).toBe(false)
  })
})

describe('reduceKlineHistory 粘性与重置（A8）', () => {
  it('用户 终止态收到 dataKey 重置后回到初始空闲态', () => {
    // Given 已进入终止态
    const terminated = reduceKlineHistory(readyState(), { type: 'pageTerminated', reason: 'source', at: 5_000 })
    expect(terminated.phase).toBe('terminated')
    // When 收到新 key 的 reset
    const next = reduceKlineHistory(terminated, { type: 'reset', key: 'us:MSFT:1d' })
    // Then 回到 idle、key 更新、终止粘性清除
    expect(next.phase).toBe('idle')
    expect(next.key).toBe('us:MSFT:1d')
    expect(next.terminatedReason).toBeUndefined()
  })

  it('客户 终止态收到能力变化（新 provider 声明支持）后重新就绪', () => {
    // Given 因会话上限终止的态
    const terminated = reduceKlineHistory(readyState(), { type: 'pageTerminated', reason: 'cap', at: 5_000 })
    // When provider 变化且仍声明支持
    const next = reduceKlineHistory(terminated, { type: 'capability', key: 'us:AAPL:1d', supportsEarlier: true, provider: 'okx' })
    // Then 清粘性回 ready，provider 刷新
    expect(next.phase).toBe('ready')
    expect(next.provider).toBe('okx')
    expect(next.terminatedReason).toBeUndefined()
  })

  it('管理员 能力声明不支持时进入不支持态并因左缘事件置显形门', () => {
    // Given 首屏空闲
    const idle = initialKlineHistoryState('us:AAPL:1d')
    // When 拿到「不支持」能力声明
    const unsupported = reduceKlineHistory(idle, { type: 'capability', key: 'us:AAPL:1d', supportsEarlier: false, provider: 'binance' })
    expect(unsupported.phase).toBe('unsupported')
    expect(unsupported.noticed).toBe(false)
    // 且 用户真正拖到左缘
    const noticed = reduceKlineHistory(unsupported, { type: 'edge' })
    // Then 显形但不发请求
    expect(noticed.noticed).toBe(true)
    expect(noticed.phase).toBe('unsupported')
  })
})

describe('reduceKlineHistory 页面结果（R7 / R11）', () => {
  it('用户 加载到满页后回到就绪并推进最旧游标与累计计数', () => {
    // Given 加载中
    // When 回来一整页
    const next = reduceKlineHistory(loadingState(), { type: 'pageOk', rows: [bar(1_000), bar(1_500)], pageSize: 2, at: 9_000 })
    // Then 回 ready、游标推进到最旧、计数累加
    expect(next.phase).toBe('ready')
    expect(next.oldestOpenTime).toBe(1_000)
    expect(next.loadedCount).toBe(5)
    expect(next.inflight).toBe(false)
  })

  it('客户 加载到不足一页时进入源耗尽终止态', () => {
    // Given 加载中
    // When 只回来不足一页
    const next = reduceKlineHistory(loadingState(), { type: 'pageOk', rows: [bar(1_000)], pageSize: 2, at: 9_000 })
    // Then 进 terminated(source)
    expect(next.phase).toBe('terminated')
    expect(next.terminatedReason).toBe('source')
  })

  it('运营 桥闸拒绝历史分页时进入不支持态并保留失败码', () => {
    // Given 加载中
    // When 请求返回桥闸拒绝错误码
    const next = reduceKlineHistory(loadingState(), { type: 'pageFailed', code: 'TRADING_KLINE_HISTORY_UNSUPPORTED', at: 9_000 })
    // Then 进 unsupported（粘性能力缺失），保留失败码
    expect(next.phase).toBe('unsupported')
    expect(next.failureCode).toBe('TRADING_KLINE_HISTORY_UNSUPPORTED')
  })

  it('运营 分钟线前插遇 TRADING_NOT_IMPLEMENTED 也进粘性 unsupported（非 error）且不改写 supportsEarlier', () => {
    // Given provider 已声明支持（loadingState.supportsEarlier = true）且正加载中
    // When 上游对分钟线带 before 抛 TRADING_NOT_IMPLEMENTED（provider 级声明支持、interval 无实现）
    const next = reduceKlineHistory(loadingState(), { type: 'pageFailed', code: 'TRADING_NOT_IMPLEMENTED', at: 9_000 })
    // Then 与桥闸拒绝**同一归宿**：进 unsupported、保留失败码、释放单飞闸；supportsEarlier **保持 true**
    // （镜像 provider 级声明；若改写为 false 会与后续 resync 回带的 true 冲突而误清粘性 unsupported）
    expect(next.phase).toBe('unsupported')
    expect(next.failureCode).toBe('TRADING_NOT_IMPLEMENTED')
    expect(next.inflight).toBe(false)
    expect(next.supportsEarlier).toBe(true)
  })

  it('用户 会话累计加载量达到上限后停止继续往早', () => {
    // Given 累计已到上限前一格
    const near = { ...loadingState(), loadedCount: MAX_LOADED_BARS - 1 }
    // When 再回来一整页
    const next = reduceKlineHistory(near, { type: 'pageOk', rows: [bar(500)], pageSize: 1, at: 9_000 })
    // Then 进 terminated(cap)
    expect(next.phase).toBe('terminated')
    expect(next.terminatedReason).toBe('cap')
  })
})

describe('reduceKlineHistory 受控重试冷却（Q1）', () => {
  it('管理员 终止后冷却未过的显式重试被忽略', () => {
    // Given 刚终止
    const terminated = reduceKlineHistory(readyState(), { type: 'pageTerminated', reason: 'source', at: 100_000 })
    // When 冷却还差 1ms 就显式重试
    const ignored = reduceKlineHistory(terminated, { type: 'reprobe', at: 100_000 + EXHAUSTED_REPROBE_COOLDOWN_MS - 1 })
    // Then 仍保持终止
    expect(ignored.phase).toBe('terminated')
  })

  it('管理员 终止后冷却已过的显式重试进入加载受控单次重试', () => {
    // Given 已终止超过冷却时长
    const terminated = reduceKlineHistory(readyState(), { type: 'pageTerminated', reason: 'source', at: 100_000 })
    // When 冷却已过再显式重试
    const retried = reduceKlineHistory(terminated, { type: 'reprobe', at: 100_000 + EXHAUSTED_REPROBE_COOLDOWN_MS + 1 })
    // Then 进入 loading 且单飞中
    expect(retried.phase).toBe('loading')
    expect(retried.inflight).toBe(true)
  })
})
