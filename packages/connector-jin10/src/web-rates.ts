/**
 * 金十网页版「央行利率」取数（2026-09-15）。
 *
 * 官方 MCP 没有利率读数工具，而金十日历网页版（rili.jin10.com）有全量 30 家
 * 央行最新利率接口。本模块复刻网页版实际请求（bundle getInterestRate 逆向 +
 * 真实网络复核，见 spikes/impl-jin10-macro-rates/EVIDENCE.md）：
 *
 *   GET https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com/web/interest_rates
 *   headers: x-app-id: sKKYe29sFuJaeOCJ, x-version: 2.0
 *   响应   : { status: 200, message, data: { list: [{ id, bankName, flagImgUrl,
 *              interestRate, publishTime, fromIndicatorId?, fromIndicatorName? }], updated_at } }
 *
 * 与热度快讯（web-flash.ts）同款边界：非官方 MCP 契约的网页版公开接口，仅用于
 * GUI 读数；利率是数值元数据，无正文再分发问题。interestRate 保留上游原样字符串
 * （"2.5"/"0"），不做数值化——展示诚实优先。
 */
import { Jin10Error } from './errors.js'
import { regionOfFlagUrl } from './regions.js'

export const JIN10_RATES_ENDPOINT = 'https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com/web/interest_rates'
/** 网页版日历客户端 x-app-id / x-version（bundle 内常量，请求原样复刻）。 */
export const JIN10_RATES_APP_ID = 'sKKYe29sFuJaeOCJ'
export const JIN10_RATES_X_VERSION = '2.0'

/** 央行最新利率条目（地区由 flagImgUrl 文件名推断，未识别 = 空串）。 */
export interface Jin10RateEntry {
  readonly region: string
  readonly bankName: string
  /** 最新利率（上游原样字符串）。 */
  readonly rate: string
  /** 公布日（上游原样 YYYY-MM-DD）。 */
  readonly publishedAt: string
  /** 所属指标名（如「美联储利率决定(上限)」；部分央行上游缺省）。 */
  readonly indicatorName?: string
}

interface RateEntry {
  bankName?: unknown
  flagImgUrl?: unknown
  interestRate?: unknown
  publishTime?: unknown
  fromIndicatorName?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** 网页版条目 → Jin10RateEntry（缺央行名/利率/公布日的残条丢弃，绝不编数）。 */
export function parseWebRates(payload: unknown): Jin10RateEntry[] {
  if (!isRecord(payload)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 rates: unexpected payload (expected an object)')
  if (payload.status !== 200) {
    const message = typeof payload.message === 'string' && payload.message.length > 0 ? payload.message : 'unknown upstream error'
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 rates: upstream status ${String(payload.status)} — ${message}`)
  }
  const data = isRecord(payload.data) ? payload.data : undefined
  const list = data?.list
  if (!Array.isArray(list)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 rates: unexpected payload (expected data.list[])')
  const items: Jin10RateEntry[] = []
  for (const raw of list as RateEntry[]) {
    if (!isRecord(raw)) continue
    const bankName = text(raw.bankName)
    const rate = text(raw.interestRate)
    const publishedAt = text(raw.publishTime)
    if (bankName === undefined || rate === undefined || publishedAt === undefined) continue
    const region = typeof raw.flagImgUrl === 'string' ? regionOfFlagUrl(raw.flagImgUrl) : ''
    const indicatorName = text(raw.fromIndicatorName)
    items.push({ region, bankName, rate, publishedAt, ...(indicatorName !== undefined ? { indicatorName } : {}) })
  }
  return items
}

export async function fetchJin10Rates(
  fetchImpl: typeof globalThis.fetch,
  config: { timeoutMs: number },
): Promise<Jin10RateEntry[]> {
  const response = await fetchImpl(JIN10_RATES_ENDPOINT, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'x-app-id': JIN10_RATES_APP_ID,
      'x-version': JIN10_RATES_X_VERSION,
      referer: 'https://rili.jin10.com/',
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 rates: HTTP ${response.status}${body ? ` — ${body.slice(0, 160)}` : ''}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 rates: upstream returned non-JSON body')
  }
  return parseWebRates(parsed)
}
