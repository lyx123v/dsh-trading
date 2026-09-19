/**
 * 桥层往早分页的**对抗性单测**（QA 独立验证第一轮，2026-09-19 图表左缘惰性分页）。
 *
 * 与工程师既有 `bridge.test.ts` 的往早分页用例互补，本文件专攻**能力闸 fail-closed**：
 * 未声明 / 非对象 / 字符串 `'true'` / 数字 `1` / 数组 / `undefined` / 抛出异常……
 * 一律必须判为「不支持」、**上游 getKlines 调用次数严格为 0**，绝不泄漏成 500。
 * 并补 `before` 协议校验的空白串 / NaN / Infinity 边界与「校验先于能力闸」的顺序断言。
 *
 * 手法：手写契约化假服务 + 调用计数记录器（本项目测试棘轮禁通用 mock 工具）。
 */
import { describe, expect, it } from 'vitest'
import type { MarketDataService } from '@dshtrading/api'
import {
  BridgeProtocolError,
  MARKET_SERVICE_KEYS,
  TradingBridge,
  type BridgeHost,
} from '../src/bridge.ts'

/** 契约化假服务：getKlines 记录调用次数，其余最小实现。 */
function fakeService(overrides: Partial<MarketDataService> = {}): MarketDataService {
  return {
    getTicker: async (symbol) => ({ symbol, price: 100, timestamp: 1 }),
    getKlines: async () => [{
      openTime: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closeTime: 2,
    }],
    subscribeTicker: () => ({ dispose() {} }),
    ...overrides,
  }
}

function fakeHost(services: Partial<Record<string, MarketDataService>>, providers: Record<string, string> = {}): BridgeHost {
  return {
    getMarketService: (market) => services[MARKET_SERVICE_KEYS[market]],
    activeProvider: (market) => providers[market],
  }
}

/**
 * 构造一个声明了 `getKlineHistoryCapability` 但返回值刻意畸形的假服务，
 * 并返回上游调用次数读取器（`before` 被正确拒绝时次数必须为 0）。
 */
function serviceWithRawCapability(raw: () => unknown): { service: MarketDataService; upstreamCalls: () => number } {
  let calls = 0
  const service = fakeService({
    getKlineHistoryCapability: raw as unknown as MarketDataService['getKlineHistoryCapability'],
    getKlines: async () => {
      calls += 1
      return []
    },
  })
  return { service, upstreamCalls: () => calls }
}

const BEFORE = '1700000000000'

describe('能力闸 fail-closed（A6 对抗）', () => {
  it('用户 能力声明返回 null 时判为不支持且不触达上游', async () => {
    // Given 能力方法返回 null（非对象）
    const { service, upstreamCalls } = serviceWithRawCapability(() => null)
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When 带 before 请求更早一页
    // Then 能力闸拒绝且上游调用次数为 0
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('客户 能力声明返回字符串时判为不支持且不触达上游', async () => {
    // Given 能力方法返回字符串 'true'（非对象）
    const { service, upstreamCalls } = serviceWithRawCapability(() => 'true')
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 拒绝且不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('管理员 能力声明把 supportsEarlier 写成字符串 true 时判为不支持且不触达上游', async () => {
    // Given 能力方法返回 { supportsEarlier: 'true' }（字符串，非布尔真）
    const { service, upstreamCalls } = serviceWithRawCapability(() => ({ supportsEarlier: 'true' }))
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 严格 === true 判定，字符串真值不成立 → 拒绝且不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('运营 能力声明把 supportsEarlier 写成数字一时判为不支持且不触达上游', async () => {
    // Given 能力方法返回 { supportsEarlier: 1 }（数字，非布尔真）
    const { service, upstreamCalls } = serviceWithRawCapability(() => ({ supportsEarlier: 1 }))
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 拒绝且不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('访客 能力声明返回数组时判为不支持且不触达上游', async () => {
    // Given 能力方法返回数组（typeof object 但无 supportsEarlier 真值）
    const { service, upstreamCalls } = serviceWithRawCapability(() => [true])
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 拒绝且不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('用户 能力声明返回 undefined 时判为不支持且不触达上游', async () => {
    // Given 能力方法返回 undefined
    const { service, upstreamCalls } = serviceWithRawCapability(() => undefined)
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 拒绝且不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('管理员 能力方法调用抛异常时判为不支持且不泄漏成宿主错误', async () => {
    // Given 能力方法被调用时抛异常
    const { service, upstreamCalls } = serviceWithRawCapability(() => {
      throw new Error('capability probe exploded')
    })
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 走能力闸拒绝（非 TRADING_UNKNOWN / 非 500），不触达上游
    await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', BEFORE))
      .rejects.toMatchObject({ code: 'TRADING_KLINE_HISTORY_UNSUPPORTED' })
    expect(upstreamCalls()).toBe(0)
  })

  it('客户 畸形能力声明下无 before 的正常取数仍走通且 history 回带不支持', async () => {
    // Given 能力方法返回 null（畸形）
    const { service, upstreamCalls } = serviceWithRawCapability(() => null)
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When 不带 before 取最新一页
    const wire = await bridge.klines('crypto', 'BTCUSDT', '1d', '10', null)
    // Then 正常返回、上游调用一次、history 恒存在且为不支持
    expect(wire.history).toEqual({ supportsEarlier: false })
    expect(upstreamCalls()).toBe(1)
  })
})

describe('before 协议校验边界（A6 对抗）', () => {
  it('访客 before 为空白串或特殊数值字面量时协议错误 400 且不触达上游', async () => {
    // Given 一个声明支持往早的假服务（校验应早于取数）
    let calls = 0
    const service = fakeService({
      getKlineHistoryCapability: () => ({ supportsEarlier: true }),
      getKlines: async () => {
        calls += 1
        return []
      },
    })
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When / Then 空串（Number('')=0）、空白串、NaN、Infinity 一律 400
    for (const bad of ['', ' ', 'NaN', 'Infinity']) {
      await expect(bridge.klines('crypto', 'BTCUSDT', '1d', '10', bad)).rejects.toBeInstanceOf(BridgeProtocolError)
    }
    expect(calls).toBe(0)
  })

  it('用户 before 合法但 limit 越界时仍按 limit 规则报错且不触达上游', async () => {
    // Given 声明支持往早的假服务
    let calls = 0
    const service = fakeService({
      getKlineHistoryCapability: () => ({ supportsEarlier: true }),
      getKlines: async () => {
        calls += 1
        return []
      },
    })
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When before 合法但 limit 为 0 / 越上界 / 小数
    for (const badLimit of ['0', '1001', '1.5']) {
      // Then 报 limit 协议错误（消息含 limit），且不触达上游
      await expect(bridge.klines('crypto', 'BTCUSDT', '1d', badLimit, BEFORE)).rejects.toThrowError(/limit/)
    }
    expect(calls).toBe(0)
  })

  it('管理员 未声明支持且 before 非法时先报协议错误而非能力错误', async () => {
    // Given 一个未实现能力方法的假服务
    const service = fakeService()
    const bridge = new TradingBridge(fakeHost({ tradingCryptoMarketData: service }))
    // When before 非法（0）
    // Then 协议校验先于能力闸 → 抛 400 BridgeProtocolError，而非 TRADING_KLINE_HISTORY_UNSUPPORTED
    const failure = await bridge.klines('crypto', 'BTCUSDT', '1d', '10', '0').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BridgeProtocolError)
    expect((failure as { status?: number }).status).toBe(400)
    expect((failure as { code?: string }).code).toBeUndefined()
  })
})
