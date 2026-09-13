import { describe, expect, it } from 'vitest'
import {
  MAX_FLASH_LIMIT,
  TradingBridge,
  createBridgeHost,
  dispatchBridgeRequest,
  type FlashFeedLike,
} from '../src/bridge.ts'

const ITEM = {
  source: 'jin10',
  title: '快讯标题',
  url: 'https://flash.jin10.com/detail/1',
  publishedAt: '2026-09-13T01:00:00.000Z',
} as const

function makeBridge(flashFeed?: FlashFeedLike): TradingBridge {
  return new TradingBridge(createBridgeHost({ legacy: () => undefined, flashFeed }))
}

const FEED: FlashFeedLike = {
  listFlash: async (options) => ({ items: [ITEM], hasMore: true, nextCursor: options?.cursor === undefined ? 'c1' : 'c2' }),
  searchFlash: async (keyword) => [{ ...ITEM, title: 'hit:' + keyword }],
}

describe('桥 /flash（跨市场快讯，金十接入）', () => {
  it('最新流：回元数据条目 + nextCursor + hasMore', async () => {
    const wire = await makeBridge(FEED).flash(null, '10', null)
    expect(wire).toEqual({ ok: true, items: [ITEM], hasMore: true, nextCursor: 'c1' })
  })

  it('cursor 翻页透传；keyword 走搜索且 hasMore=false', async () => {
    const next = await makeBridge(FEED).flash('c1', '10', null)
    expect(next.nextCursor).toBe('c2')
    const hit = await makeBridge(FEED).flash(null, '5', '美联储')
    expect(hit.items[0]?.title).toBe('hit:美联储')
    expect(hit.hasMore).toBe(false)
    expect(hit.nextCursor).toBeUndefined()
  })

  it('limit 越界 → 协议 400（不静默截断）', async () => {
    await expect(makeBridge(FEED).flash(null, String(MAX_FLASH_LIMIT + 1), null)).rejects.toMatchObject({ status: 400 })
    await expect(makeBridge(FEED).flash(null, '0', null)).rejects.toMatchObject({ status: 400 })
  })

  it('数据源缺席 → TRADING_NOT_IMPLEMENTED（不是空列表）', async () => {
    await expect(makeBridge(undefined).flash(null, null, null)).rejects.toMatchObject({ code: 'TRADING_NOT_IMPLEMENTED' })
  })

  it('dispatchBridgeRequest GET /flash 透传 query 参数', async () => {
    const { status, payload } = await dispatchBridgeRequest(makeBridge(FEED), 'GET', '/flash', new URLSearchParams({ cursor: 'c1', limit: '7' }))
    expect(status).toBe(200)
    expect(payload).toMatchObject({ ok: true, hasMore: true })
  })
})
