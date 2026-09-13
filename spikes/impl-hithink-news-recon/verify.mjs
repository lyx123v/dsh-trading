/**
 * HiThink 新闻/公告市场覆盖核查（同花顺不进新闻源裁决的全市场证据补全）。
 * 用法：node spikes/impl-hithink-news-recon/verify.mjs
 * Key 来源：环境变量 HITHINK_FINANCE_API_KEY，或 ~/.dsh-trading/settings.yaml
 * （dshtrading.credentials.hithink.apiKey）。Key 不落日志不进证据。
 *
 * 核查对象：fuyao.aicubes.cn（同花顺金融数据 API）全部新闻/公告类候选端点。
 * 结论（2026-09-12）：平台无港股/美股域；零公告端点；唯一新闻端点为单只基金
 * 资讯 /api/fund/news/article-list（实测样本全空）；A 股异动原因/热榜为当日
 * 事件快照（无 url/发布时间），不满足 NewsItem 契约。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { homedir } from 'node:os'

const here = fileURLToPath(new URL('.', import.meta.url))
const outDir = join(here, 'EVIDENCE')
mkdirSync(outDir, { recursive: true })

function readKeyFromSettings() {
  try {
    const yaml = readFileSync(join(process.env.HOME, '.dsh-trading', 'settings.yaml'), 'utf8')
    const lines = yaml.split('\n')
    const hithinkIdx = lines.findIndex((l) => l.trim() === 'hithink:')
    if (hithinkIdx < 0) return undefined
    for (let i = hithinkIdx + 1; i < Math.min(lines.length, hithinkIdx + 5); i++) {
      const m = /^\s+apiKey:\s*(\S+)\s*$/.exec(lines[i])
      if (m) return m[1]
      if (lines[i].trim() && !lines[i].startsWith(' ')) break
    }
  } catch { /* settings 缺失则跳过 */ }
  return undefined
}

const apiKey = process.env.HITHINK_FINANCE_API_KEY ?? readKeyFromSettings()
if (!apiKey) {
  console.error('no api key (env HITHINK_FINANCE_API_KEY or ~/.dsh-trading/settings.yaml)')
  process.exit(1)
}

const BASE = 'https://fuyao.aicubes.cn'
const summary = []

async function call(name, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'X-api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  const body = await res.json()
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ path, http: res.status, body }, null, 2))
  const items = Array.isArray(body?.data?.item) ? body.data.item.length : undefined
  summary.push({ name, path, http: res.status, code: body?.code, items })
  return body
}

// 1. 唯一新闻端点：单只基金资讯（ETF 与场外基金样本；code=0 但样本数据为空）
await call('fund-news-510300', '/api/fund/news/article-list?thscode=510300.SH&limit=20')
await call('fund-news-110022', '/api/fund/news/article-list?thscode=110022.OF&limit=20')

// 2. 场外基金代码表取样 → 取样基金资讯
const otc = await call('meta-list-fund-otc', '/api/meta/tickers/list?asset_type=fund-otc&limit=3&offset=0')
const sample = otc?.data?.item?.[0]
if (sample?.thscode) {
  await call('fund-news-otc-sample', `/api/fund/news/article-list?thscode=${encodeURIComponent(sample.thscode)}&limit=20`)
}

// 3. A 股事件类快照（当日；非交易日返回空属预期）——字段无 url/发布时间
await call('anomaly-list-today', '/api/a-share/special-data/anomaly-analysis-list')
await call('anomaly-stock-600519', '/api/a-share/special-data/anomaly-analysis-stock?thscodes=600519.SH')

// 4. 同花顺热榜（24h 滚动，周末仍有数据）——字段仅 rank/heat/趋势，无 url/发布时间
await call('hot-stock-list-day', '/api/a-share/special-data/hot-stock-list?period=day')

console.log(JSON.stringify(summary, null, 2))
