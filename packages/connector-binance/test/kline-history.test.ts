/**
 * 往更早翻页（图表左缘惰性分页）游标单测 —— connector-binance。
 *
 * 钉死 `before` → `endTime = before − 1`（毫秒，因 Binance endTime 为**闭区间**上界；2026-09-19
 * 真实网络实证 spikes/impl-tv-history-paging/），以及「无 before 时请求逐字不变（零回归）」。
 * 边界覆盖：before 恰落在某根 K 线 openTime 上、before 落在 bar 之内、缺失、非正整数。
 * 用记录请求的假 fetch（普通函数缝），零 mock / 零 sleep（项目测试棘轮）。
 */
import { describe, expect, it } from 'vitest'
import { BinanceRestClient, binanceEndTimeForBefore } from '../src/rest.js'
import { BinanceMarketDataService } from '../src/index.js'

interface RecordedRequest {
  readonly url: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 记录请求的假 fetch（普通函数缝，非通用 mock 工具）。 */
function routeMock(body: unknown): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input) => {
    requests.push({ url: String(input) })
    return jsonResponse(body)
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

function client(fetchImpl: typeof fetch): BinanceRestClient {
  return new BinanceRestClient({ baseUrl: 'https://binance.test', fetchImpl })
}

/** 一根 Binance K 线行：[openTime, open, high, low, close, volume, closeTime, ...]。 */
function klineRow(openTime: number): unknown[] {
  return [String(openTime), '1', '2', '0.5', '1.5', '10', String(openTime + 3_599_999)]
}

/** 一根 1h bar 的开盘时刻（整点对齐）。 */
const BAR_OPEN = 1_700_000_000_000

describe('binance 往更早翻页游标（endTime = before − 1）', () => {
  it('用户 给出往早游标时以 before 减 1 毫秒作为 endTime（闭区间换算）', async () => {
    // Given 一个记录请求的假 fetch（返回一根）
    const { fetchImpl, requests } = routeMock([klineRow(BAR_OPEN - 3_600_000)])
    // When 带 before=BAR_OPEN 取更早一页
    await client(fetchImpl).getKlines('BTCUSDT', '1h', 5, { before: BAR_OPEN })
    // Then endTime 严格等于 before − 1（毫秒），使恰好等于 before 的那根被排除
    expect(requests[0]?.url).toBe(
      'https://binance.test/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5&endTime=' + String(BAR_OPEN - 1),
    )
  })

  it('用户 不给往早游标时请求不含 endTime（既有行为逐字不变）', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock([klineRow(BAR_OPEN)])
    // When 不带 query 取数（既有调用形态）
    await client(fetchImpl).getKlines('BTCUSDT', '1h', 5)
    // Then 请求不含 endTime，参数与改动前完全一致
    expect(requests[0]?.url).toBe('https://binance.test/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5')
  })

  it('用户 往早游标恰落在某根 K 线开盘时刻时该根被严格排除', () => {
    // Given 某根 1h K 线的开盘时刻作为游标
    // When 做闭区间 → 严格早于的换算
    const endTime = binanceEndTimeForBefore(BAR_OPEN)
    // Then 结果比游标早 1 毫秒（该根 openTime ≤ endTime 不成立 → 被排除）
    expect(endTime).toBe(BAR_OPEN - 1)
    expect(endTime! < BAR_OPEN).toBe(true)
  })

  it('用户 往早游标落在 bar 之内时同样只减 1 毫秒（不做 bar 对齐）', () => {
    // Given 一根 bar 内部任意时刻（非整点）作为游标
    const mid = BAR_OPEN + 1_234_567
    // When 换算
    // Then 仅 −1ms（Binance 自会回落到该时刻之前最近的整点 bar）
    expect(binanceEndTimeForBefore(mid)).toBe(mid - 1)
  })

  it('用户 缺失往早游标时换算返回 undefined（不附加 endTime）', () => {
    // Given 无游标
    // When 换算
    // Then undefined
    expect(binanceEndTimeForBefore(undefined)).toBeUndefined()
  })

  it('用户 给出非正整数的往早游标时被结构化拒绝且不发请求', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock([])
    // When / Then 0 / 负数 / 小数 游标一律结构化拒绝
    await expect(client(fetchImpl).getKlines('BTCUSDT', '1h', 5, { before: 0 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('BTCUSDT', '1h', 5, { before: -5 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('BTCUSDT', '1h', 5, { before: 1.5 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    expect(requests).toHaveLength(0)
  })

  it('用户 binance 行情服务声明支持往更早翻页且页大小上界为 1000', () => {
    // Given 一个 binance 行情服务（client 用假 fetch，不触网）
    const { fetchImpl } = routeMock([])
    const service = new BinanceMarketDataService({ get: () => undefined, reflect: { provide: () => {} } } as never, { baseUrl: 'https://binance.test', fetchImpl })
    // When 读取能力声明
    const capability = service.getKlineHistoryCapability()
    // Then 声明支持、单请求上界 1000（与 rest 的 limit 校验上界同源）
    expect(capability.supportsEarlier).toBe(true)
    expect(capability.maxPageSize).toBe(1000)
    expect(typeof capability.note).toBe('string')
  })
})
