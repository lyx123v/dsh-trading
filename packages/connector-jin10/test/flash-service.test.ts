import { describe, expect, it } from 'vitest'
import { TRADING_FLASH_FEED_KEY, createJin10FlashFeed } from '../src/flash-service.js'
import { Jin10McpClient } from '../src/mcp.js'
import { Jin10Service } from '../src/service.js'

function stubFetch(): typeof fetch {
  return (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; id?: number; params?: { name?: string } }
    const sse = (payload: unknown) => new Response('event: message\ndata: ' + JSON.stringify(payload) + '\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    if (body.method === 'initialize') return sse({ jsonrpc: '2.0', id: body.id, result: {} })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const name = String(body.params?.name ?? '')
    const data = name === 'list_flash'
      ? { has_more: true, items: [{ content: '【快讯标题】正文不下发', time: '2026-09-13T09:00:00+08:00', url: 'https://flash.jin10.com/detail/1' }], next_cursor: 'c1' }
      : { items: [{ content: '【命中标题】正文不下发', time: '2026-09-13T09:00:00+08:00', url: 'https://flash.jin10.com/detail/2' }] }
    return sse({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { status: 200, message: '', data } } })
  }) as typeof fetch
}

function makeFeed() {
  return createJin10FlashFeed(new Jin10Service(new Jin10McpClient({ token: () => 'sk-test', fetchImpl: stubFetch() })))
}

describe('createJin10FlashFeed（GUI 桥与工具面共用取数）', () => {
  it('服务键固定 tradingFlashFeed（桥按该键解析）', () => {
    expect(TRADING_FLASH_FEED_KEY).toBe('tradingFlashFeed')
  })

  it('listFlash：透传 cursor/hasMore，条目只留标题/时间/链接（正文不下发）', async () => {
    const page = await makeFeed().listFlash({ limit: 5 })
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('c1')
    expect(page.items).toEqual([{
      source: 'jin10',
      title: '快讯标题',
      url: 'https://flash.jin10.com/detail/1',
      publishedAt: '2026-09-13T01:00:00.000Z',
    }])
    expect(JSON.stringify(page)).not.toContain('正文不下发')
  })

  it('searchFlash：关键词搜索（上游一次性返回，无翻页语义）', async () => {
    const items = await makeFeed().searchFlash('黄金', 3)
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('命中标题')
  })
})
