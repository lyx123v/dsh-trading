// TV 历史分页取证脚本 —— 四源「往更早翻页」游标能力真实网络验证。
//
// 目的：为 DSH 交易插件中栏 TradingView 图表「向左加载更多历史 K 线」所需的
//       「严格早于 before」分页契约，逐源取得**真实网络原始响应证据**。
//
// 每个源做「两页衔接」验证：
//   1) 取第一页（最新一页，limit 取小值）。
//   2) 以第一页最旧一根的时间为游标，取第二页（往更早）。
//   3) 断言第二页最新一根严格早于第一页最旧一根（无重叠），且两页无缝（无缺口）。
//
// 运行：node spikes/impl-tv-history-paging/net-verify.mjs
// 依赖：Node 22+（全局 fetch），零第三方依赖。
// 落盘：原始响应写入同目录 raw/ 下（每请求一文件），便于复核。
//
// 注意：本脚本**只读公开端点**，每个源只发最少数量的请求，失败即如实记录，不重试轰炸。
//      本脚本不修改任何连接器源码，也不做任何 getKlines 接线。

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW_DIR = join(HERE, 'raw')

const UA = 'Mozilla/5.0'
const TIMEOUT_MS = 15_000

/** 单根 bar 名义步长（ms）：1h。 */
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/* ------------------------------------------------------------------ */
/* 基础设施                                                            */
/* ------------------------------------------------------------------ */

let rawSeq = 0

/** 把原始响应（文本）落盘，文件名形如 01-binance-page1.json。 */
async function saveRaw(name, text) {
  rawSeq += 1
  const file = join(RAW_DIR, String(rawSeq).padStart(2, '0') + '-' + name)
  await writeFile(file, text, 'utf-8')
  return file
}

/**
 * 取数：全局 fetch（连接器同款，无代理注入），AbortController 超时。
 * 返回 { ok, status, headers, text, json, ms }；网络错误返回 { ok:false, error }。
 */
async function get(url, { headers = {}, expectJson = true } = {}) {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout after ' + TIMEOUT_MS + 'ms')), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*', ...headers },
    })
    const text = await res.text()
    let json
    if (expectJson) {
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
    }
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      text,
      json,
      ms: Date.now() - t0,
    }
  } catch (e) {
    const cause = e && e.cause ? (e.cause.code || e.cause.message) : undefined
    return { ok: false, error: (e && e.name) + ': ' + (e && e.message) + (cause ? ' | cause=' + cause : ''), ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

/** `YYYY-MM-DD` − 1 个自然日（纯日历减法，UTC 锚定）。 */
function prevCalendarDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) - DAY_MS
  const dt = new Date(t)
  return (
    String(dt.getUTCFullYear()).padStart(4, '0') + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  )
}

function iso(ms) {
  return new Date(ms).toISOString()
}

const results = []

function record(entry) {
  results.push(entry)
  console.log(JSON.stringify(entry, null, 0))
}

/* ================================================================== */
/* 1) BINANCE — 假设：GET /api/v3/klines 支持 endTime(epoch ms)，        */
/*    endTime = before − 1 可取「严格早于 before」的一页               */
/* ================================================================== */

async function verifyBinance() {
  console.log('\n===== [1] BINANCE =====')
  // 默认主机 api.binance.com 本出口不可达；回落到 Binance 官方公开行情镜像
  // data-api.binance.vision（同一 /api/v3 契约）。两者都试，记录哪个可达。
  const hosts = [
    { label: 'api.binance.com (connector 默认主机)', base: 'https://api.binance.com' },
    { label: 'data-api.binance.vision (官方公开行情镜像)', base: 'https://data-api.binance.vision' },
  ]

  let chosen = null
  const reach = []
  for (const h of hosts) {
    const ping = await get(h.base + '/api/v3/ping')
    const okPing = ping.ok && ping.status === 200
    reach.push({ host: h.label, ok: okPing, status: ping.status ?? null, error: ping.error ?? null, ms: ping.ms })
    console.log('  ping ' + h.label + ' -> ' + (okPing ? 'HTTP 200' : (ping.error || ('HTTP ' + ping.status))) + ' (' + ping.ms + 'ms)')
    if (okPing && chosen === null) chosen = h
  }

  if (chosen === null) {
    record({ source: 'binance', conclusion: '证据不足', reason: '所有候选主机均不可达（网络）', reach })
    return
  }

  const base = chosen.base
  const symbol = 'BTCUSDT'
  const interval = '1h'
  const limit = 5
  const kl = (q) => base + '/api/v3/klines?symbol=' + symbol + '&interval=' + interval + '&limit=' + limit + (q || '')

  // 第一页（最新）
  const p1 = await get(kl(''))
  await saveRaw('binance-page1.json', p1.text ?? '')
  const rows1 = p1.json
  if (!Array.isArray(rows1) || rows1.length === 0) {
    record({ source: 'binance', conclusion: '证据不足', reason: 'page1 无有效 K 线数据', usedHost: chosen.label, status: p1.status ?? null, error: p1.error ?? null })
    return
  }
  const t1 = rows1.map((r) => r[0])
  const d0 = t1[0] // 第一页最旧
  const dN = t1[t1.length - 1] // 第一页最新

  // 边界验证：endTime = d0（第一页最旧）→ 若 endTime 为闭区间，末根应恰为 d0（重叠）
  const pIncl = await get(kl('&endTime=' + d0))
  await saveRaw('binance-endtime-inclusive-d0.json', pIncl.text ?? '')
  const rowsIncl = Array.isArray(pIncl.json) ? pIncl.json : []
  const inclLast = rowsIncl.length ? rowsIncl[rowsIncl.length - 1][0] : undefined

  // 第二页：endTime = d0 − 1ms → 严格早于 d0
  const cursor = d0 - 1
  const p2 = await get(kl('&endTime=' + cursor))
  await saveRaw('binance-page2-strict.json', p2.text ?? '')
  const rows2 = Array.isArray(p2.json) ? p2.json : []
  const t2 = rows2.map((r) => r[0])
  const p2Newest = t2.length ? t2[t2.length - 1] : undefined
  const p2Oldest = t2.length ? t2[0] : undefined

  const noOverlap = p2Newest !== undefined && p2Newest < d0
  const noGap = p2Newest === d0 - HOUR_MS
  const inclProvesClosed = inclLast === d0

  console.log('  page1 openTimes : ' + JSON.stringify(t1))
  console.log('  page2 openTimes : ' + JSON.stringify(t2))
  console.log('  第一页最旧 d0=' + d0 + ' (' + iso(d0) + ')')
  console.log('  第二页最新 p2Newest=' + p2Newest + ' (' + iso(p2Newest) + ')  → 无重叠=' + noOverlap)
  console.log('  endTime=d0 末根=' + inclLast + ' → 闭区间(inclusive)=' + inclProvesClosed)

  record({
    source: 'binance',
    conclusion: noOverlap && noGap ? '支持' : '证据不足',
    usedHost: chosen.label,
    reach,
    urlPage1: kl(''),
    urlPage2: kl('&endTime=' + cursor),
    urlBoundaryInclusive: kl('&endTime=' + d0),
    page1OpenTimes: t1,
    page2OpenTimes: t2,
    firstPageOldest: d0,
    secondPageNewest: p2Newest,
    secondPageOldest: p2Oldest,
    noOverlap,
    noGap,
    endTimeIsInclusive: inclProvesClosed,
    cursorRule: 'endTime = before − 1 (ms)',
  })
}

/* ================================================================== */
/* 2) YAHOO — 假设：chart 端点支持 period1/period2(epoch 秒) 绝对窗口， */
/*    左移窗口即往更早翻页                                             */
/* ================================================================== */

async function verifyYahoo() {
  console.log('\n===== [2] YAHOO =====')
  const symbol = 'AAPL'
  const interval = '1d'
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol

  // 第一页：最近 5 天窗口（用 period 绝对窗口，验证参数本身被接受）
  const nowSec = Math.floor(Date.now() / 1000)
  const p1From = nowSec - 10 * 86400
  const urlP1 = base + '?interval=' + interval + '&period1=' + p1From + '&period2=' + nowSec
  const p1 = await get(urlP1)
  await saveRaw('yahoo-page1.json', p1.text ?? '')
  console.log('  page1 ' + urlP1 + ' -> ' + (p1.ok ? 'HTTP ' + p1.status : p1.error) + ' (' + p1.ms + 'ms)')

  if (!p1.ok || p1.status !== 200 || !p1.json || !p1.json.chart || p1.json.chart.error) {
    record({
      source: 'yahoo',
      conclusion: '证据不足',
      reason: p1.ok ? 'HTTP ' + p1.status + '（Yahoo 边缘拦截，非端点语义）' : '网络错误',
      urlPage1: urlP1,
      status: p1.status ?? null,
      error: p1.error ?? null,
      responseSnippet: (p1.text || '').slice(0, 160),
    })
    return
  }

  // 走到这里说明 period1/period2 可用；继续做两页衔接
  const ts1 = p1.json.chart.result[0].timestamp
  const d0 = ts1[0] * 1000
  const p2To = Math.floor(d0 / 1000) - 1 // 严格早于 d0（秒）
  const p2From = p2To - 10 * 86400
  const urlP2 = base + '?interval=' + interval + '&period1=' + p2From + '&period2=' + p2To
  const p2 = await get(urlP2)
  await saveRaw('yahoo-page2-strict.json', p2.text ?? '')
  const ts2 = p2.json && p2.json.chart && p2.json.chart.result ? p2.json.chart.result[0].timestamp : []
  record({ source: 'yahoo', conclusion: '支持', urlPage1: urlP1, urlPage2: urlP2, firstPageOldest: d0, secondPageNewest: ts2.length ? ts2[ts2.length - 1] * 1000 : null, cursorRule: 'period2 = floor(before/1000) − 1 (秒)' })
}

/* ================================================================== */
/* 3) TENCENT — 假设：fqkline 的 param=<code>,<tf>,<start>,<end>,<count>,qfq |
/*    中空槽位接受 YYYY-MM-DD，end 取更早日期即往前翻页                 */
/* ================================================================== */

async function tencentTwoPage({ label, market, endpoint, wire, tf }) {
  console.log('\n  --- tencent ' + label + ' (' + market + ') ---')
  const klineBase = 'https://web.ifzq.gtimg.cn'
  const limit = 6
  const urlOf = (start, end, count) =>
    klineBase + '/' + endpoint + '?param=' + wire + ',' + tf + ',' + (start || '') + ',' + (end || '') + ',' + count + ',qfq'

  // 第一页（空窗口，count 取最新）
  const urlP1 = urlOf('', '', limit)
  const p1 = await get(urlP1, { expectJson: true })
  await saveRaw('tencent-' + label + '-page1.json', p1.text ?? '')
  const arrKey1 = p1.json && p1.json.data && p1.json.data[wire] ? Object.keys(p1.json.data[wire]).find((k) => Array.isArray(p1.json.data[wire][k])) : undefined
  const rows1 = arrKey1 ? p1.json.data[wire][arrKey1] : []
  if (!p1.ok || p1.status !== 200 || !rows1.length) {
    return record({ source: 'tencent', market, conclusion: '证据不足', reason: p1.ok ? 'HTTP ' + p1.status + ' 或无数据' : '网络错误', urlPage1: urlP1, error: p1.error ?? null })
  }
  const dates1 = rows1.map((r) => r[0])
  const d0 = dates1[0] // 最旧

  // 第二页：end = d0 − 1 自然日（end 为闭区间，须退一天避免重叠），start 留空
  const endCursor = prevCalendarDay(d0)
  const urlP2 = urlOf('', endCursor, limit)
  const p2 = await get(urlP2, { expectJson: true })
  await saveRaw('tencent-' + label + '-page2-strict.json', p2.text ?? '')
  const arrKey2 = p2.json && p2.json.data && p2.json.data[wire] ? Object.keys(p2.json.data[wire]).find((k) => Array.isArray(p2.json.data[wire][k])) : undefined
  const rows2 = arrKey2 ? p2.json.data[wire][arrKey2] : []
  const dates2 = rows2.map((r) => r[0])
  const p2Newest = dates2[dates2.length - 1]

  // 参考页：一次性取 2×limit 根，验证两页拼接后与之一致（无缺口/无重叠的强校验）
  const urlRef = urlOf('', '', limit * 2)
  const ref = await get(urlRef, { expectJson: true })
  await saveRaw('tencent-' + label + '-reference.json', ref.text ?? '')
  const arrKeyR = ref.json && ref.json.data && ref.json.data[wire] ? Object.keys(ref.json.data[wire]).find((k) => Array.isArray(ref.json.data[wire][k])) : undefined
  const refDates = arrKeyR ? ref.json.data[wire][arrKeyR].map((r) => r[0]) : []

  const combined = dates2.concat(dates1)
  const noOverlap = p2Newest !== undefined && p2Newest < d0
  const contiguous = combined.length === refDates.length && combined.every((d, i) => d === refDates[i])

  console.log('    page1 dates   : ' + JSON.stringify(dates1))
  console.log('    page2 dates   : ' + JSON.stringify(dates2))
  console.log('    参考(2x) dates: ' + JSON.stringify(refDates))
  console.log('    第一页最旧=' + d0 + ' / 第二页最新=' + p2Newest + ' → 无重叠=' + noOverlap + ' 无缝拼接=' + contiguous)

  record({
    source: 'tencent',
    market,
    conclusion: noOverlap && contiguous ? '支持' : '证据不足',
    urlPage1: urlP1,
    urlPage2: urlP2,
    urlReference: urlRef,
    responseKey: arrKey1,
    page1Dates: dates1,
    page2Dates: dates2,
    referenceDates: refDates,
    firstPageOldest: d0,
    secondPageNewest: p2Newest,
    noOverlap,
    seamlessWithReference: contiguous,
    cursorRule: 'end = (before 日期) − 1 自然日;  start 留空;  end 为闭区间',
  })
}

async function verifyTencent() {
  console.log('\n===== [3] TENCENT =====')
  await tencentTwoPage({ label: 'cn', market: 'cn', endpoint: 'appstock/app/fqkline/get', wire: 'sh600519', tf: 'day' })
  await tencentTwoPage({ label: 'hk', market: 'hk', endpoint: 'appstock/app/hkfqkline/get', wire: 'hk00700', tf: 'day' })
}

/* ================================================================== */
/* 4) EASTMONEY — 假设：kline/get 的 end=YYYYMMDD 为含端上界，          */
/*    改为更早日期即取更早一页（现源码硬编码 end=20500101）             */
/* ================================================================== */

async function verifyEastmoney() {
  console.log('\n===== [4] EASTMONEY =====')
  const secid = '1.600519' // 沪 600519 贵州茅台（cn 默认市场）
  const klt = '101' // 日 K
  const fields = '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58'
  const urlOf = (end, lmt) =>
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid + '&klt=' + klt + '&fqt=1&lmt=' + lmt + '&end=' + end + fields
  const headers = { referer: 'https://quote.eastmoney.com/' }

  const urlP1 = urlOf('20500101', 5)
  const p1 = await get(urlP1, { headers })
  await saveRaw('eastmoney-page1-error.txt', p1.text ?? (p1.error ?? ''))
  console.log('  page1 -> ' + (p1.ok ? 'HTTP ' + p1.status : p1.error) + ' (' + p1.ms + 'ms)')

  if (!p1.ok || p1.status !== 200 || !p1.json || !p1.json.data || !Array.isArray(p1.json.data.klines)) {
    record({
      source: 'eastmoney',
      conclusion: '证据不足',
      reason: p1.ok ? 'HTTP ' + p1.status + ' 或响应结构不符' : '网络错误（TLS/连接被重置，端点不可达）',
      urlPage1: urlP1,
      status: p1.status ?? null,
      error: p1.error ?? null,
      responseSnippet: (p1.text || '').slice(0, 160),
    })
    return
  }
  // 可达时：继续两页衔接
  const d1 = p1.json.data.klines.map((l) => l.split(',')[0])
  const d0 = d1[0]
  const endCursor = prevCalendarDay(d0).replace(/-/g, '')
  const urlP2 = urlOf(endCursor, 5)
  const p2 = await get(urlP2, { headers })
  await saveRaw('eastmoney-page2-strict.json', p2.text ?? '')
  const d2 = p2.json && p2.json.data && Array.isArray(p2.json.data.klines) ? p2.json.data.klines.map((l) => l.split(',')[0]) : []
  record({ source: 'eastmoney', conclusion: d2.length ? '支持' : '证据不足', urlPage1: urlP1, urlPage2: urlP2, page1Dates: d1, page2Dates: d2, firstPageOldest: d0, secondPageNewest: d2[d2.length - 1] ?? null, cursorRule: 'end = (before 日期) − 1 自然日, YYYYMMDD;  end 为闭区间' })
}

/* ================================================================== */

async function main() {
  await mkdir(RAW_DIR, { recursive: true })
  console.log('# TV 历史分页取证 · ' + new Date().toISOString())
  await verifyBinance()
  await verifyYahoo()
  await verifyTencent()
  await verifyEastmoney()

  console.log('\n===== 汇总 =====')
  for (const r of results) {
    console.log('- ' + r.source + (r.market ? '/' + r.market : '') + ': ' + r.conclusion + (r.reason ? ' (' + r.reason + ')' : ''))
  }
  await writeFile(join(RAW_DIR, 'summary.json'), JSON.stringify(results, null, 2), 'utf-8')
}

await main()
