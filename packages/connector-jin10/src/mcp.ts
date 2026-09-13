/**
 * MCP 传输层（Streamable HTTP / JSON-RPC 2.0）。
 *
 * 标准流程（用户 2026-09-13 给定契约，本出口实测复核）：
 *   initialize → notifications/initialized → tools/list / resources/list / resources/read → tools/call
 * 响应形态两种都要吃：`application/json` 直出 JSON，或 `text/event-stream` 里
 * `event: message` + 单行 `data: {…}`（金十本出口实测为后者）。若上游回
 * `mcp-session-id` 头则后续请求原样回带（本出口当前无会话头，属可选能力）。
 *
 * 结果读取：`result.structuredContent` 优先，`result.content[].text` 仅在
 * structuredContent 缺席时作可读文本兜底（用户契约 3/4）。
 */
import { Jin10Error, TOKEN_HINT, codeForUpstreamMessage } from './errors.js'

export const DEFAULT_ENDPOINT = 'https://mcp.jin10.com/mcp'
export const DEFAULT_PROTOCOL_VERSION = '2025-11-25'
export const DEFAULT_TIMEOUT_MS = 15_000

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface McpResourceDescriptor {
  uri: string
  name?: string
  mimeType?: string
  description?: string
}

/** 可读文本段（structuredContent 缺席时的兜底来源）。 */
export interface McpContentPart {
  type?: string
  text?: string
}

/** `tools/call` 的原始结果（structuredContent 优先，content 只作文本兜底）。 */
export interface McpToolResult {
  structuredContent?: unknown
  content?: readonly McpContentPart[]
  isError?: boolean
}

export interface Jin10McpOptions {
  endpoint?: string
  /** 惰性凭证源：每次请求解析（settings 热切换/异步加载晚于插件 apply 亦生效）。 */
  token: () => string | undefined
  /** 单次请求超时（ms），缺省 15s。 */
  timeoutMs?: number
  /** 依赖注入的 fetch（测试用 mock；缺省 globalThis.fetch）。 */
  fetchImpl?: typeof globalThis.fetch
  /** 协议版本（缺省 2025-11-25）。 */
  protocolVersion?: string
  clientName?: string
  clientVersion?: string
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: unknown
  result?: unknown
  error?: { code?: unknown; message?: unknown; data?: unknown }
}

/** 把响应体解析成 JSON-RPC 消息（直出 JSON 或 SSE 单行 data 均可）。 */
export function parseMcpBody(text: string): JsonRpcMessage | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? (parsed as JsonRpcMessage) : undefined
  }
  const candidates: JsonRpcMessage[] = []
  const pending: string[] = []
  const flush = (): void => {
    if (pending.length === 0) return
    const payload = pending.join('\n').trim()
    pending.length = 0
    if (payload.length === 0) return
    try {
      const parsed: unknown = JSON.parse(payload)
      if (isRecord(parsed)) candidates.push(parsed as JsonRpcMessage)
    } catch {
      // 非 JSON 的 data 行不是合法 MCP 消息，忽略；若整段无合法消息会在下面报错。
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) pending.push(line.slice(5).replace(/^ /, ''))
    else if (line.trim().length === 0) flush()
  }
  flush()
  const message = candidates[candidates.length - 1]
  if (message === undefined) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp: response is neither JSON nor a JSON-RPC SSE message — ${trimmed.slice(0, 200)}`)
  return message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function networkError(method: string, cause: unknown): Jin10Error {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
  return new Jin10Error('TRADING_NETWORK', `jin10 mcp ${method}: ${timedOut ? 'request timed out' : 'network failure'} — ${reason}`, cause)
}

export class Jin10McpClient {
  private readonly endpoint: string
  private readonly token: () => string | undefined
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly protocolVersion: string
  private readonly clientName: string
  private readonly clientVersion: string
  private nextId = 1
  private sessionId: string | undefined
  private handshake: Promise<void> | undefined

  constructor(options: Jin10McpOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION
    this.clientName = options.clientName ?? 'dsh-trading-connector-jin10'
    this.clientVersion = options.clientVersion ?? '0.2.1'
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.rpc('tools/list', {})
    const tools = isRecord(result) ? result.tools : undefined
    if (!Array.isArray(tools)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 mcp tools/list: unexpected payload (expected result.tools[])')
    return tools.filter(isRecord).map((tool) => ({
      name: String(tool.name ?? ''),
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    }))
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    const result = await this.rpc('resources/list', {})
    const resources = isRecord(result) ? result.resources : undefined
    if (!Array.isArray(resources)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', 'jin10 mcp resources/list: unexpected payload (expected result.resources[])')
    return resources.filter(isRecord).map((resource) => ({
      uri: String(resource.uri ?? ''),
      ...(typeof resource.name === 'string' ? { name: resource.name } : {}),
      ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
      ...(typeof resource.description === 'string' ? { description: resource.description } : {}),
    }))
  }

  /** 读资源正文（quote://codes 等；返回全部 text 段拼接）。 */
  async readResource(uri: string): Promise<string> {
    const result = await this.rpc('resources/read', { uri })
    const contents = isRecord(result) ? result.contents : undefined
    if (!Array.isArray(contents)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp resources/read ${uri}: unexpected payload (expected result.contents[])`)
    return contents.filter(isRecord).map((entry) => (typeof entry.text === 'string' ? entry.text : '')).join('')
  }

  /** 原始 tools/call（不做业务解包；协议/HTTP 错误在此抛出）。 */
  async callTool(tool: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const result = await this.rpc('tools/call', { name: tool, arguments: args })
    if (!isRecord(result)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp tools/call ${tool}: unexpected payload (expected result object)`)
    return {
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      ...(Array.isArray(result.content) ? { content: result.content.filter(isRecord) as McpContentPart[] } : {}),
      ...(typeof result.isError === 'boolean' ? { isError: result.isError } : {}),
    }
  }

  /**
   * 业务取数：structuredContent 优先，text 兜底；`isError`/`status !== 200`/`data === null`
   * 都按上游业务错误抛出（含限流文案识别）。返回上游 `data` 字段。
   */
  async callToolData(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await this.callTool(tool, args)
    const envelope = result.structuredContent ?? textEnvelope(result)
    if (envelope === undefined) {
      throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp tools/call ${tool}: no structuredContent and no machine-readable text payload`)
    }
    if (!isRecord(envelope)) throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp tools/call ${tool}: unexpected payload (expected an object envelope)`)
    const message = typeof envelope.message === 'string' ? envelope.message : ''
    const status = typeof envelope.status === 'number' ? envelope.status : undefined
    if (result.isError === true) {
      throw new Jin10Error(codeForUpstreamMessage(message), `jin10 ${tool}: ${message || 'upstream reported isError=true'}${status !== undefined ? ` (status ${status})` : ''}`)
    }
    if (status !== undefined && status !== 200) {
      throw new Jin10Error(codeForUpstreamMessage(message), `jin10 ${tool}: upstream status ${status}${message ? ` — ${message}` : ''}`)
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new Jin10Error(codeForUpstreamMessage(message), `jin10 ${tool}: upstream returned no data${message ? ` — ${message}` : ''}`)
    }
    return envelope.data
  }

  private async ensureHandshake(): Promise<void> {
    if (this.handshake === undefined) {
      // 失败即清空：凭证后配/上游恢复后，下一次调用可重新握手（不做失败缓存）。
      this.handshake = this.performHandshake().catch((error: unknown) => {
        this.handshake = undefined
        throw error
      })
    }
    return this.handshake
  }

  private async performHandshake(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    }, { skipHandshake: true })
    await this.rpc('notifications/initialized', undefined, { notification: true, skipHandshake: true })
  }

  private async rpc(
    method: string,
    params: unknown,
    options: { notification?: boolean; skipHandshake?: boolean } = {},
  ): Promise<unknown> {
    if (options.skipHandshake !== true) await this.ensureHandshake()
    const token = this.token()
    if (token === undefined || token.trim().length === 0) {
      throw new Jin10Error('TRADING_CREDENTIALS_MISSING', `jin10 mcp ${method}: missing MCP token. ${TOKEN_HINT}`)
    }
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (options.notification !== true) payload.id = this.nextId++
    if (params !== undefined) payload.params = params
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token.trim()}`,
          ...(this.sessionId !== undefined ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw networkError(method, error)
    }
    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId !== null && sessionId.length > 0) this.sessionId = sessionId
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '')
      throw new Jin10Error('TRADING_AUTH_FAILED', `jin10 mcp ${method}: HTTP ${response.status} — invalid or expired MCP token. ${TOKEN_HINT}${body ? ` (${body.slice(0, 160)})` : ''}`)
    }
    if (response.status === 429) {
      const body = await response.text().catch(() => '')
      throw new Jin10Error('TRADING_RATE_LIMITED', `jin10 mcp ${method}: HTTP 429 — rate limited${body ? ` — ${body.slice(0, 160)}` : ''}`)
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp ${method}: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
    }
    const text = await response.text().catch((error: unknown) => { throw networkError(method, error) })
    const message = parseMcpBody(text)
    if (message === undefined) return undefined
    if (isRecord(message.error)) {
      const code = codeOf(message.error.code)
      const detail = typeof message.error.message === 'string' ? message.error.message : 'JSON-RPC error'
      throw new Jin10Error('TRADING_EXCHANGE_ERROR', `jin10 mcp ${method}: JSON-RPC error ${code ?? ''} — ${detail}`.replace('  ', ' '), message.error)
    }
    return message.result
  }
}

function codeOf(value: unknown): number | string | undefined {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

/** structuredContent 缺席时的可读文本兜底：content[].text 若能解析成 JSON 信封则采用。 */
function textEnvelope(result: McpToolResult): unknown {
  for (const part of result.content ?? []) {
    if (typeof part.text !== 'string') continue
    const text = part.text.trim()
    if (!text.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed) && ('data' in parsed || 'status' in parsed || 'message' in parsed)) return parsed
    } catch {
      continue
    }
  }
  return undefined
}
