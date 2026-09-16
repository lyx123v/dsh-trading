// r2：代表性工具真实调用取证。用法：SINA_MCP_TOKEN=<token> node r2-sample-calls.mjs
import { TOKEN_ENV, handshake, toolsList, toolsCall, saveEvidence } from './lib.mjs'

const token = process.env[TOKEN_ENV]
if (!token) {
  console.error(`missing env ${TOKEN_ENV}`)
  process.exit(1)
}

const endpoint = 'https://mcp.finance.sina.com.cn/mcp-http'
const hs = await handshake(endpoint, token)
if (!hs.ok) {
  console.error('handshake failed')
  process.exit(1)
}
console.log(`handshake OK sessionId=${hs.sessionId ? 'yes' : 'no'}`)

const list = await toolsList(endpoint, token, hs.sessionId)
const names = (list.messages.find((m) => m.result !== undefined))?.result?.tools?.map((t) => t.name) ?? []
const known = [
  'cnMarketLimitUpPool', 'cnStockKLine', 'cnStockValuationDetail', 'cnStockLockupFuture',
  'swSymbolList', 'cnFinanceReportDateList', 'cnMarketUpdownDistribution', 'cnStockTradingMarginList',
]
const missing = known.filter((n) => !names.includes(n))
if (missing.length) console.log(`WARN upstream surface changed, missing: ${missing.join(',')}`)

const calls = [
  ['cnMarketLimitUpPool', {}],
  ['cnMarketUpdownDistribution', {}],
  ['cnStockKLine', { symbol: 'sh000001', scale: '5', datalen: '5' }],
  ['cnStockValuationDetail', { symbol: 'sh600519', type: 'syl', rank: 'y1' }],
  ['cnStockLockupFuture', { symbol: 'sz002371', page: '1', num: '3' }],
  ['cnStockTradingMarginList', { symbol: 'sz000002', page: '1', num: '3' }],
  ['swSymbolList', { symbol: 'sh600519' }],
  ['cnFinanceReportDateList', { paperCode: 'sh600519' }],
]

let id = 10
for (const [name, args] of calls) {
  const res = await toolsCall(endpoint, token, hs.sessionId, id++, name, args)
  const result = res.messages.find((m) => m.result !== undefined || m.error !== undefined)
  const isError = result?.result?.isError === true || result?.error !== undefined
  console.log(`${isError ? 'FAIL' : 'OK  '} ${name} status=${res.status} contentType=${res.contentType}`)
  saveEvidence(`call-${name}.txt`, { request: { name, arguments: args }, response: result ?? res.raw.slice(0, 2000) }, token)
}
console.log('done')
