/**
 * 取数层：把 MCP 工具名（list_flash / search_flash / list_news / search_news / get_news /
 * list_calendar / get_quote / get_kline）与 quote://codes 资源封装成本仓语义的读法，
 * 分页统一 `cursor → data.next_cursor / data.has_more`（用户契约 5）。
 *
 * 工具名与参数不对外泄漏到 agent 面：工具面用业务命名（tools.ts），provider 可替换。
 */
import { Jin10Error } from './errors.js'
import { DEFAULT_TIMEOUT_MS, type Jin10McpClient } from './mcp.js'
import { fetchJin10HotFlash, type Jin10FlashItem, type Jin10HeatLevel } from './web-flash.js'
import {
  parseArticle,
  parseCalendar,
  parseFlashPage,
  parseFlashItems,
  parseKlines,
  parseNewsPage,
  parseQuote,
  parseQuoteCodes,
  type Jin10ArticleDetail,
  type Jin10ArticleSummary,
  type Jin10CalendarEntry,
  type Jin10Instrument,
  type Jin10Kline,
  type Jin10NewsItem,
  type Jin10NewsPage,
  type Jin10Quote,
} from './parse.js'

/** 快讯/资讯单页上限（上游 list_* 每页 20 条；search_flash 一次性最多 150 条且不可翻页）。 */
export const FLASH_PAGE_SIZE = 20
export const SEARCH_FLASH_MAX = 150
/** 品种代码表缓存 TTL（静态名册，按小时级缓存；失败不缓存，下次调用重试）。 */
export const INSTRUMENT_CACHE_TTL_MS = 3_600_000

export interface Jin10PageOptions {
  cursor?: string | undefined
  limit?: number | undefined
}

export class Jin10Service {
  private readonly client: Jin10McpClient
  private readonly webFetch: typeof globalThis.fetch
  private readonly webTimeoutMs: number
  private instruments: { at: number; items: Jin10Instrument[] } | undefined

  constructor(client: Jin10McpClient, web: { fetchImpl?: typeof globalThis.fetch | undefined; timeoutMs?: number | undefined } = {}) {
    this.client = client
    this.webFetch = web.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.webTimeoutMs = web.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * 按热度取快讯（金十网页版服务端过滤，火/热/沸/爆）：官方 MCP 的 list_flash
   * 无热度参数，故热度路径走网页版接口（见 web-flash.ts）。cursor = 上一页
   * 最旧一条的 time 原串。
   */
  async listFlashByHeat(options: { hot: readonly Jin10HeatLevel[]; cursor?: string | undefined }): Promise<Jin10NewsPage<Jin10FlashItem>> {
    return fetchJin10HotFlash(this.webFetch, { hot: options.hot, cursor: options.cursor }, { timeoutMs: this.webTimeoutMs })
  }

  /** 最新快讯流（cursor 翻页；正文不下发，只留标题/时间/链接）。 */
  async listFlash(options: Jin10PageOptions = {}): Promise<Jin10NewsPage<Jin10NewsItem>> {
    const data = await this.client.callToolData('list_flash', options.cursor === undefined ? {} : { cursor: options.cursor })
    return parseFlashPage(data, 'list_flash', options.limit)
  }

  /** 关键词搜快讯：上游一次性返回（最多 150 条，不支持翻页），故无 cursor。 */
  async searchFlash(keyword: string, limit?: number): Promise<Jin10NewsItem[]> {
    const trimmed = requireKeyword(keyword)
    const cap = Math.min(limit ?? SEARCH_FLASH_MAX, SEARCH_FLASH_MAX)
    const data = await this.client.callToolData('search_flash', { keyword: trimmed })
    return parseFlashItems(data, 'search_flash', cap)
  }

  async listNews(options: Jin10PageOptions = {}): Promise<Jin10NewsPage<Jin10ArticleSummary>> {
    const data = await this.client.callToolData('list_news', options.cursor === undefined ? {} : { cursor: options.cursor })
    return parseNewsPage(data, 'list_news', options.limit)
  }

  async searchNews(keyword: string, options: Jin10PageOptions = {}): Promise<Jin10NewsPage<Jin10ArticleSummary>> {
    const trimmed = requireKeyword(keyword)
    const args: Record<string, unknown> = { keyword: trimmed }
    if (options.cursor !== undefined) args.cursor = options.cursor
    const data = await this.client.callToolData('search_news', args)
    return parseNewsPage(data, 'search_news', options.limit)
  }

  /** 文章详情：标题/导语/时间/链接（正文按铁律 #5 不下发）。 */
  async getArticle(id: string): Promise<Jin10ArticleDetail> {
    const trimmed = (id ?? '').trim()
    if (trimmed.length === 0) throw new Jin10Error('TRADING_UNKNOWN', 'jin10 news_get: id is required')
    return parseArticle(await this.client.callToolData('get_news', { id: trimmed }))
  }

  /** 本周财经日历（周一~周日；上游一次返回整周）。 */
  async listCalendar(limit?: number): Promise<Jin10CalendarEntry[]> {
    return parseCalendar(await this.client.callToolData('list_calendar', {}), limit)
  }

  /** 品种名册（quote://codes 资源）；query 按代码或中文名过滤。 */
  async listInstruments(query?: string): Promise<Jin10Instrument[]> {
    const items = await this.instrumentCatalog()
    const needle = query?.trim().toLowerCase()
    if (needle === undefined || needle.length === 0) return items
    return items.filter((item) => item.code.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle))
  }

  async getQuote(code: string): Promise<Jin10Quote> {
    const trimmed = requireCode(code)
    return parseQuote(await this.client.callToolData('get_quote', { code: trimmed }))
  }

  /** 分钟级 K 线：`time` = 起始秒级时间戳（从此往后取，窗口 24h 内），count ≤ 100。 */
  async getKlines(code: string, options: { time?: number | undefined; count?: number | undefined } = {}): Promise<Jin10Kline[]> {
    const trimmed = requireCode(code)
    const args: Record<string, unknown> = { code: trimmed }
    if (options.time !== undefined) {
      if (!Number.isInteger(options.time) || options.time <= 0) throw new Jin10Error('TRADING_UNKNOWN', 'jin10 global_klines: time must be a positive Unix timestamp in seconds')
      args.time = options.time
    }
    if (options.count !== undefined) {
      if (!Number.isInteger(options.count) || options.count < 1 || options.count > 100) throw new Jin10Error('TRADING_UNKNOWN', 'jin10 global_klines: count must be an integer from 1 to 100')
      args.count = options.count
    }
    return parseKlines(await this.client.callToolData('get_kline', args), options.count)
  }

  private async instrumentCatalog(): Promise<Jin10Instrument[]> {
    const cached = this.instruments
    if (cached !== undefined && Date.now() - cached.at < INSTRUMENT_CACHE_TTL_MS) return cached.items
    const items = parseQuoteCodes(await this.client.readResource('quote://codes'))
    this.instruments = { at: Date.now(), items }
    return items
  }
}

function requireKeyword(keyword: string): string {
  const trimmed = (keyword ?? '').trim()
  if (trimmed.length === 0) throw new Jin10Error('TRADING_UNKNOWN', 'jin10 search: keyword is required')
  return trimmed
}

function requireCode(code: string): string {
  const trimmed = (code ?? '').trim()
  if (trimmed.length === 0) throw new Jin10Error('TRADING_UNSUPPORTED_SYMBOL', 'jin10 quote: code is required (see the global_instruments tool for the code space)')
  return trimmed
}
