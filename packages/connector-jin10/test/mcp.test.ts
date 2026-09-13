import { describe, expect, it } from 'vitest'
import { Jin10Error } from '../src/errors.js'
import { DEFAULT_PROTOCOL_VERSION, Jin10McpClient, parseMcpBody } from '../src/mcp.js'

function sse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  })
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } })
}

interface HarnessOptions {
  token?: string | (() => string | undefined)
  respond?: (message: Record<string, unknown>, index: number) => Response
}

function harness(options: HarnessOptions = {}) {
  const requests: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = []
  const respond = options.respond ?? defaultRespond
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[key.toLowerCase()] = String(value)
    requests.push({ body, headers })
    return respond(body, requests.length - 1)
  }) as typeof fetch
  const token = typeof options.token === 'function' ? options.token : () => options.token
  const client = new Jin10McpClient({ endpoint: 'https://mcp.test/mcp', token, fetchImpl })
  return { client, requests }
}

function defaultRespond(message: Record<string, unknown>): Response {
  if (message.method === 'initialize') {
    return sse({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: DEFAULT_PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'jin10-mcp' } } })
  }
  if (message.method === 'notifications/initialized') return new Response(null, { status: 202 })
  if (message.method === 'tools/list') return sse({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'list_flash', description: 'flash', inputSchema: { type: 'object' } }] } })
  if (message.method === 'resources/list') return sse({ jsonrpc: '2.0', id: message.id, result: { resources: [{ uri: 'quote://codes', name: 'quote_codes', mimeType: 'application/json' }] } })
  if (message.method === 'resources/read') return sse({ jsonrpc: '2.0', id: message.id, result: { contents: [{ uri: 'quote://codes', mimeType: 'application/json', text: '{"data":[{"code":"XAUUSD","name":"现货黄金"}]}' }] } })
  if (message.method === 'tools/call') return sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 200, message: '', data: { ok: true } }, content: [{ type: 'text', text: '{"status":200,"message":"","data":{"ok":true}}' }] } })
  return json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${String(message.method)}` } })
}

describe('parseMcpBody', () => {
  it('吃 SSE 单行 data 与直出 JSON 两种形态', () => {
    expect(parseMcpBody('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\n\n')).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: 1 } })
    expect(parseMcpBody('{"jsonrpc":"2.0","id":2,"result":{"ok":2}}')).toEqual({ jsonrpc: '2.0', id: 2, result: { ok: 2 } })
  })

  it('空 body 返回 undefined（notifications/initialized 的 202 空响应）', () => {
    expect(parseMcpBody('')).toBeUndefined()
    expect(parseMcpBody('   \n')).toBeUndefined()
  })

  it('多段 SSE 取最后一条合法消息，非 JSON 的 data 行不致命', () => {
    expect(parseMcpBody('event: ping\ndata: not-json\n\nevent: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":3}}\n\n')).toEqual({ jsonrpc: '2.0', id: 3, result: { ok: 3 } })
  })

  it('完全无合法 JSON-RPC 消息时抛协议错（不静默返回空）', () => {
    expect(() => parseMcpBody('event: message\ndata: oops\n\n')).toThrow(Jin10Error)
  })
})

describe('Jin10McpClient 握手与传输', () => {
  it('标准流程 initialize → notifications/initialized → tools/list，且只握手一次', async () => {
    const { client, requests } = harness({ token: 'sk-test' })
    const tools = await client.listTools()
    expect(tools).toEqual([{ name: 'list_flash', description: 'flash', inputSchema: { type: 'object' } }])
    expect(requests.map((request) => request.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect((requests[0]!.body.params as { protocolVersion: string }).protocolVersion).toBe('2025-11-25')
    expect(requests[0]!.headers.authorization).toBe('Bearer sk-test')
    expect(requests[0]!.headers.accept).toContain('text/event-stream')
    // 通知无 id；正常请求带 id
    expect(requests[1]!.body.id).toBeUndefined()
    expect(typeof requests[2]!.body.id).toBe('number')

    await client.listTools()
    expect(requests.map((request) => request.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list'])
  })

  it('上游回 mcp-session-id 时后续请求原样回带', async () => {
    const { client, requests } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'initialize'
        ? sse({ jsonrpc: '2.0', id: message.id, result: {} }, { 'mcp-session-id': 'sess-42' })
        : defaultRespond(message),
    })
    await client.listTools()
    expect(requests[0]!.headers['mcp-session-id']).toBeUndefined()
    expect(requests[2]!.headers['mcp-session-id']).toBe('sess-42')
  })

  it('缺 token 抛 TRADING_CREDENTIALS_MISSING 且不发请求；补上 token 后重新握手（失败不缓存）', async () => {
    let token: string | undefined
    const { client, requests } = harness({ token: () => token })
    await expect(client.listTools()).rejects.toMatchObject({ code: 'TRADING_CREDENTIALS_MISSING' })
    expect(requests).toHaveLength(0)
    token = 'sk-late'
    await expect(client.listTools()).resolves.toHaveLength(1)
    expect(requests.map((request) => request.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  })

  it('HTTP 401 → TRADING_AUTH_FAILED；429 → TRADING_RATE_LIMITED；5xx → TRADING_EXCHANGE_ERROR', async () => {
    const auth = harness({ token: 'sk-bad', respond: () => new Response('unauthorized', { status: 401 }) })
    await expect(auth.client.listTools()).rejects.toMatchObject({ code: 'TRADING_AUTH_FAILED' })
    const limited = harness({ token: 'sk-test', respond: () => new Response('slow down', { status: 429 }) })
    await expect(limited.client.listTools()).rejects.toMatchObject({ code: 'TRADING_RATE_LIMITED' })
    const broken = harness({ token: 'sk-test', respond: () => new Response('boom', { status: 503 }) })
    await expect(broken.client.listTools()).rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
  })

  it('网络失败/超时 → TRADING_NETWORK', async () => {
    const failing = harness({ token: 'sk-test', respond: () => { throw new Error('socket hang up') } })
    await expect(failing.client.listTools()).rejects.toMatchObject({ code: 'TRADING_NETWORK' })
  })

  it('JSON-RPC error → TRADING_EXCHANGE_ERROR（带 code 与 message）', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'initialize'
        ? defaultRespond(message)
        : json({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid params' } }),
    })
    await expect(client.listTools()).rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
    await expect(client.listTools()).rejects.toThrow(/-32602.*Invalid params/)
  })

  it('形状异常（tools/list 无 tools[]）抛错，不返回空数组', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/list'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { nope: true } })
        : defaultRespond(message),
    })
    await expect(client.listTools()).rejects.toThrow(/expected result\.tools\[\]/)
  })

  it('readResource 拼接 text 段', async () => {
    const { client } = harness({ token: 'sk-test' })
    await expect(client.readResource('quote://codes')).resolves.toContain('XAUUSD')
  })
})

describe('Jin10McpClient 结果读取（structuredContent 优先）', () => {
  it('structuredContent 优先于 content 文本', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 200, message: '', data: { from: 'structured' } }, content: [{ type: 'text', text: '{"status":200,"message":"","data":{"from":"text"}}' }] } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('list_flash')).resolves.toEqual({ from: 'structured' })
  })

  it('structuredContent 缺席时回退 content 文本里的 JSON 信封', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '{"status":200,"message":"","data":{"from":"text"}}' }] } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('list_flash')).resolves.toEqual({ from: 'text' })
  })

  it('isError=true → 按业务错误抛出', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { isError: true, structuredContent: { status: 500, message: '参数缺失', data: null } } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('list_flash')).rejects.toMatchObject({ code: 'TRADING_EXCHANGE_ERROR' })
  })

  it('「不支持该品种」识别为 TRADING_UNSUPPORTED_SYMBOL', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 400, message: '不支持该品种 "NOPE"，请通过 quote://codes 资源查询支持的品种列表', data: null } } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('get_quote', { code: 'NOPE' })).rejects.toMatchObject({ code: 'TRADING_UNSUPPORTED_SYMBOL' })
  })

  it('限流文案识别为 TRADING_RATE_LIMITED', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 429, message: '今日该工具调用次数已达上限，请明日再试', data: null } } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('list_flash')).rejects.toMatchObject({ code: 'TRADING_RATE_LIMITED' })
  })

  it('status≠200 与 data=null 都不冒充空数据', async () => {
    const badStatus = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 400, message: 'bad code', data: null } } })
        : defaultRespond(message),
    })
    await expect(badStatus.client.callToolData('get_quote', { code: 'NOPE' })).rejects.toThrow(/upstream status 400 — bad code/)
    const nullData = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { status: 200, message: 'not found', data: null } } })
        : defaultRespond(message),
    })
    await expect(nullData.client.callToolData('get_news', { id: '1' })).rejects.toThrow(/upstream returned no data — not found/)
  })

  it('无 structuredContent 也无机器可读文本 → 抛错', async () => {
    const { client } = harness({
      token: 'sk-test',
      respond: (message) => message.method === 'tools/call'
        ? sse({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '纯人话，无信封' }] } })
        : defaultRespond(message),
    })
    await expect(client.callToolData('list_flash')).rejects.toThrow(/no structuredContent/)
  })
})
