/**
 * 往更早翻页（图表左缘惰性分页）游标单测 —— connector-okx。
 *
 * OKX `after` 的语义（返回**严格早于**所请求 ts 的记录）与 api `KlineQuery.before` 逐字同构，
 * 故游标**无需换算**：本文件钉死「before 原值即首个 after」与「无 before 时请求逐字不变（零回归）」，
 * 以及短页即停（窗口耗尽）。用记录请求的假 fetch（普通函数缝），零 mock / 零 sleep（项目测试棘轮）。
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { OkxRestClient } from '../src/rest.js'
import { OkxMarketDataService } from '../src/index.js'

/** Service 构造所需的最小假 ctx（与 public-market-data.test 同款形状）。 */
function makeServiceCtx(): Context {
  return {
    get: () => undefined,
    reflect: { provide: () => {} },
  } as unknown as Context
}

interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 按断言路由的假 fetch（记录请求并按 handler 返回响应）——普通函数缝，非通用 mock 工具。 */
function routeMock(handler: (req: RecordedRequest) => Response): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input, init) => {
    const req: RecordedRequest = { url: String(input), init: init ?? {} }
    requests.push(req)
    return handler(req)
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

function client(fetchImpl: typeof fetch): OkxRestClient {
  return new OkxRestClient({ baseUrl: 'https://okx.test', fetchImpl, clockSync: false, clockOffsetMs: 0 })
}

/** 合成 OKX candles 行（新→旧，from 起每根递减 1000ms）：[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]。 */
function klineRows(from: number, count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [String(from - i * 1000), '1', '2', '0.5', '1.5', '10', '0', '0', '1'])
}

describe('okx 往更早翻页游标', () => {
  it('用户 给出往早游标时首个请求直接以其作为 after（语义同构，无换算）', async () => {
    // Given 一个只返回 2 根（不足一页）的假 fetch
    const { fetchImpl, requests } = routeMock(() => okResponse({ code: '0', data: klineRows(400_000, 2) }))
    // When 带 before=500000 取更早一页
    const klines = await client(fetchImpl).getKlines('BTC-USDT', '1h', 5, { before: 500_000 })
    // Then 首个请求的 after 就是 before 原值（无 −1 之类换算），且返回按时间升序
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('after=500000')
    expect(requests[0]?.url).toContain('limit=5')
    expect(klines.map((k) => k.openTime)).toEqual([399_000, 400_000])
  })

  it('用户 不给往早游标时请求与既有取数逐字一致（零回归）', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock(() => okResponse({ code: '0', data: klineRows(400_000, 2) }))
    // When 不带 query 取数（既有调用形态）
    await client(fetchImpl).getKlines('BTC-USDT', '1h', 5)
    // Then 请求不含 after，参数与改动前完全一致
    expect(requests[0]?.url).toBe('https://okx.test/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=5')
  })

  it('用户 更早页不足一页时即停（不追加第二次请求）', async () => {
    // Given 无论是否带 after 都只返回 2 根的假 fetch
    const { fetchImpl, requests } = routeMock(() => okResponse({ code: '0', data: klineRows(400_000, 2) }))
    // When 请求 5 根更早历史
    const klines = await client(fetchImpl).getKlines('BTC-USDT', '1h', 5, { before: 500_000 })
    // Then 只发一次请求，按已取得的 2 根返回（窗口耗尽）
    expect(requests).toHaveLength(1)
    expect(klines).toHaveLength(2)
  })

  it('用户 给出非正整数的往早游标时被结构化拒绝', async () => {
    // Given 一个假 fetch（不应被触达）
    const { fetchImpl, requests } = routeMock(() => okResponse({ code: '0', data: [] }))
    // When / Then 0 / 负数 / 小数 游标一律结构化拒绝，且不发任何请求
    await expect(client(fetchImpl).getKlines('BTC-USDT', '1h', 5, { before: 0 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('BTC-USDT', '1h', 5, { before: -1 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('BTC-USDT', '1h', 5, { before: 1.5 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    expect(requests).toHaveLength(0)
  })

  it('用户 行情服务声明支持往更早翻页且页大小上界为 300', () => {
    // Given 一个 OKX 行情服务（client 用假 fetch，不触网）
    const { fetchImpl } = routeMock(() => okResponse({ code: '0', data: [] }))
    const service = new OkxMarketDataService(makeServiceCtx(), {}, client(fetchImpl), 'test-kline-history')
    // When 读取能力声明
    const capability = service.getKlineHistoryCapability()
    // Then 声明支持、单请求上界 300（与 rest 的 Math.min(…,300) 同源）、note 有据可查
    expect(capability.supportsEarlier).toBe(true)
    expect(capability.maxPageSize).toBe(300)
    expect(typeof capability.note).toBe('string')
  })
})
