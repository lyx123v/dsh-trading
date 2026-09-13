import { writeFile, mkdir } from 'node:fs/promises'

const TOKEN = process.env.JIN10_TOKEN
if (!TOKEN) throw new Error('JIN10_TOKEN env required')
const ENDPOINT = 'https://mcp.jin10.com/mcp'
const OUT = new URL('./EVIDENCE/', import.meta.url)

async function rpc(method, params) {
  const body = { jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method }
  if (params !== undefined) body.params = params
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const dataLines = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6))
  let parsed = null
  if (dataLines.length > 0) {
    try { parsed = JSON.parse(dataLines[dataLines.length - 1]) } catch {}
  } else {
    try { parsed = JSON.parse(text) } catch {}
  }
  return { method, status: res.status, contentType: res.headers.get('content-type') ?? '', sessionId: res.headers.get('mcp-session-id'), raw: text, parsed }
}

async function save(name, payload) {
  await mkdir(OUT, { recursive: true })
  await writeFile(new URL(name, OUT), typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))
}

const log = []

const init = await rpc('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'dsh-trading-recon', version: '0.0.1' },
})
log.push({ step: 'initialize', status: init.status, contentType: init.contentType, sessionId: init.sessionId, result: init.parsed?.result })
await save('01-initialize.json', init.parsed)

const note = await rpc('notifications/initialized')
log.push({ step: 'notifications/initialized', status: note.status, bodyLength: note.raw.length })

const tools = await rpc('tools/list')
log.push({ step: 'tools/list', status: tools.status, names: (tools.parsed?.result?.tools ?? []).map((t) => t.name) })
await save('02-tools-list.json', tools.parsed)

const resources = await rpc('resources/list')
log.push({ step: 'resources/list', status: resources.status, resources: resources.parsed?.result?.resources })
await save('03-resources-list.json', resources.parsed)

const codes = await rpc('resources/read', { uri: 'quote://codes' })
log.push({ step: 'resources/read quote://codes', status: codes.status, mimeType: codes.parsed?.result?.contents?.[0]?.mimeType, textLength: (codes.parsed?.result?.contents?.[0]?.text ?? '').length })
await save('04-resource-quote-codes.json', codes.parsed)

async function call(name, args) {
  const r = await rpc('tools/call', { name, arguments: args })
  await save(`tool-${name}${args && Object.keys(args).length ? '-' + Object.values(args).join('_').replace(/[^\w.-]/g, '') : ''}.json`, r.parsed ?? { status: r.status, raw: r.raw })
  const res = r.parsed?.result ?? {}
  log.push({ step: `tools/call ${name}`, status: r.status, isError: res.isError, hasStructured: !!res.structuredContent, contentTypes: (res.content ?? []).map((c) => c.type), status_: res.structuredContent?.status, dataKeys: res.structuredContent?.data && !Array.isArray(res.structuredContent.data) ? Object.keys(res.structuredContent.data) : Array.isArray(res.structuredContent?.data) ? `array(${res.structuredContent.data.length})` : undefined })
  return r.parsed?.result
}

const flash1 = await call('list_flash', {})
const nextCursor = flash1?.structuredContent?.data?.next_cursor
if (nextCursor) await call('list_flash', { cursor: nextCursor })
await call('search_flash', { keyword: '黄金' })
const news1 = await call('list_news', {})
const newsId = news1?.structuredContent?.data?.items?.[0]?.id
if (newsId) await call('get_news', { id: newsId })
await call('search_news', { keyword: '美联储' })
await call('list_calendar', {})
await call('get_quote', { code: 'XAUUSD' })
await call('get_kline', { code: 'XAUUSD', count: 3 })

await save('00-recon-log.json', log)
console.log(JSON.stringify(log, null, 2))
