/**
 * 上游 payload → 本仓契约形状的纯解析层。
 *
 * 纪律（对齐 kit-cn news 的既有口径）：
 *   - 数据零再分发（README 铁律）：快讯/资讯只取**元数据**（标题/时间/链接 + 文章导语），
 *     正文（flash.content / news.content）不下发、不落盘；
 *   - 时间解析失败一律丢弃该条，绝不回退「现在」（虚假新鲜事件会恒过时间窗）；
 *   - 形状异常抛错而非静默返回空数组（「上游挂了」与「真没有数据」必须可区分）。
 */
import type { NewsItem } from '@dshtrading/api'
import { Jin10Error } from './errors.js'

/** 快讯/资讯条目（NewsItem 契约 + 金十来源标识）。 */
export interface Jin10NewsItem extends NewsItem {
  readonly source: 'jin10'
}

/** 资讯文章摘要条目（带 id，供 news_get 下钻）。 */
export interface Jin10ArticleSummary extends Jin10NewsItem {
  readonly id: string
}

export interface Jin10NewsPage<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

export interface Jin10ArticleDetail {
  id: string
  title: string
  url: string
  publishedAt: string
  introduction?: string
}

export interface Jin10CalendarEntry {
  publishedAt: string
  star: number
  title: string
  previous?: string
  consensus?: string
  actual?: string
  revised?: string
  affect?: string
}

export interface Jin10Instrument {
  code: string
  name: string
}

export interface Jin10Quote {
  code: string
  name?: string
  time?: string
  open?: number
  close?: number
  high?: number
  low?: number
  volume?: number
  change?: number
  changePercent?: number
}

export interface Jin10Kline {
  time: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

/** 快讯标题：【标题】正文 → 取括号内；无括号 → 首段文本截断（正文绝不下发）。 */
export function flashTitle(content: string, maxLength = 120): string | undefined {
  const text = content.trim()
  if (text.length === 0) return undefined
  const bracketed = /^【([^】]+)】/.exec(text)
  const raw = bracketed?.[1] ?? text.replace(/\s+/g, ' ').split('。')[0] ?? text
  const title = raw.trim()
  if (title.length === 0) return undefined
  return title.length > maxLength ? `${title.slice(0, maxLength)}…` : title
}

/** 金十时间 → ISO：既吃 ISO（带 +08:00 偏移），也吃财经日历的无时区本地格式（按东八区解释）。 */
export function parseJin10Time(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  // 无时区的本地格式（财经日历 pub_time）：`YYYY-MM-DD HH:MM[:SS]`，按东八区解释。
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(text)
  const candidate = local === null
    ? text
    : `${local[1] ?? ''}T${local[2] ?? ''}:${local[3] ?? '00'}+08:00`
  const ms = Date.parse(candidate)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return value.trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function payloadItems(data: unknown, context: string): unknown[] {
  if (!isRecord(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 ${context}: unexpected payload (expected an object with items[])`)
  const items = data.items
  if (!Array.isArray(items)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 ${context}: unexpected payload (expected data.items[])`)
  return items
}

function pageMeta(data: unknown): { nextCursor?: string; hasMore: boolean } {
  const record = isRecord(data) ? data : {}
  const cursor = record.next_cursor
  return {
    ...(typeof cursor === 'string' && cursor.length > 0 ? { nextCursor: cursor } : {}),
    hasMore: record.has_more === true,
  }
}

function capItems<T>(items: T[], limit?: number): T[] {
  if (limit === undefined || items.length <= limit) return items
  return items.slice(0, limit)
}

/** list_flash / search_flash 条目 → NewsItem（正文丢弃，只留标题/时间/链接）。 */
export function parseFlashItems(data: unknown, context = 'list_flash', limit?: number): Jin10NewsItem[] {
  const items: Jin10NewsItem[] = []
  for (const entry of payloadItems(data, context)) {
    if (!isRecord(entry)) continue
    const title = typeof entry.content === 'string' ? flashTitle(entry.content) : undefined
    const publishedAt = parseJin10Time(entry.time)
    const url = text(entry.url)
    if (title === undefined || publishedAt === undefined || url === undefined) continue
    items.push({ source: 'jin10', title, url, publishedAt })
  }
  return capItems(items, limit)
}

export function parseFlashPage(data: unknown, context = 'list_flash', limit?: number): Jin10NewsPage<Jin10NewsItem> {
  const meta = pageMeta(data)
  return { items: parseFlashItems(data, context, limit), ...meta }
}

/** list_news / search_news 条目 → 文章摘要（id/title/时间/链接）。 */
export function parseNewsItems(data: unknown, context = 'list_news', limit?: number): Jin10ArticleSummary[] {
  const items: Jin10ArticleSummary[] = []
  for (const entry of payloadItems(data, context)) {
    if (!isRecord(entry)) continue
    const id = text(entry.id)
    const title = text(entry.title)
    const publishedAt = parseJin10Time(entry.time)
    const url = text(entry.url)
    if (id === undefined || title === undefined || publishedAt === undefined || url === undefined) continue
    items.push({ source: 'jin10', id, title, url, publishedAt })
  }
  return capItems(items, limit)
}

export function parseNewsPage(data: unknown, context = 'list_news', limit?: number): Jin10NewsPage<Jin10ArticleSummary> {
  const meta = pageMeta(data)
  return { items: parseNewsItems(data, context, limit), ...meta }
}

/** get_news 详情：导语（introduction）作摘要下发；正文 content 按铁律 #5 丢弃。 */
export function parseArticle(data: unknown): Jin10ArticleDetail {
  if (!isRecord(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_news: unexpected payload (expected an object)')
  const id = text(data.id)
  const title = text(data.title)
  const url = text(data.url)
  const publishedAt = parseJin10Time(data.time)
  if (id === undefined || title === undefined || url === undefined || publishedAt === undefined) {
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_news: unexpected payload (missing id/title/url/time)')
  }
  const introduction = text(data.introduction)
  return { id, title, url, publishedAt, ...(introduction !== undefined ? { introduction } : {}) }
}

/** list_calendar：data 为数组；pub_time 无时区，按东八区解释。 */
export function parseCalendar(data: unknown, limit?: number): Jin10CalendarEntry[] {
  if (!Array.isArray(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 list_calendar: unexpected payload (expected an array)')
  const entries: Jin10CalendarEntry[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    const title = text(entry.title)
    const publishedAt = parseJin10Time(entry.pub_time)
    if (title === undefined || publishedAt === undefined) continue
    const star = numberValue(entry.star)
    const previous = text(entry.previous)
    const consensus = text(entry.consensus)
    const actual = text(entry.actual)
    const revised = text(entry.revised)
    const affect = text(entry.affect_txt)
    entries.push({
      publishedAt,
      star: star ?? 0,
      title,
      ...(previous !== undefined ? { previous } : {}),
      ...(consensus !== undefined ? { consensus } : {}),
      ...(actual !== undefined ? { actual } : {}),
      ...(revised !== undefined ? { revised } : {}),
      ...(affect !== undefined ? { affect } : {}),
    })
  }
  return capItems(entries, limit)
}

/** quote://codes 资源正文 → 品种表（`{data:[{code,name}]}`）。 */
export function parseQuoteCodes(resourceText: string): Jin10Instrument[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(resourceText)
  } catch {
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 quote://codes: resource is not valid JSON')
  }
  const data = isRecord(parsed) ? parsed.data : parsed
  if (!Array.isArray(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 quote://codes: unexpected payload (expected data[])')
  const instruments: Jin10Instrument[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    const code = text(entry.code)
    if (code === undefined) continue
    instruments.push({ code, name: text(entry.name) ?? code })
  }
  return instruments
}

/** get_quote：价格字段是字符串，转数字；code 缺失视为形状异常。 */
export function parseQuote(data: unknown): Jin10Quote {
  if (!isRecord(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_quote: unexpected payload (expected an object)')
  const code = text(data.code)
  if (code === undefined) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_quote: unexpected payload (missing code)')
  const name = text(data.name)
  const time = parseJin10Time(data.time)
  const open = numberValue(data.open)
  const close = numberValue(data.close)
  const high = numberValue(data.high)
  const low = numberValue(data.low)
  const volume = numberValue(data.volume)
  const change = numberValue(data.ups_price)
  const changePercent = numberValue(data.ups_percent)
  return {
    code,
    ...(name !== undefined ? { name } : {}),
    ...(time !== undefined ? { time } : {}),
    ...(open !== undefined ? { open } : {}),
    ...(close !== undefined ? { close } : {}),
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(change !== undefined ? { change } : {}),
    ...(changePercent !== undefined ? { changePercent } : {}),
  }
}

/** get_kline：分钟级数组（time 为秒级时间戳）；空数组是合法结果（窗口内无数据）。 */
export function parseKlines(data: unknown, limit?: number): Jin10Kline[] {
  if (!isRecord(data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_kline: unexpected payload (expected an object)')
  const raw = data.klines
  if (!Array.isArray(raw)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 get_kline: unexpected payload (expected data.klines[])')
  const klines: Jin10Kline[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const time = numberValue(entry.time)
    if (time === undefined) continue
    const open = numberValue(entry.open)
    const high = numberValue(entry.high)
    const low = numberValue(entry.low)
    const close = numberValue(entry.close)
    const volume = numberValue(entry.volume)
    if (open === undefined && high === undefined && low === undefined && close === undefined) continue
    klines.push({
      time,
      ...(open !== undefined ? { open } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(close !== undefined ? { close } : {}),
      ...(volume !== undefined ? { volume } : {}),
    })
  }
  klines.sort((a, b) => a.time - b.time)
  return capItems(klines, limit)
}
