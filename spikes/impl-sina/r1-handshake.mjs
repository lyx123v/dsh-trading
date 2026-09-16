// r1：双端点握手 + tools/list 全量证据。用法：SINA_MCP_TOKEN=<token> node r1-handshake.mjs
import { ENDPOINTS, TOKEN_ENV, handshake, toolsList, saveEvidence } from './lib.mjs'

const token = process.env[TOKEN_ENV]
if (!token) {
  console.error(`missing env ${TOKEN_ENV}`)
  process.exit(1)
}

for (const endpoint of ENDPOINTS) {
  console.log(`\n=== ${endpoint} ===`)
  try {
    const hs = await handshake(endpoint, token)
    if (!hs.ok) {
      console.log(`initialize FAILED status=${hs.init.status} contentType=${hs.init.contentType}`)
      console.log(hs.init.raw.slice(0, 300))
      saveEvidence(`handshake-fail-${new URL(endpoint).protocol.replace(':', '')}`, hs.init.raw, token)
      continue
    }
    console.log(`initialize OK serverInfo=${JSON.stringify(hs.serverInfo)} sessionId=${hs.sessionId ? 'yes' : 'no'}`)
    const list = await toolsList(endpoint, token, hs.sessionId)
    const listResult = list.messages.find((m) => m.result !== undefined)
    if (!listResult) {
      console.log(`tools/list FAILED status=${list.status}: ${list.raw.slice(0, 300)}`)
      saveEvidence('tools-list-fail.txt', list.raw, token)
      continue
    }
    const tools = listResult.result.tools ?? []
    console.log(`tools/list OK count=${tools.length} contentType=${list.contentType}`)
    saveEvidence(`handshake-${new URL(endpoint).protocol.replace(':', '')}.txt`, {
      endpoint,
      serverInfo: hs.serverInfo,
      hasSessionId: Boolean(hs.sessionId),
      initStatus: hs.init.status,
      initContentType: hs.init.contentType,
    }, token)
    saveEvidence('tools-list.json', tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), token)
    console.log('tool names:')
    for (const t of tools) console.log(`  ${t.name}`)
    process.exit(0)
  }
  catch (err) {
    console.log(`network error: ${err.message} ${(err.cause?.code ?? '')}`)
  }
}
console.log('\nall endpoints failed')
process.exit(1)
