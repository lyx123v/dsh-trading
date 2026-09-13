/**
 * cn 按标的新闻源探针（2026-09-13）：验证「东财全市场快讯 + 客户端 symbol 过滤」之外，
 * 是否能用同一 publisher 的**按关键词/标的新闻检索端点**补整个股新闻。
 *
 * 背景：packages/kit-cn/src/news.ts 的 cn 新闻主源是 getFastNewsList?fastColumn=102
 * （全市场 7x24 快讯，无 symbol 参数），客户端再用 matchesSymbol 过滤 → 大多数个股 24h 窗恒空。
 *
 * 探针对象：https://search-api-web.eastmoney.com/search/jsonp
 *   param = { keyword, type:['cmsArticleWebOld'], param:{cmsArticleWebOld:{searchScope:'default',sort:'default',pageIndex,pageSize}} }
 * 字段：date / title / url / mediaName / content(摘要正文，铁律 #5 不下发)。
 *
 * 用法：node spikes/impl-cn-symbol-news/probe.mjs
 * 原始响应落 EVIDENCE/（无 key、无凭证）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const outDir = join(here, 'EVIDENCE')
mkdirSync(outDir, { recursive: true })

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const BASE = 'https://search-api-web.eastmoney.com/search/jsonp'

function buildUrl(keyword) {
  const param = {
    uid: '', keyword, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 10, preTag: '', postTag: '' } },
  }
  return BASE + '?cb=cb&param=' + encodeURIComponent(JSON.stringify(param))
}

const cases = [
  { label: 'cn-stock-code-600519', keyword: '600519' },
  { label: 'cn-stock-name-贵州茅台', keyword: '贵州茅台' },
  { label: 'cn-index-000001.SH', keyword: '000001.SH' },
  { label: 'hk-stock-00700', keyword: '00700' },
  { label: 'us-stock-AAPL', keyword: 'AAPL' },
]

const summary = []
for (const c of cases) {
  const url = buildUrl(c.keyword)
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*', referer: 'https://so.eastmoney.com/' }, signal: AbortSignal.timeout(15_000) })
    const text = await res.text()
    writeFileSync(join(outDir, c.label + '.raw.txt'), text)
    let json
    try { json = JSON.parse(text.replace(/^cb\(/, '').replace(/\)\s*$/, '')) } catch { json = undefined }
    const list = json?.result?.cmsArticleWebOld ?? []
    writeFileSync(join(outDir, c.label + '.parsed.json'), JSON.stringify(list, null, 2))
    summary.push({ label: c.label, keyword: c.keyword, http: res.status, hitsTotal: json?.hitsTotal, returned: list.length, top3: list.slice(0, 3).map((i) => ({ date: i.date, media: i.mediaName, title: String(i.title ?? '').replace(/<[^>]+>/g, ''), url: i.url })) })
  } catch (error) {
    summary.push({ label: c.label, keyword: c.keyword, error: String(error?.message ?? error) })
  }
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
