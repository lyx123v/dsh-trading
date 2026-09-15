/**
 * 金十「央行利率 / 宏观指标」网页接口探针（2026-09-15）。
 *
 * 目的：为右侧栏「宏观/利率」页签找可用数据面。来源：rili.jin10.com 前端 bundle
 * （app.68c151f.js）逆向出的网页版实际请求。
 * 运行：node spikes/impl-jin10-macro-rates/probe.mjs
 * 产物：把原始响应写入 EVIDENCE/（只读复核，不参与运行时）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(here, 'EVIDENCE')
mkdirSync(evidenceDir, { recursive: true })

// rili-app.js 内 v 客户端（/web/interest_rates、/web/indicator_list 同源）：
// baseURL https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com
// headers { 'x-app-id': 'sKKYe29sFuJaeOCJ', 'x-version': '2.0', handleError: false }
const RATES_BASE = 'https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com'
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'x-app-id': 'sKKYe29sFuJaeOCJ',
  'x-version': '2.0',
  referer: 'https://rili.jin10.com/',
}

async function probe(name, url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
  const body = await response.json()
  writeFileSync(join(evidenceDir, `${name}.json`), JSON.stringify(body, null, 1) + '\n')
  return body
}

// 1) 央行利率（全量 30 家：最新利率 + 公布日 + 所属指标）
const rates = await probe('interest-rates', `${RATES_BASE}/web/interest_rates`)
console.log('interest_rates: status=%s banks=%s updated_at=%s', rates.status, rates.data?.list?.length, rates.data?.updated_at)

// 2) 经济指标字典（全量 1091 条；country 字段即地区词汇）
const indicators = await probe('indicator-list', `${RATES_BASE}/web/indicator_list`)
console.log('indicator_list: status=%s entries=%s countries=%s',
  indicators.status, indicators.data?.length,
  JSON.stringify([...new Set((indicators.data ?? []).map((e) => e.country))]))

// 3) 已知不可达/不可用面的复核（记录结论用，失败是预期）：
//    - cdn-rili.jin10.com（周/月 economics.json 静态文件）：本机网络 SSL 握手被断
//    - /calendarGetSiteChartByDateRange：网关 502（bundle 有引用但服务端未放行）
for (const [name, url] of [
  ['week-economics', 'https://cdn-rili.jin10.com/web_data/2026/week/37/economics.json'],
  ['chart-by-range', `${RATES_BASE}/calendarGetSiteChartByDateRange?id=77&start=2025-01-01&end=2026-09-15`],
]) {
  try {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
    const text = await response.text()
    writeFileSync(join(evidenceDir, `${name}.txt`), `HTTP ${response.status}\n${text.slice(0, 400)}\n`)
    console.log(`${name}: HTTP ${response.status}`)
  } catch (error) {
    writeFileSync(join(evidenceDir, `${name}.txt`), `${String(error)}\n`)
    console.log(`${name}: FAILED ${String(error).slice(0, 120)}`)
  }
}
