/**
 * 金十网页版热度快讯取数单测（mock fetch，不触真实网络）。
 * 覆盖：params 构造（channel/hot/max_time）、条目解析（标题回退/坏形状丢弃/正文不下发）、
 * 满页 hasMore、空 hot 与上游错误。
 */
import { describe, expect, it } from 'vitest'
import { Jin10Error } from '../src/errors.js'
import { JIN10_HEAT_LEVELS, fetchJin10HotFlash, parseWebFlashItems } from '../src/web-flash.js'

type Resp = Response
function webFetch(body: unknown, capture?: (url: URL) => void, status = 200): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(String(input))
    capture?.(url)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
}

describe('fetchJin10HotFlash（金十网页版热度快讯）', () => {
  it('构造 params：channel[1,5,9] + hot；解析条目只留 title/time/url/hot，正文不下发', async () => {
    let seen: URL | undefined
    const page = await fetchJin10HotFlash(webFetch({
      status: 200,
      message: '',
      data: [
        { id: '20260913111053145800', time: '2026-09-13 11:10:53', hot: '热', data: { title: '', content: '【伊朗总统：伊朗与沙特并不处于战争状态】正文不下发' } },
        { id: '20260913090253381800', time: '2026-09-13 09:02:53', hot: '爆', data: { title: '英国海事机构：一船只在霍尔木兹海峡遭袭', content: '正文' } },
        { id: 'bad-id', time: 'not-a-time', hot: '热', data: { title: '坏时间', content: 'x' } },
        { id: 'no-title', time: '2026-09-13 08:00:00', hot: '', data: { content: '' } },
      ],
    }, (url) => { seen = url }), { hot: ['热', '爆'] }, { timeoutMs: 1000 })

    const params = JSON.parse(seen?.searchParams.get('params') ?? '{}') as { channel?: unknown; hot?: unknown }
    expect(params.channel).toEqual([1, 5, 9])
    expect(params.hot).toEqual(['热', '爆'])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBe('2026-09-13 08:00:00')
    expect(page.items).toEqual([
      { source: 'jin10', title: '伊朗总统：伊朗与沙特并不处于战争状态', url: 'https://flash.jin10.com/detail/20260913111053145800', publishedAt: '2026-09-13T03:10:53.000Z', hot: '热' },
      { source: 'jin10', title: '英国海事机构：一船只在霍尔木兹海峡遭袭', url: 'https://flash.jin10.com/detail/20260913090253381800', publishedAt: '2026-09-13T01:02:53.000Z', hot: '爆' },
    ])
    expect(JSON.stringify(page)).not.toContain('正文不下发')
  })

  it('cursor → max_time；满页（50）→ hasMore=true', async () => {
    let seen: URL | undefined
    const data = Array.from({ length: 50 }, (_, index) => ({ id: `id${index}`, time: '2026-09-13 10:00:00', hot: '爆', data: { title: `t${index}`, content: 'c' } }))
    const page = await fetchJin10HotFlash(webFetch({ status: 200, data }, (url) => { seen = url }), { hot: ['爆'], cursor: '2026-09-12 00:01:09' }, { timeoutMs: 1000 })
    const params = JSON.parse(seen?.searchParams.get('params') ?? '{}') as { max_time?: unknown }
    expect(params.max_time).toBe('2026-09-12 00:01:09')
    expect(page.hasMore).toBe(true)
  })

  it('热度词汇固定为 火/热/沸/爆', () => {
    expect([...JIN10_HEAT_LEVELS]).toEqual(['火', '热', '沸', '爆'])
  })

  it('空 hot / 上游非 200 / 未知等级 → 抛 Jin10Error', async () => {
    await expect(fetchJin10HotFlash(webFetch({ status: 200, data: [] }), { hot: [] }, { timeoutMs: 1000 })).rejects.toBeInstanceOf(Jin10Error)
    await expect(fetchJin10HotFlash(webFetch({ status: 401, message: '请重新登录', data: null }), { hot: ['热'] }, { timeoutMs: 1000 })).rejects.toThrow(/upstream status 401/)
    // HTTP 层非 2xx
    await expect(fetchJin10HotFlash(webFetch({ status: 500, data: [] }, undefined, 500), { hot: ['热'] }, { timeoutMs: 1000 })).rejects.toThrow(/HTTP 500/)
  })

  it('parseWebFlashItems：status≠200 / data 非数组 → 抛错（坏形状不静默吞）', () => {
    expect(() => parseWebFlashItems({ status: 500, message: 'boom', data: null })).toThrow(Jin10Error)
    expect(() => parseWebFlashItems({ status: 200, data: 'nope' })).toThrow(Jin10Error)
  })
})
