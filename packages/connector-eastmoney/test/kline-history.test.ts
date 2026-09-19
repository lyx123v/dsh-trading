/**
 * 往更早翻页（图表左缘惰性分页）游标单测 —— connector-eastmoney。
 *
 * 钉死 `before` → `kline/get` 的 `end` 参数（`YYYYMMDD`，**闭区间**日期上界；2026-09-19 主理人
 * WebFetch 补证实证，转录 spikes/impl-tv-history-paging/raw/12-*），覆盖 UTC+8 墙钟日界、
 * 「无 before 时 end 保持硬编码 20500101（零回归）」与「盘中周期如实拒绝（klt<101 未实证）」。
 * 用记录请求的假 fetch（普通函数缝），零 mock / 零 sleep（项目测试棘轮）。
 */
import { describe, expect, it } from 'vitest'
import { EastmoneyRestClient, eastmoneyEndDateForBefore, utc8WallTimeToEpochMs } from '../src/rest.js'
import { EastmoneyMarketDataService } from '../src/index.js'

interface RecordedRequest {
  readonly url: string
}

/** 记录请求的假 fetch（普通函数缝，非通用 mock 工具）；返回给定的 kline/get 信封。 */
function routeMock(body: unknown): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input) => {
    requests.push({ url: String(input) })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

function client(fetchImpl: typeof fetch, market: 'cn' | 'hk' = 'cn'): EastmoneyRestClient {
  return new EastmoneyRestClient({ historyBaseUrl: 'https://eastmoney.test', fetchImpl, market })
}

/** kline/get 信封：data.klines = ['日期,开,收,高,低,量,额,均价', …]。 */
function klineEnvelope(dates: readonly string[]): unknown {
  return { data: { klines: dates.map((d) => `${d},10.00,10.50,10.60,9.90,1000.00,0,0`) } }
}

const FIELDS = '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58'

describe('eastmoney 往更早翻页游标（end = before 所在日 − 1 自然日，UTC+8）', () => {
  it('用户 日线给出往早游标时 end 填前一自然日（UTC+8 墙钟口径）', () => {
    // Given 一根日 K 的开盘时刻（UTC+8 当日零点）
    const barOpen = utc8WallTimeToEpochMs('2026-09-18')
    // When 做闭区间 → 严格早于的换算
    // Then end 为前一自然日（YYYYMMDD）
    expect(eastmoneyEndDateForBefore(barOpen)).toBe('20260917')
  })

  it('用户 往早游标落在 UTC+8 日界之内时 end 取当日', () => {
    // Given 某日 UTC+8 上午 10:00（非日 K openTime）
    const midDay = utc8WallTimeToEpochMs('2026-09-18 10:00')
    // When 换算
    // Then end 为当日（当日那根日 K 的 openTime = 零点 < 游标）
    expect(eastmoneyEndDateForBefore(midDay)).toBe('20260918')
  })

  it('用户 不给往早游标时 end 保持硬编码 20500101（零回归）', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock(klineEnvelope(['2026-09-17']))
    // When 不带 query 取数（既有调用形态）
    await client(fetchImpl).getKlines('600519', '1d', 5)
    // Then URL 与改动前逐字一致（end 仍为 20500101 的未来上界）
    expect(requests[0]?.url).toBe('https://eastmoney.test/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=1&lmt=5&end=20500101' + FIELDS)
  })

  it('用户 日线往早游标经 end 生效且返回升序', async () => {
    // Given 一个返回两根更早日 K 的假 fetch
    const { fetchImpl, requests } = routeMock(klineEnvelope(['2026-09-16', '2026-09-17']))
    // When 带 before=2026-09-18 取更早一页
    const klines = await client(fetchImpl).getKlines('600519', '1d', 5, { before: utc8WallTimeToEpochMs('2026-09-18') })
    // Then end=20260917，且返回按时间升序
    expect(requests[0]?.url).toBe('https://eastmoney.test/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=1&lmt=5&end=20260917' + FIELDS)
    expect(klines.map((k) => k.openTime)).toEqual([utc8WallTimeToEpochMs('2026-09-16'), utc8WallTimeToEpochMs('2026-09-17')])
  })

  it('用户 周线与月线同样以 end 日期上界翻页（klt≥101）', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock(klineEnvelope(['2026-09-04']))
    const rest = client(fetchImpl)
    // When 周线（klt=102）与月线（klt=103）各带一次往早游标
    await rest.getKlines('600519', '1w', 5, { before: utc8WallTimeToEpochMs('2026-09-11') })
    await rest.getKlines('600519', '1M', 5, { before: utc8WallTimeToEpochMs('2026-09-11') })
    // Then 两请求都带 end=20260910（日期上界与周期无关）
    expect(requests[0]?.url).toContain('klt=102')
    expect(requests[0]?.url).toContain('&end=20260910&')
    expect(requests[1]?.url).toContain('klt=103')
    expect(requests[1]?.url).toContain('&end=20260910&')
  })

  it('用户 盘中周期给出往早游标时如实拒绝（klt<101 语义未实证）', async () => {
    // Given 一个不应被触达的假 fetch
    const { fetchImpl, requests } = routeMock(klineEnvelope([]))
    // When / Then A 股 5 分钟线与港股 1 分钟线带 before 一律抛 TRADING_NOT_IMPLEMENTED，且不发请求
    await expect(client(fetchImpl, 'cn').getKlines('600519', '5m', 5, { before: utc8WallTimeToEpochMs('2026-09-18') }))
      .rejects.toMatchObject({ code: 'TRADING_NOT_IMPLEMENTED' })
    await expect(client(fetchImpl, 'hk').getKlines('00700', '1m', 5, { before: utc8WallTimeToEpochMs('2026-09-18') }))
      .rejects.toMatchObject({ code: 'TRADING_NOT_IMPLEMENTED' })
    expect(requests).toHaveLength(0)
  })

  it('用户 给出非正整数的往早游标时被结构化拒绝', async () => {
    // Given 一个不应被触达的假 fetch
    const { fetchImpl } = routeMock(klineEnvelope([]))
    // When / Then 0 / 负数 / 小数 游标一律结构化拒绝
    await expect(client(fetchImpl).getKlines('600519', '1d', 5, { before: 0 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('600519', '1d', 5, { before: -1 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client(fetchImpl).getKlines('600519', '1d', 5, { before: 3.5 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
  })

  it('用户 eastmoney 行情服务声明支持往更早翻页', () => {
    // Given 一个 eastmoney 行情服务（client 用假 fetch，不触网）
    const { fetchImpl } = routeMock(klineEnvelope([]))
    const service = new EastmoneyMarketDataService({ get: () => undefined, reflect: { provide: () => {} } } as never, { historyBaseUrl: 'https://eastmoney.test', fetchImpl, market: 'cn' })
    // When 读取能力声明
    const capability = service.getKlineHistoryCapability()
    // Then 声明支持；maxPageSize 缺省（lmt 大值上界未实证）
    expect(capability.supportsEarlier).toBe(true)
    expect(capability.maxPageSize).toBeUndefined()
    expect(typeof capability.note).toBe('string')
  })
})
