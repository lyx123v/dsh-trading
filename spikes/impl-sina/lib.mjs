// 新浪财经 MCP spike 公共件：JSON-RPC 2.0 over Streamable HTTP，X-Auth-Token 头鉴权。
// 凭证只从环境变量 SINA_MCP_TOKEN 读，任何落盘证据先过 redact()（token 字面量替换为 ***）。
import { writeFileSync } from 'node:fs'

export const TOKEN_ENV = 'SINA_MCP_TOKEN'

export const ENDPOINTS = [
  'https://mcp.finance.sina.com.cn/mcp-http',
  'http://mcp.finance.sina.com.cn/mcp-http',
]

export const PROTOCOL_VERSION = '2025-11-25'

export function redact(text, token) {
  if (!token) return text
  return text.split(token).join('***REDACTED***')
}

export function saveEvidence(name, value, token) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  writeFileSync(new URL(`./evidence-${name}.txt`, import.meta.url), redact(body, token))
}

/** 单次 JSON-RPC POST；返回 { status, contentType, sessionId, messages, raw }。 */
export async function rpcPost(endpoint, token, body, sessionId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-auth-token': token,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  const raw = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  const messages = parseMessages(raw, contentType)
  return {
    status: res.status,
    contentType,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    messages,
    raw,
  }
}

/** 兼容两种响应形态：application/json 直出，或 text/event-stream 的 data: 行。 */
export function parseMessages(raw, contentType) {
  if (contentType.includes('text/event-stream')) {
    return raw
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        }
        catch {
          return { unparsed: line }
        }
      })
  }
  try {
    return [JSON.parse(raw)]
  }
  catch {
    return [{ unparsed: raw.slice(0, 500) }]
  }
}

/** 完整握手：initialize → notifications/initialized → 后续请求复用会话。 */
export async function handshake(endpoint, token) {
  const init = await rpcPost(endpoint, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-trading-spike', version: '0.0.1' },
    },
  })
  const initResult = init.messages.find((m) => m.result !== undefined || m.error !== undefined)
  if (init.status !== 200 || initResult?.result === undefined) {
    return { ok: false, stage: 'initialize', init }
  }
  const sessionId = init.sessionId
  if (sessionId) {
    await rpcPost(endpoint, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)
  }
  return { ok: true, endpoint, sessionId, init, serverInfo: initResult?.result?.serverInfo }
}

export async function toolsList(endpoint, token, sessionId) {
  return rpcPost(endpoint, token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, sessionId)
}

export async function toolsCall(endpoint, token, sessionId, id, name, args) {
  return rpcPost(endpoint, token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } }, sessionId)
}
