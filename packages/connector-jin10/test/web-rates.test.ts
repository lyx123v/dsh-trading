/**
 * 金十网页版央行利率取数单测（mock fetch，不触真实网络）。
 * 覆盖：地区推断（flag 文件名）、残条丢弃、上游错误、请求头形状。
 */
import { describe, expect, it } from 'vitest'
import { Jin10Error } from '../src/errors.js'
import { regionOfFlagUrl, regionOfTitle } from '../src/regions.js'
import { JIN10_RATES_APP_ID, fetchJin10Rates, parseWebRates } from '../src/web-rates.js'

function webFetch(body: unknown, capture?: (url: URL, init: RequestInit) => void, status = 200): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input))
    capture?.(url, init ?? {})
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
}

const PAYLOAD = {
  status: 200,
  message: 'OK',
  data: {
    updated_at: '2026-09-15T05:08:00.032Z',
    list: [
      { id: 1, bankName: '美国联邦储备局', flagImgUrl: '//cdn.jin10.com/assets/img/commons/flag/美国.png', interestRate: '3.75', publishTime: '2025-12-11', fromIndicatorId: 77, fromIndicatorName: '美联储利率决定(上限)' },
      { id: 2, bankName: '日本央行', flagImgUrl: '//cdn.jin10.com/assets/img/commons/flag/日本.png', interestRate: '1', publishTime: '2026-06-16', fromIndicatorName: '央行目标利率（上限）' },
      { id: 3, bankName: '中国人民银行', flagImgUrl: '//cdn.jin10.com/assets/img/commons/flag/中国.png', interestRate: '3', publishTime: '2025-05-20' },
      { id: 4, bankName: '缺利率', flagImgUrl: '', interestRate: '', publishTime: '2025-01-01' },
    ],
  },
}

describe('parseWebRates（央行利率解析）', () => {
  it('条目只留地区/央行/利率/公布日/指标名；残条丢弃', () => {
    const items = parseWebRates(PAYLOAD)
    expect(items).toEqual([
      { region: '美国', bankName: '美国联邦储备局', rate: '3.75', publishedAt: '2025-12-11', indicatorName: '美联储利率决定(上限)' },
      { region: '日本', bankName: '日本央行', rate: '1', publishedAt: '2026-06-16', indicatorName: '央行目标利率（上限）' },
      { region: '中国', bankName: '中国人民银行', rate: '3', publishedAt: '2025-05-20' },
    ])
  })

  it('status 非 200 / 缺 data.list → 抛 Jin10Error（上游挂 ≠ 没有利率）', () => {
    expect(() => parseWebRates({ status: 401, message: '请重新登录' })).toThrow(Jin10Error)
    expect(() => parseWebRates({ status: 200, data: {} })).toThrow(/data\.list/)
  })

  it('地区推断：flag 文件名去扩展名；标题前缀按长名优先', () => {
    expect(regionOfFlagUrl('//cdn.jin10.com/assets/img/commons/flag/欧元区.png')).toBe('欧元区')
    expect(regionOfFlagUrl('')).toBe('')
    expect(regionOfTitle('日本8月外汇储备(亿美元)')).toBe('日本')
    expect(regionOfTitle('印度尼西亚Q2 GDP同比')).toBe('印度尼西亚')
    expect(regionOfTitle('欧佩克+部长级会议')).toBe('')
  })
})

describe('fetchJin10Rates（网页版利率接口）', () => {
  it('请求形状：GET + x-app-id/x-version 头；返回解析条目', async () => {
    let seenInit: RequestInit | undefined
    const items = await fetchJin10Rates(webFetch(PAYLOAD, (_url, init) => { seenInit = init }), { timeoutMs: 1000 })
    const headers = new Headers(seenInit?.headers)
    expect(headers.get('x-app-id')).toBe(JIN10_RATES_APP_ID)
    expect(headers.get('x-version')).toBe('2.0')
    expect(items).toHaveLength(3)
  })

  it('HTTP 非 200 → 抛 Jin10Error', async () => {
    await expect(fetchJin10Rates(webFetch({}, undefined, 502), { timeoutMs: 1000 })).rejects.toThrow(/HTTP 502/)
  })
})
