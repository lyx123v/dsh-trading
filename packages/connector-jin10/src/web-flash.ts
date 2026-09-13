/**
 * 金十网页版「热度快讯」取数（2026-09-13）。
 *
 * 背景：官方 MCP 的 list_flash 不支持热度（inputSchema 只有 cursor，额外参数被上游
 * 以 unexpected additional properties 拒绝），条目也只有 content/time/url。而金十
 * **网页版**对快讯有 火/热/沸/爆 四级热度筛选，且是**服务端过滤**。本模块复刻网页版
 * 实际请求（从 www.jin10.com 前端 bundle 逆向 + 真实网络复核）：
 *
 *   GET https://3318fc142ea545eab931e22a61ec6e5c.z3c.jin10.com/flash?params=<JSON>
 *   headers: x-app-id: bVBF4FyRTn5NJF5n, x-version: 1.0, handleError: 1
 *   params : { channel:[1,5,9], hot:['热','爆'], max_time?, date? }
 *   响应   : { status, message, data:[{ id, time, data:{title,content,source,…}, hot, important, … }] }
 *
 * 与 MCP 是两套入口：本接口属网页版公开接口（非官方 MCP 契约），仅用于热度筛选。
 * 铁律 #5：只下发 title/time/url（+ hot 标签），正文 content 不取不再分发。
 */
import { Jin10Error } from './errors.js'
import { flashTitle, parseJin10Time, type Jin10NewsItem, type Jin10NewsPage } from './parse.js'

export const JIN10_WEB_FLASH_ENDPOINT = 'https://3318fc142ea545eab931e22a61ec6e5c.z3c.jin10.com/flash'
/** 网页版 x-app-id / x-version（bundle 内常量，网页版请求原样复刻）。 */
export const JIN10_WEB_APP_ID = 'bVBF4FyRTn5NJF5n'
export const JIN10_WEB_X_VERSION = '1.0'
/** 网页版快讯频道（bundle d.Xr = [1,5,9]）。 */
export const JIN10_WEB_FLASH_CHANNELS = [1, 5, 9] as const
/** 网页版单页条数（上游固定，无 pageSize 参数）。 */
export const JIN10_WEB_PAGE_SIZE = 50

/** 四级热度：1=火 2=热 3=沸 4=爆（bundle o）。数组顺序即网页版展示顺序。 */
export const JIN10_HEAT_LEVELS = ['火', '热', '沸', '爆'] as const
export type Jin10HeatLevel = (typeof JIN10_HEAT_LEVELS)[number]

export function isJin10HeatLevel(value: unknown): value is Jin10HeatLevel {
  return typeof value === 'string' && (JIN10_HEAT_LEVELS as readonly string[]).includes(value)
}

/** 热度快讯条目（比 MCP 快讯多一个 hot 标签）。 */
export interface Jin10FlashItem extends Jin10NewsItem {
  readonly hot?: string
}

export interface Jin10HotFlashOptions {
  hot: readonly Jin10HeatLevel[]
  /** 翻页游标 = 上一页最旧一条的网页版 time 原串（上游 max_time 语义）。 */
  cursor?: string | undefined
}

interface WebFlashEntry {
  id?: unknown
  time?: unknown
  hot?: unknown
  data?: { title?: unknown; content?: unknown } | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 网页版条目 → 本仓 NewsItem 形状（坏形状丢弃，绝不回退「现在」或臆造 url）。 */
export function parseWebFlashItems(payload: unknown): Jin10FlashItem[] {
  if (!isRecord(payload)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 hot-flash: unexpected payload (expected an object)')
  if (payload.status !== 200) {
    const message = typeof payload.message === 'string' && payload.message.length > 0 ? payload.message : 'unknown upstream error'
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 hot-flash: upstream status ${String(payload.status)} — ${message}`)
  }
  if (!Array.isArray(payload.data)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 hot-flash: unexpected payload (expected data[])')
  const items: Jin10FlashItem[] = []
  for (const raw of payload.data as WebFlashEntry[]) {
    if (!isRecord(raw)) continue
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const publishedAt = parseJin10Time(raw.time)
    if (id.length === 0 || publishedAt === undefined) continue
    const data = isRecord(raw.data) ? raw.data : undefined
    const content = typeof data?.content === 'string' ? data.content : ''
    const explicit = typeof data?.title === 'string' ? data.title.trim() : ''
    const title = explicit.length > 0 ? explicit : flashTitle(content)
    if (title === undefined) continue
    const hot = isJin10HeatLevel(raw.hot) ? raw.hot : undefined
    items.push({
      source: 'jin10',
      title,
      url: `https://flash.jin10.com/detail/${id}`,
      publishedAt,
      ...(hot !== undefined ? { hot } : {}),
    })
  }
  return items
}

/**
 * 按热度取快讯（服务端过滤）。上游单页 50 条，max_time 翻页；
 * hasMore 以「满页」判断，nextCursor = 本页最旧一条的 time 原串。
 */
export async function fetchJin10HotFlash(
  fetchImpl: typeof globalThis.fetch,
  options: Jin10HotFlashOptions,
  config: { timeoutMs: number },
): Promise<Jin10NewsPage<Jin10FlashItem>> {
  const hot = options.hot.filter(isJin10HeatLevel)
  if (hot.length === 0) throw new Jin10Error('TRADING_UNKNOWN', 'jin10 hot-flash: hot must contain at least one of 火/热/沸/爆')
  const params: Record<string, unknown> = { channel: [...JIN10_WEB_FLASH_CHANNELS], hot }
  if (options.cursor !== undefined && options.cursor.length > 0) params.max_time = options.cursor
  const url = new URL(JIN10_WEB_FLASH_ENDPOINT)
  url.searchParams.set('params', JSON.stringify(params))
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'x-app-id': JIN10_WEB_APP_ID,
      'x-version': JIN10_WEB_X_VERSION,
      handleError: '1',
      referer: 'https://www.jin10.com/',
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 hot-flash: HTTP ${response.status}${body ? ` — ${body.slice(0, 160)}` : ''}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 hot-flash: upstream returned non-JSON body')
  }
  // parseWebFlashItems 已校验 status/data 形状
  const items = parseWebFlashItems(parsed)
  const rawData = (parsed as { data: WebFlashEntry[] }).data
  const oldest = rawData[rawData.length - 1]
  const cursor = typeof oldest?.time === 'string' ? oldest.time : undefined
  return {
    items,
    hasMore: items.length >= JIN10_WEB_PAGE_SIZE,
    ...(cursor !== undefined ? { nextCursor: cursor } : {}),
  }
}
