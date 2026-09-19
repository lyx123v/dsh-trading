/**
 * 往更早翻页（图表左缘惰性分页）游标单测 —— connector-tencent。
 *
 * 钉死 `before` → `param` 的 `end` 槽位（`YYYY-MM-DD`，**闭区间**上界；2026-09-19 真实网络实证
 * spikes/impl-tv-history-paging/ 沪深+港股），覆盖跨周末 / 跨节假日 / 同一日 / 恰落在 K 线 openTime 上，
 * 以及「无 before 时 URL 保持原空槽模板（零回归）」与「分钟线如实拒绝（mkline 语义未实证）」。
 * 用记录请求的假 fetch（普通函数缝），零 mock / 零 sleep（项目测试棘轮）。
 */
import { describe, expect, it } from 'vitest'
import { TencentRestClient, tencentEndDateForBefore } from '../src/rest.js'
import { TencentMarketDataService } from '../src/index.js'

interface RecordedRequest {
  readonly url: string
}

/** 记录请求的假 fetch（普通函数缝，非通用 mock 工具）；返回给定的 fqkline 信封。 */
function routeMock(body: unknown): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input) => {
    requests.push({ url: String(input) })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

function client(market: 'cn' | 'hk', fetchImpl: typeof fetch): TencentRestClient {
  return new TencentRestClient(market, { klineBaseUrl: 'https://tencent.test', mklineBaseUrl: 'https://mkline.test', fetchImpl })
}

/** cn 日线信封：data.<wire>.qfqday = [[date, open, close, high, low, volume], …]（行序开收高低量）。 */
function cnDayEnvelope(wire: string, dates: readonly string[]): unknown {
  return {
    code: 0,
    msg: '',
    data: { [wire]: { qfqday: dates.map((d, i) => [d, '10.00', '10.50', '10.60', '9.90', String(1000 + i)]) } },
  }
}

/** bar 当日零点（UTC，与 klineDateToEpochMs 同口径）。 */
function utcDay(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d)
}

describe('tencent 往更早翻页游标（end = before 所在日 − 1 自然日）', () => {
  it('用户 日线给出往早游标时 end 槽填前一自然日（闭区间换算）', () => {
    // Given 一根日 K 的开盘时刻（UTC 当日零点）
    const barOpen = utcDay(2026, 9, 11)
    // When 做闭区间 → 严格早于的换算
    // Then end 为前一自然日（直接传 09-11 会重叠）
    expect(tencentEndDateForBefore(barOpen)).toBe('2026-09-10')
  })

  it('用户 跨周末时 end 仍取前一自然日（不感知交易日历）', () => {
    // Given 一个周一（周末后的首个交易日）
    const monday = utcDay(2026, 9, 14)
    // When 换算
    const end = tencentEndDateForBefore(monday)
    // Then 恰为前一日（周日），证明是自然日减法而非交易日回退
    expect(new Date(monday).getUTCDay()).toBe(1) // 2026-09-14 确为周一
    expect(end).toBe('2026-09-13')
  })

  it('用户 跨节假日时 end 取前一自然日而非前一交易日', () => {
    // Given 国庆长假后的首个交易日（2026-10-09）
    const barOpen = utcDay(2026, 10, 9)
    // When 换算
    const end = tencentEndDateForBefore(barOpen)
    // Then 得到 10-08（假期内的自然日）——证明不做交易日回退，仅做日期上界
    expect(end).toBe('2026-10-08')
  })

  it('用户 往早游标落在日界之内时 end 取当日（当日那根确实严格更早）', () => {
    // Given 某日 UTC 零点之后 1 小时的时刻（非日 K openTime）
    const midDay = utcDay(2026, 9, 11) + 3_600_000
    // When 换算
    // Then end 为当日（当日那根日 K 的 openTime = 零点 < 游标）
    expect(tencentEndDateForBefore(midDay)).toBe('2026-09-11')
  })

  it('用户 不给往早游标时日线请求保持原空槽模板（零回归）', async () => {
    // Given 一个记录请求的假 fetch
    const { fetchImpl, requests } = routeMock(cnDayEnvelope('sh600519', ['2026-09-10', '2026-09-11']))
    // When 不带 query 取数（既有调用形态）
    await client('cn', fetchImpl).getKlines('sh600519', '1d', 6)
    // Then URL 与改动前的 `param=sh600519,day,,,6,qfq` 逐字一致（start / end 两槽均空）
    expect(requests[0]?.url).toBe('https://tencent.test/appstock/app/fqkline/get?param=sh600519,day,,,6,qfq')
  })

  it('用户 日线往早游标经 URL 的 end 槽生效且返回升序', async () => {
    // Given 一个返回两根更早日 K 的假 fetch
    const { fetchImpl, requests } = routeMock(cnDayEnvelope('sh600519', ['2026-09-09', '2026-09-10']))
    // When 带 before=2026-09-11 取更早一页
    const klines = await client('cn', fetchImpl).getKlines('sh600519', '1d', 6, { before: utcDay(2026, 9, 11) })
    // Then end 槽为 2026-09-10、start 槽留空，且返回按时间升序
    expect(requests[0]?.url).toBe('https://tencent.test/appstock/app/fqkline/get?param=sh600519,day,,2026-09-10,6,qfq')
    expect(klines.map((k) => k.openTime)).toEqual([utcDay(2026, 9, 9), utcDay(2026, 9, 10)])
  })

  it('用户 港股日线同样以 end 槽翻页（hkfqkline 端点）', async () => {
    // Given 一个港股日线假 fetch（K 线 wire 用 `hk` 前缀）
    const { fetchImpl, requests } = routeMock(cnDayEnvelope('hk00700', ['2026-09-09']))
    // When 带 before 取更早一页
    await client('hk', fetchImpl).getKlines('00700', '1d', 6, { before: utcDay(2026, 9, 10) })
    // Then 命中 hkfqkline 端点且 end = 2026-09-09
    expect(requests[0]?.url).toBe('https://tencent.test/appstock/app/hkfqkline/get?param=hk00700,day,,2026-09-09,6,qfq')
  })

  it('用户 分钟线给出往早游标时如实拒绝（mkline 端点语义未实证）', async () => {
    // Given 一个不应被触达的假 fetch
    const { fetchImpl, requests } = routeMock(cnDayEnvelope('sh600519', []))
    // When / Then 5 分钟线带 before → 抛 TRADING_NOT_IMPLEMENTED，且不发请求（不静默返回最新页）
    await expect(client('cn', fetchImpl).getKlines('sh600519', '5m', 6, { before: utcDay(2026, 9, 11) }))
      .rejects.toMatchObject({ code: 'TRADING_NOT_IMPLEMENTED' })
    expect(requests).toHaveLength(0)
  })

  it('用户 给出非正整数的往早游标时被结构化拒绝', async () => {
    // Given 一个不应被触达的假 fetch
    const { fetchImpl } = routeMock(cnDayEnvelope('sh600519', []))
    // When / Then 0 / 负数 / 小数 游标一律结构化拒绝
    await expect(client('cn', fetchImpl).getKlines('sh600519', '1d', 6, { before: 0 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client('cn', fetchImpl).getKlines('sh600519', '1d', 6, { before: -1 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client('cn', fetchImpl).getKlines('sh600519', '1d', 6, { before: 2.5 }))
      .rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
  })

  it('用户 tencent 行情服务声明支持往更早翻页且页大小上界为 800', () => {
    // Given 一个 tencent 行情服务（client 用假 fetch，不触网）
    const { fetchImpl } = routeMock(cnDayEnvelope('sh600519', []))
    const service = new TencentMarketDataService({ get: () => undefined, reflect: { provide: () => {} } } as never, 'cn', { klineBaseUrl: 'https://tencent.test', fetchImpl })
    // When 读取能力声明
    const capability = service.getKlineHistoryCapability()
    // Then 声明支持、单请求上界 800（与 rest 的 count 帽同源）
    expect(capability.supportsEarlier).toBe(true)
    expect(capability.maxPageSize).toBe(800)
    expect(typeof capability.note).toBe('string')
  })
})
