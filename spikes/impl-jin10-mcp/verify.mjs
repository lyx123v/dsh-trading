/**
 * 金十 MCP 连接器出网验证（AGENTS.md：连接器必须有真实网络原始证据）。
 *
 * 跑的是**构建产物** packages/connector-jin10/lib/index.js（不是源码副本），
 * 覆盖：资源（quote://codes）→ 快讯两页翻页 → 快讯搜索 → 资讯列表/搜索/详情 →
 * 财经日历 → 报价 → 分钟 K 线，以及两条错误语义（缺凭证 / 非法 code）。
 * 原始结果落 EVIDENCE/verify-<ts>.json（token 只在请求头，不入证据文件）。
 *
 * 用法： JIN10_TOKEN=sk-... node spikes/impl-jin10-mcp/verify.mjs
 */
import { writeFile } from 'node:fs/promises'
import {
  Jin10McpClient,
  Jin10Service,
  createJin10Tools,
} from '../../packages/connector-jin10/lib/index.js'

const token = process.env.JIN10_TOKEN
if (token === undefined || token.length === 0) throw new Error('JIN10_TOKEN env required')

const started = Date.now()
const steps = []
const client = new Jin10McpClient({ token: () => token })
const service = new Jin10Service(client)
const tools = new Map(createJin10Tools(service).map((tool) => [tool.name, tool]))

/** 证据文件里的字符串截断（工具渲染文本可长；元数据行本身已是下发上限）。 */
function clip(value) {
  if (typeof value === 'string') return value.length > 800 ? `${value.slice(0, 800)}…[${value.length} chars]` : value
  if (Array.isArray(value)) return value.map(clip)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clip(item)]))
  return value
}

async function step(name, fn, options = {}) {
  const t0 = Date.now()
  try {
    const value = await fn()
    const summary = options.summary ?? (typeof value === 'string'
      ? `string(${value.length} chars)`
      : Array.isArray(value) ? `array(${value.length})` : `object(${Object.keys(value ?? {}).join(',')})`)
    steps.push({ step: name, ok: true, ms: Date.now() - t0, summary, value: options.keep !== true ? undefined : clip(value) })
    console.log(`PASS ${name} (${Date.now() - t0}ms) — ${summary}`)
    return value
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    steps.push({ step: name, ok: false, ms: Date.now() - t0, code, message: String(error?.message ?? error) })
    console.log(`FAIL ${name} (${Date.now() - t0}ms) — ${code ?? ''} ${String(error?.message ?? error)}`)
    if (options.optional !== true) throw error
    return undefined
  }
}

const codes = await step('global_instruments (quote://codes resource)', () => tools.get('global_instruments').execute({}), { keep: true })
const codesFiltered = await step('global_instruments query=黄金', () => tools.get('global_instruments').execute({ query: '黄金' }), { keep: true })

const flashText1 = await step('flash_list page 1 (tool render)', () => tools.get('flash_list').execute({ limit: 5 }), { keep: true })
const cursor = /cursor="([^"]+)"/.exec(String(flashText1))?.[1]
await step(`flash_list page 2 (cursor=${cursor ?? 'none'})`, () => tools.get('flash_list').execute({ cursor, limit: 3 }), { keep: true, optional: cursor === undefined })

await step('flash_search keyword=黄金', () => tools.get('flash_search').execute({ keyword: '黄金', limit: 5 }), { keep: true })

const newsText = await step('news_list (tool render)', () => tools.get('news_list').execute({ limit: 3 }), { keep: true })
const articleId = /id=(\d+)/.exec(String(newsText))?.[1]
await step('news_search keyword=美联储', () => tools.get('news_search').execute({ keyword: '美联储', limit: 3 }), { keep: true })
await step(`news_get id=${articleId ?? 'none'}`, () => tools.get('news_get').execute({ id: articleId }), { keep: true, optional: articleId === undefined })

await step('econ_calendar (tool render, limit 5)', () => tools.get('econ_calendar').execute({ limit: 5 }), { keep: true })

const quote = await step('global_quote code=XAUUSD', () => tools.get('global_quote').execute({ code: 'XAUUSD' }), { keep: true })
const klineStart = Math.floor(Date.now() / 1000) - 3 * 3600
await step('global_klines code=XAUUSD time=-3h count=5', () => tools.get('global_klines').execute({ code: 'XAUUSD', time: klineStart, count: 5 }), { keep: true })

await step('错误语义：非法 code 必须抛错而非空数据', async () => {
  try {
    await service.getQuote('NOT_A_CODE')
  } catch (error) {
    return `threw ${error.code}: ${error.message}`.slice(0, 200)
  }
  throw new Error('expected an error for an unknown code but the call succeeded')
}, { keep: true })

const missing = new Jin10McpClient({ token: () => undefined })
await step('错误语义：缺凭证 → TRADING_CREDENTIALS_MISSING（不发请求）', async () => {
  try {
    await new Jin10Service(missing).listFlash({})
  } catch (error) {
    if (error.code !== 'TRADING_CREDENTIALS_MISSING') throw new Error(`unexpected code ${error.code}`)
    return `${error.code}: ${error.message}`
  }
  throw new Error('expected TRADING_CREDENTIALS_MISSING')
}, { keep: true })

const failed = steps.filter((entry) => entry.ok !== true)
const evidence = {
  ranAt: new Date(started).toISOString(),
  endpoint: 'https://mcp.jin10.com/mcp',
  protocolVersion: '2025-11-25',
  durationMs: Date.now() - started,
  passed: steps.length - failed.length,
  failed: failed.length,
  steps,
  samples: {
    instrumentCount: Array.isArray(codes) ? codes.length : null,
    quote,
    codeFilterHits: codesFiltered,
  },
}
const out = new URL(`./EVIDENCE/verify-${started}.json`, import.meta.url)
await writeFile(out, JSON.stringify(evidence, null, 2))
console.log(`\n${evidence.passed}/${steps.length} steps passed in ${evidence.durationMs}ms → ${out.pathname}`)
if (failed.length > 0) process.exitCode = 1
