import { describe, expect, it } from 'vitest'
import {
  flashTitle,
  parseArticle,
  parseCalendar,
  parseFlashItems,
  parseFlashPage,
  parseJin10Time,
  parseKlines,
  parseNewsPage,
  parseQuote,
  parseQuoteCodes,
} from '../src/parse.js'

const FLASH = {
  content: '【美媒：卡尼拟推动加拿大成为欧盟“准成员国”，以减少对美依赖】金十数据9月13日讯，据《华尔街日报》报道，加拿大总理马克·卡尼正推动一项大胆提议。',
  time: '2026-09-13T09:13:49+08:00',
  url: 'https://flash.jin10.com/detail/20260913091349991800',
}

const ARTICLE = {
  id: '229952',
  introduction: '美日英三大央行即将登场！',
  time: '2026-09-12T22:15:26+08:00',
  title: '一周展望：超级央行周来袭！',
  url: 'https://xnews.jin10.com/details/229952',
}

describe('flashTitle（正文不下发，只取标题语义）', () => {
  it('取【】内标题', () => {
    expect(flashTitle('【英国海事机构：一船只在霍尔木兹海峡遭袭】金十数据9月13日讯，详情……')).toBe('英国海事机构：一船只在霍尔木兹海峡遭袭')
  })

  it('无【】时取首句并压平空白', () => {
    expect(flashTitle('国内新闻：\n1. 中国证监会发布《期货公司监督管理办法》。\n2. 其他')).toBe('国内新闻： 1. 中国证监会发布《期货公司监督管理办法》')
  })

  it('超长标题截断，空文本返回 undefined', () => {
    expect(flashTitle('【' + '长'.repeat(200) + '】x')).toHaveLength(121)
    expect(flashTitle('   ')).toBeUndefined()
  })
})

describe('parseJin10Time（失败即丢弃，绝不回退现在）', () => {
  it('ISO 带偏移直接解析', () => {
    expect(parseJin10Time('2026-09-13T09:13:49+08:00')).toBe('2026-09-13T01:13:49.000Z')
  })

  it('财经日历无时区格式按东八区解释（含秒与不含秒）', () => {
    expect(parseJin10Time('2026-09-07 07:50')).toBe('2026-09-06T23:50:00.000Z')
    expect(parseJin10Time('2026-09-07 07:50:30')).toBe('2026-09-06T23:50:30.000Z')
  })

  it('非法输入返回 undefined', () => {
    expect(parseJin10Time('not a time')).toBeUndefined()
    expect(parseJin10Time('')).toBeUndefined()
    expect(parseJin10Time(undefined)).toBeUndefined()
    expect(parseJin10Time(1789244909607)).toBeUndefined()
  })
})

describe('parseFlashPage / parseFlashItems', () => {
  it('列表条目映射为 NewsItem 元数据 + 分页字段', () => {
    const page = parseFlashPage({ has_more: true, items: [FLASH], next_cursor: '1789244909607' })
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('1789244909607')
    expect(page.items).toEqual([{
      source: 'jin10',
      title: '美媒：卡尼拟推动加拿大成为欧盟“准成员国”，以减少对美依赖',
      url: FLASH.url,
      publishedAt: '2026-09-13T01:13:49.000Z',
    }])
    expect('content' in page.items[0]!).toBe(false)
  })

  it('时间/链接/标题任一缺失即丢弃该条并截尾 limit', () => {
    const items = parseFlashItems({
      items: [
        { content: '【A】x', time: 'bad', url: 'https://a' },
        { content: '【B】x', time: FLASH.time, url: '' },
        { content: '   ', time: FLASH.time, url: 'https://c' },
        { content: '【D】x', time: FLASH.time, url: 'https://d' },
      ],
    }, 'list_flash', 1)
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('D')
  })

  it('items 缺失是形状异常，不是空列表', () => {
    expect(() => parseFlashItems({ has_more: false })).toThrow(/expected data\.items\[\]/)
  })
})

describe('parseNewsPage / parseArticle', () => {
  it('文章摘要带 id，分页字段统一 cursor/next_cursor', () => {
    const page = parseNewsPage({ has_more: false, items: [ARTICLE], next_cursor: '' })
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeUndefined()
    expect(page.items[0]).toEqual({
      source: 'jin10', id: '229952', title: ARTICLE.title, url: ARTICLE.url, publishedAt: '2026-09-12T14:15:26.000Z',
    })
  })

  it('get_news 详情保留导语、丢弃正文 content', () => {
    const detail = parseArticle({ ...ARTICLE, content: '很长很长的正文……' })
    expect(detail).toEqual({
      id: '229952', title: ARTICLE.title, url: ARTICLE.url,
      publishedAt: '2026-09-12T14:15:26.000Z', introduction: ARTICLE.introduction,
    })
    expect('content' in detail).toBe(false)
  })

  it('详情缺关键字段即抛错（不产半条数据）', () => {
    expect(() => parseArticle({ id: '1', title: 't' })).toThrow(/missing id\/title\/url\/time/)
  })
})

describe('parseCalendar', () => {
  it('数组条目映射；null 字段省略、star 缺省 0', () => {
    const entries = parseCalendar([
      { actual: '12075', affect_txt: '利空', consensus: null, previous: '12871', pub_time: '2026-09-07 07:50', revised: null, star: 2, title: '日本8月外汇储备(亿美元)' },
      { title: '无时间条目', pub_time: null },
      { pub_time: '2026-09-08 09:00', title: '无星级条目' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      publishedAt: '2026-09-06T23:50:00.000Z', star: 2, title: '日本8月外汇储备(亿美元)',
      previous: '12871', actual: '12075', affect: '利空',
    })
    expect(entries[1]).toEqual({ publishedAt: '2026-09-08T01:00:00.000Z', star: 0, title: '无星级条目' })
  })

  it('非数组抛错', () => {
    expect(() => parseCalendar({ data: [] })).toThrow(/expected an array/)
  })
})

describe('parseQuoteCodes / parseQuote / parseKlines', () => {
  it('quote://codes 资源正文解析为品种表', () => {
    expect(parseQuoteCodes('{"data":[{"code":"XAUUSD","name":"现货黄金"},{"code":"USOIL"},{"name":"无边"}]}')).toEqual([
      { code: 'XAUUSD', name: '现货黄金' },
      { code: 'USOIL', name: 'USOIL' },
    ])
    expect(() => parseQuoteCodes('nope')).toThrow(/not valid JSON/)
  })

  it('报价字符串数字转数字，code 缺失抛错', () => {
    expect(parseQuote({ close: '4348.00', code: 'XAUUSD', high: '4402.51', low: '4290.42', name: '现货黄金', open: '4316.31', time: '2026-09-12T04:56:57+08:00', ups_percent: '0.73', ups_price: '31.52', volume: 241084 })).toEqual({
      code: 'XAUUSD', name: '现货黄金', time: '2026-09-11T20:56:57.000Z',
      open: 4316.31, close: 4348, high: 4402.51, low: 4290.42, volume: 241084, change: 31.52, changePercent: 0.73,
    })
    expect(() => parseQuote({ name: '无代码' })).toThrow(/missing code/)
  })

  it('K 线按时间升序、丢无时间条目、空数组合法', () => {
    const klines = parseKlines({ code: 'XAUUSD', klines: [
      { close: '2', high: '2', low: '1', open: '1', time: 120, volume: 5 },
      { close: '1', high: '1', low: '1', open: '1', time: 60, volume: 5 },
      { close: '3', time: 'bad' },
      { time: 180 },
    ], name: '现货黄金' })
    expect(klines.map((kline) => kline.time)).toEqual([60, 120])
    expect(klines[0]).toEqual({ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 5 })
    expect(parseKlines({ code: 'XAUUSD', klines: [] })).toEqual([])
    expect(() => parseKlines({ code: 'XAUUSD' })).toThrow(/expected data\.klines\[\]/)
  })
})
