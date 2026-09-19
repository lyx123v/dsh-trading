/**
 * `kline-history.ts` 的**对抗性边界单测**（QA 独立验证第一轮，2026-09-19 图表左缘惰性分页）。
 *
 * 与工程师既有 `kline-history.test.ts` 的分工：那一份复核「正向必须断言」；
 * 本文件专门**试图证伪**分页领域逻辑的边界与不变量——
 * - `mergeKlines`：空页 / 完全重叠 / 完全不重叠 / 乱序 / 两侧重复 openTime / 不可变性；
 * - `classifyPageOutcome`：满页 / 少一根 / 空 / 只回一根 / 页大小非正 / 超量返回；
 * - `shouldRequestEarlier`：逐项验证「任一条件单独即可否决」，并钉死冷却边界；
 * - 状态机粘性：终止/不支持的解除路径与 60000ms / 59999ms 冷却边界；
 * - `klinePageSize`：日线优先于市场表、未知市场回落、且均不越桥硬上界。
 *
 * 全部纯函数直调——时间戳与可见性一律当参数传入，零 mock、零 fake timer。
 */
import { describe, expect, it } from 'vitest'
import { MAX_KLINE_LIMIT } from '../src/bridge.ts'
import type { Kline } from '../src/client/types.ts'
import {
  EXHAUSTED_REPROBE_COOLDOWN_MS,
  KLINE_PAGE_SIZE_DAILY,
  KLINE_PAGE_SIZE_DEFAULT,
  MAX_LOADED_BARS,
  PAGE_REQUEST_COOLDOWN_MS,
  classifyPageOutcome,
  initialKlineHistoryState,
  klineHistoryKey,
  klinePageSize,
  mergeKlines,
  reduceKlineHistory,
  shouldRequestEarlier,
  type KlineHistoryState,
} from '../src/client/kline-history.ts'

/** 一根 K 线（仅关心 openTime / close，其余字段补齐类型）。 */
function bar(openTime: number, close = openTime): Kline {
  return { openTime, open: close, high: close, low: close, close, volume: 0, closeTime: openTime + 60_000 }
}

const KEY = 'crypto:BTCUSDT:1m'

/** 全放行骨架：任一条件被单独破坏后应立刻否决。 */
function permissiveState(): KlineHistoryState {
  return {
    key: KEY,
    phase: 'ready',
    supportsEarlier: true,
    oldestOpenTime: 1_000,
    loadedCount: 10,
    inflight: false,
    noticed: false,
    lastRequestAt: 0,
  }
}

describe('mergeKlines 合并边界（A1 对抗）', () => {
  it('用户 合并空页时保留既有序列原样', () => {
    // Given 已加载两根
    const prev = [bar(1), bar(2)]
    // When 叠加一个空页
    const merged = mergeKlines(prev, [])
    // Then 序列不变
    expect(merged.map((k) => k.openTime)).toEqual([1, 2])
  })

  it('用户 完全重叠时以新响应为准且不产生重复', () => {
    // Given 旧序列 1/2
    const prev = [bar(1, 10), bar(2, 20)]
    // When 新响应整体覆盖 1 且只回一根
    const merged = mergeKlines(prev, [bar(1, 99)])
    // Then 1 用新值、2 保留、无重复（这是 resync 修订能力的关键）
    expect(merged).toEqual([bar(1, 99), bar(2, 20)])
    expect(new Set(merged.map((k) => k.openTime)).size).toBe(2)
  })

  it('客户 完全不重叠时取并集并按 openTime 升序', () => {
    // Given 旧序列偏新（5/6）
    const prev = [bar(5), bar(6)]
    // When 新响应偏旧（1/2）
    const merged = mergeKlines(prev, [bar(1), bar(2)])
    // Then 升序并集（分页前插 + resync 追加的并集语义）
    expect(merged.map((k) => k.openTime)).toEqual([1, 2, 5, 6])
  })

  it('用户 乱序输入也按 openTime 严格升序输出', () => {
    // Given 两侧都乱序
    const prev = [bar(3), bar(1)]
    const rows = [bar(4), bar(2)]
    // When 合并
    const merged = mergeKlines(prev, rows)
    // Then 交给 lightweight-charts 的数组必然是升序（单点不变量保证）
    expect(merged.map((k) => k.openTime)).toEqual([1, 2, 3, 4])
  })

  it('管理员 两侧同时存在同一 openTime 时一律以新响应覆盖', () => {
    // Given 旧序列与响应在 1、2 上都重叠
    const prev = [bar(1, 10), bar(2, 20)]
    const rows = [bar(1, 11), bar(2, 21)]
    // When 合并
    const merged = mergeKlines(prev, rows)
    // Then 两处都取新值（后写覆盖前写）
    expect(merged).toEqual([bar(1, 11), bar(2, 21)])
  })

  it('运营 输入含重复 openTime 时输出仍保持唯一', () => {
    // Given 旧序列自身就带重复 openTime（异常输入）
    const prev = [bar(1, 10), bar(1, 9)]
    // When 再叠加同时间戳一行
    const merged = mergeKlines(prev, [bar(1, 7)])
    // Then 输出唯一且取最后写入值
    expect(merged).toHaveLength(1)
    expect(merged[0]?.close).toBe(7)
  })

  it('访客 合并不修改传入的原始数组', () => {
    // Given 两个输入数组
    const prev = [bar(1), bar(2)]
    const rows = [bar(3)]
    // When 合并
    mergeKlines(prev, rows)
    // Then 输入数组长度不变（纯函数无副作用）
    expect(prev).toHaveLength(2)
    expect(rows).toHaveLength(1)
  })
})

describe('classifyPageOutcome 结果判据边界（A2 对抗）', () => {
  it('用户 恰好满页时判为仍有更早一页', () => {
    // Given 根数恰等于页大小
    // When 判定
    // Then page
    expect(classifyPageOutcome([bar(1), bar(2), bar(3)], 3)).toBe('page')
  })

  it('用户 少一根时判为数据源窗口耗尽', () => {
    // Given 比页大小少一根
    // When 判定
    // Then exhausted
    expect(classifyPageOutcome([bar(1), bar(2)], 3)).toBe('exhausted')
  })

  it('客户 只回一根且页大小为一恰满页时判为可继续', () => {
    // Given 页大小为 1、恰好回 1 根
    // When 判定
    // Then page（边界：满页定义含一根）
    expect(classifyPageOutcome([bar(1)], 1)).toBe('page')
  })

  it('访客 只回一根但页大小大于一时判为耗尽', () => {
    // Given 页大小 5、只回 1 根
    // When 判定
    // Then exhausted
    expect(classifyPageOutcome([bar(1)], 5)).toBe('exhausted')
  })

  it('运营 空页时判为耗尽', () => {
    // Given 空数组
    // When 判定
    // Then exhausted（运行时探测即终止态真相源）
    expect(classifyPageOutcome([], 5)).toBe('exhausted')
  })

  it('管理员 页大小非正时防御性判为耗尽', () => {
    // Given 非法的页大小
    // When / Then 一律 exhausted，绝不误判为可继续
    expect(classifyPageOutcome([bar(1)], 0)).toBe('exhausted')
    expect(classifyPageOutcome([bar(1)], -3)).toBe('exhausted')
  })

  it('用户 返回根数超过页大小时判为可继续', () => {
    // Given 上游超量返回
    // When 判定
    // Then 仍为 page（不会误判成耗尽而提前终止）
    expect(classifyPageOutcome([bar(1), bar(2), bar(3), bar(4)], 2)).toBe('page')
  })
})

describe('shouldRequestEarlier 逐项否决（A5 对抗）', () => {
  it('用户 全部条件放行时才允许发起分页', () => {
    // Given 就绪 / 无在途 / 支持 / 有游标 / 冷却已过 / 游标未重复 / 页面可见
    // When 判据
    // Then 放行
    expect(shouldRequestEarlier(permissiveState(), 100_000, true)).toBe(true)
  })

  it('用户 页面不可见这一项单独即可否决分页', () => {
    // Given 其余全放行但页面隐藏
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier(permissiveState(), 100_000, false)).toBe(false)
  })

  it('用户 相非就绪这一项单独即可否决分页', () => {
    // Given 其余全放行但相为 idle
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier({ ...permissiveState(), phase: 'idle' }, 100_000, true)).toBe(false)
  })

  it('用户 在途单飞这一项单独即可否决分页', () => {
    // Given 其余全放行但 inflight 为真
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier({ ...permissiveState(), inflight: true }, 100_000, true)).toBe(false)
  })

  it('用户 未声明支持这一项单独即可否决分页', () => {
    // Given 其余全放行但 supportsEarlier 为假
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier({ ...permissiveState(), supportsEarlier: false }, 100_000, true)).toBe(false)
  })

  it('用户 无游标这一项单独即可否决分页', () => {
    // Given 其余全放行但没有 oldestOpenTime
    const s: KlineHistoryState = { key: KEY, phase: 'ready', supportsEarlier: true, loadedCount: 3, inflight: false, noticed: false, lastRequestAt: 0 }
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier(s, 100_000, true)).toBe(false)
  })

  it('用户 冷却未到这一项单独即可否决分页', () => {
    // Given 上一次请求距 now 仅差 1ms 到冷却
    const s = { ...permissiveState(), lastRequestAt: 100_000 - PAGE_REQUEST_COOLDOWN_MS + 1 }
    // When 判据
    // Then 否决
    expect(shouldRequestEarlier(s, 100_000, true)).toBe(false)
  })

  it('客户 冷却恰好到期时放行分页', () => {
    // Given 上一次请求距 now 恰好等于冷却时长
    const s = { ...permissiveState(), lastRequestAt: 100_000 - PAGE_REQUEST_COOLDOWN_MS }
    // When 判据
    // Then 放行（边界：`<` 冷却才否决）
    expect(shouldRequestEarlier(s, 100_000, true)).toBe(true)
  })

  it('访客 同一游标已请求过这一项单独即可否决分页', () => {
    // Given 其余全放行但上次请求游标与当前最旧时间相同
    const s = { ...permissiveState(), lastRequestedCursor: 1_000 }
    // When 判据
    // Then 否决（防止对同一位置请求风暴）
    expect(shouldRequestEarlier(s, 100_000, true)).toBe(false)
  })

  it('运营 上次请求游标与当前最旧时间不同则不触发去重否决', () => {
    // Given 上次游标与当前最旧时间不同
    const s = { ...permissiveState(), lastRequestedCursor: 2_000 }
    // When 判据
    // Then 放行
    expect(shouldRequestEarlier(s, 100_000, true)).toBe(true)
  })
})

describe('reduceKlineHistory 粘性解除路径（A8 / Q1 对抗）', () => {
  it('用户 终止态收到自动左缘事件仍保持终止', () => {
    // Given 源耗尽终止
    const terminated = reduceKlineHistory(permissiveState(), { type: 'pageTerminated', reason: 'source', at: 5_000 })
    // When 自动左缘事件（resync / 拖动）到达
    const afterEdge = reduceKlineHistory(terminated, { type: 'edge' })
    // Then 粘性保持，不因自动触发清除
    expect(afterEdge.phase).toBe('terminated')
    expect(afterEdge.terminatedReason).toBe('source')
  })

  it('用户 不支持态收到同 key 的不支持声明仍保持不支持', () => {
    // Given 因能力缺失进入不支持态
    const unsupported = reduceKlineHistory(initialKlineHistoryState(KEY), { type: 'capability', key: KEY, supportsEarlier: false })
    // When 同 provider 能力的重复声明到达
    const again = reduceKlineHistory(unsupported, { type: 'capability', key: KEY, supportsEarlier: false })
    // Then 仍是不支持（粘性）
    expect(again.phase).toBe('unsupported')
  })

  it('管理员 不支持态收到支持声明后恢复就绪', () => {
    // Given 不支持态
    const unsupported = reduceKlineHistory(initialKlineHistoryState(KEY), { type: 'capability', key: KEY, supportsEarlier: false })
    // When 能力声明翻转为支持（切 provider）
    const revived = reduceKlineHistory(unsupported, { type: 'capability', key: KEY, supportsEarlier: true, provider: 'okx' })
    // Then 恢复就绪并刷新 provider
    expect(revived.phase).toBe('ready')
    expect(revived.supportsEarlier).toBe(true)
    expect(revived.provider).toBe('okx')
  })

  it('客户 就绪态收到不支持声明后转入不支持态', () => {
    // Given 就绪态
    // When 能力声明变为不支持
    const s = reduceKlineHistory(permissiveState(), { type: 'capability', key: KEY, supportsEarlier: false })
    // Then 进不支持态
    expect(s.phase).toBe('unsupported')
    expect(s.supportsEarlier).toBe(false)
  })

  it('访客 不支持态收到 dataKey 重置后回到空闲并清能力', () => {
    // Given 不支持态
    const unsupported = reduceKlineHistory(initialKlineHistoryState(KEY), { type: 'capability', key: KEY, supportsEarlier: false })
    // When 换 key 重置
    const reset = reduceKlineHistory(unsupported, { type: 'reset', key: 'us:AAPL:1d' })
    // Then 回空闲、清能力
    expect(reset.phase).toBe('idle')
    expect(reset.supportsEarlier).toBe(false)
    expect(reset.key).toBe('us:AAPL:1d')
  })

  it('用户 终止后冷却边界差 1ms（59999ms）的显式重试被忽略', () => {
    // Given 终止于 100000
    const terminated = reduceKlineHistory(permissiveState(), { type: 'pageTerminated', reason: 'source', at: 100_000 })
    // When 冷却差 1ms 时显式重试
    const ignored = reduceKlineHistory(terminated, { type: 'reprobe', at: 100_000 + EXHAUSTED_REPROBE_COOLDOWN_MS - 1 })
    // Then 仍保持终止
    expect(ignored.phase).toBe('terminated')
  })

  it('管理员 终止后冷却边界恰 60000ms 的显式重试被放行', () => {
    // Given 终止于 100000
    const terminated = reduceKlineHistory(permissiveState(), { type: 'pageTerminated', reason: 'source', at: 100_000 })
    // When 距终止恰好 60000ms 时显式重试
    const retried = reduceKlineHistory(terminated, { type: 'reprobe', at: 100_000 + EXHAUSTED_REPROBE_COOLDOWN_MS })
    // Then 进入受控单次加载
    expect(retried.phase).toBe('loading')
    expect(retried.inflight).toBe(true)
  })

  it('运营 终止后显式重试在冷却后带最旧游标进入加载', () => {
    // Given 终止态（最旧游标 1000）
    const terminated = reduceKlineHistory(permissiveState(), { type: 'pageTerminated', reason: 'source', at: 100_000 })
    // When 冷却已过显式重试
    const retried = reduceKlineHistory(terminated, { type: 'reprobe', at: 100_000 + EXHAUSTED_REPROBE_COOLDOWN_MS + 1 })
    // Then 以上次最旧时间戳作为重试游标
    expect(retried.lastRequestedCursor).toBe(1_000)
  })
})

describe('reduceKlineHistory 页面结果与上限（R7 / Q5 对抗）', () => {
  it('用户 满页时回就绪并推进最旧游标与累计计数', () => {
    // Given 加载中（累计 10）
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true }
    // When 回满一页（页大小 2）
    const next = reduceKlineHistory(loading, { type: 'pageOk', rows: [bar(400), bar(300)], pageSize: 2, at: 9_000 })
    // Then 回就绪、游标推进到 300、计数 +2
    expect(next.phase).toBe('ready')
    expect(next.oldestOpenTime).toBe(300)
    expect(next.loadedCount).toBe(12)
  })

  it('客户 不足一页时先把最旧游标推进到本页最早再进源耗尽终止', () => {
    // Given 加载中
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true }
    // When 回两行不足页大小 5
    const next = reduceKlineHistory(loading, { type: 'pageOk', rows: [bar(400), bar(300)], pageSize: 5, at: 9_000 })
    // Then 进 terminated(source) 且游标已推进（本页仍并入）
    expect(next.phase).toBe('terminated')
    expect(next.terminatedReason).toBe('source')
    expect(next.oldestOpenTime).toBe(300)
  })

  it('用户 累计恰好到上限时进入会话上限终止', () => {
    // Given 累计到上限前一格
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true, loadedCount: MAX_LOADED_BARS - 1 }
    // When 再回满一页
    const next = reduceKlineHistory(loading, { type: 'pageOk', rows: [bar(500)], pageSize: 1, at: 9_000 })
    // Then 进 terminated(cap)
    expect(next.phase).toBe('terminated')
    expect(next.terminatedReason).toBe('cap')
  })

  it('访客 累计低于上限时保持就绪', () => {
    // Given 累计远低于上限
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true, loadedCount: 100 }
    // When 回满一页
    const next = reduceKlineHistory(loading, { type: 'pageOk', rows: [bar(500)], pageSize: 1, at: 9_000 })
    // Then 保持就绪
    expect(next.phase).toBe('ready')
  })

  it('管理员 桥闸拒绝错误码进入不支持态且保留失败码', () => {
    // Given 加载中
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true }
    // When 返回桥闸拒绝码
    const next = reduceKlineHistory(loading, { type: 'pageFailed', code: 'TRADING_KLINE_HISTORY_UNSUPPORTED', at: 9_000 })
    // Then 进不支持态并保留码
    expect(next.phase).toBe('unsupported')
    expect(next.failureCode).toBe('TRADING_KLINE_HISTORY_UNSUPPORTED')
  })

  it('用户 非桥闸的失败进入可重试错误态且不丢已加载游标', () => {
    // Given 加载中（最旧游标 1000）
    const loading: KlineHistoryState = { ...permissiveState(), phase: 'loading', inflight: true }
    // When 普通网络失败
    const next = reduceKlineHistory(loading, { type: 'pageFailed', code: 'TRADING_TIMEOUT', at: 9_000 })
    // Then 进错误态、保留游标与已加载历史
    expect(next.phase).toBe('error')
    expect(next.oldestOpenTime).toBe(1_000)
    expect(next.inflight).toBe(false)
  })
})

describe('klinePageSize 单一口径（A9 对抗）', () => {
  it('用户 crypto 日线取日线页大小而非市场表值', () => {
    // Given crypto 市场 + 日线
    // When 解析页大小
    const size = klinePageSize('crypto', '1d')
    // Then 取日线档（750）而**不是** crypto 表的 300 —— 日线优先
    expect(size).toBe(KLINE_PAGE_SIZE_DAILY)
    expect(size).not.toBe(300)
  })

  it('用户 crypto 分钟线取市场表值', () => {
    // Given crypto + 分钟周期
    // When 解析
    // Then 取 crypto 档 300
    expect(klinePageSize('crypto', '1m')).toBe(300)
  })

  it('客户 未列入市场表的市场回落默认值', () => {
    // Given cn（不在按市场覆盖表内）+ 分钟周期
    // When 解析
    // Then 取默认 500
    expect(klinePageSize('cn', '5m')).toBe(KLINE_PAGE_SIZE_DEFAULT)
  })

  it('访客 日线页大小与市场无关', () => {
    // Given 两个不同市场的日线
    // When 解析
    // Then 都取 750
    expect(klinePageSize('us', '1d')).toBe(KLINE_PAGE_SIZE_DAILY)
    expect(klinePageSize('hk', '1d')).toBe(KLINE_PAGE_SIZE_DAILY)
  })

  it('运营 各分支页大小均不超过桥的硬上界', () => {
    // Given 全市场 × 常用周期
    const sizes = [
      klinePageSize('crypto', '1m'), klinePageSize('us', '5m'), klinePageSize('cn', '15m'),
      klinePageSize('hk', '1h'), klinePageSize('futures', '1d'), klinePageSize('global', '1d'),
    ]
    // When / Then 全部 ≤ MAX_KLINE_LIMIT
    expect(sizes.every((n) => n <= MAX_KLINE_LIMIT)).toBe(true)
    // Then 且都为正整数
    expect(sizes.every((n) => Number.isInteger(n) && n > 0)).toBe(true)
  })

  it('管理员 dataKey 随市场维度变化而不同', () => {
    // Given 同一 symbol/interval 但不同市场
    const crypto = klineHistoryKey('crypto', 'BTCUSDT', '1m')
    const futures = klineHistoryKey('futures', 'BTCUSDT', '1m')
    // When / Then 市场维度参与 key，避免换市场后游标串台
    expect(crypto).not.toBe(futures)
    expect(crypto).toBe('crypto:BTCUSDT:1m')
  })
})
