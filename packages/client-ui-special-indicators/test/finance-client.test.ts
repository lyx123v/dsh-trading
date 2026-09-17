/**
 * FinanceClient 契约测试（docs/api.md 口径）：
 * 凭据链惰性解析、Basic 认证头、限流/401 错误映射、TTL 缓存与失败不缓存。
 * 零 mock：上游为契约化 fake fetch（真实 Response 对象），时钟为注入假时钟。
 */
import { describe, expect, it } from 'vitest'
import { FinanceClient, FinanceError } from '../src/finance-client.ts'

interface CapturedCall {
  url: string
  authorization: string | undefined
  userAgent: string | undefined
}

/** 契约化 fake fetch：按状态档回真实 Response，记录调用面供断言。 */
function fakeFetch(sequence: Array<{ status?: number; body?: unknown }>) {
  const calls: CapturedCall[] = []
  let cursor = 0
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), authorization: headers.get('authorization') ?? undefined, userAgent: headers.get('user-agent') ?? undefined })
    const step = sequence[Math.min(cursor, sequence.length - 1)]
    cursor += 1
    return new Response(JSON.stringify(step.body ?? {}), {
      status: step.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { impl: impl as typeof globalThis.fetch, calls, count: () => cursor }
}

function makeClient(overrides: {
  password?: string
  username?: string
  sequence?: Array<{ status?: number; body?: unknown }>
  now?: () => number
}) {
  const upstream = fakeFetch(overrides.sequence ?? [{ body: { ready: true } }])
  let clock = 1_000_000
  const client = new FinanceClient({
    baseUrl: 'https://finance.example.test',
    username: () => overrides.username ?? 'api',
    password: () => overrides.password ?? 'secret',
    fetchImpl: upstream.impl,
    now: overrides.now ?? (() => clock),
  })
  return { client, upstream, advance: (ms: number) => { clock += ms } }
}

describe('FinanceClient 凭据与请求面', () => {
  it('用户未配置凭据时请求被拒为 FINANCE_NOT_CONFIGURED 且不触网', async () => {
    // Given: 凭据链解析为空密码
    const { client, upstream } = makeClient({ password: '' })
    // When: 用户请求任意上游路径
    const error = await client.get('/api/snapshot', 1000).catch((e: unknown) => e)
    // Then: 业务错误码 NOT_CONFIGURED，且零网络调用（不内置密钥、不伪装请求）
    expect(error).toBeInstanceOf(FinanceError)
    expect((error as FinanceError).code).toBe('FINANCE_NOT_CONFIGURED')
    expect(upstream.count()).toBe(0)
  })

  it('用户凭据就绪时请求携带 Basic 认证头与标识 User-Agent', async () => {
    // Given: 用户名 api + 密码 secret
    const { client, upstream } = makeClient({ password: 'secret' })
    // When: 用户请求上游
    const payload = await client.get('/api/snapshot', 1000)
    // Then: 一次调用，Authorization 为 Basic base64(api:secret)，UA 标识客户端
    expect(payload).toEqual({ ready: true })
    expect(upstream.count()).toBe(1)
    expect(upstream.calls[0].authorization).toBe('Basic ' + Buffer.from('api:secret').toString('base64'))
    expect(upstream.calls[0].userAgent).toContain('dsh-trading-special-indicators')
    expect(upstream.calls[0].url).toBe('https://finance.example.test/api/snapshot')
  })

  it('用户遭遇上游 401 时映射 FINANCE_AUTH_FAILED 且不自动重试', async () => {
    // Given: 上游一律 401
    const { client, upstream } = makeClient({ sequence: [{ status: 401, body: 'unauthorized' }] })
    // When: 用户请求
    const error = await client.get('/api/snapshot', 1000).catch((e: unknown) => e)
    // Then: 认证失败错误码，调用次数恒为 1（docs/api.md：密码错误不应触发无限自动重试）
    expect((error as FinanceError).code).toBe('FINANCE_AUTH_FAILED')
    expect(upstream.count()).toBe(1)
  })

  it('用户遭遇 429 限流时映射 FINANCE_RATE_LIMITED', async () => {
    // Given: 上游 429
    const { client } = makeClient({ sequence: [{ status: 429 }] })
    // When: 用户请求
    const error = await client.get('/api/snapshot', 1000).catch((e: unknown) => e)
    // Then: 限流错误码
    expect((error as FinanceError).code).toBe('FINANCE_RATE_LIMITED')
  })

  it('用户遭遇 HTTP 200 + error 业务形态时映射 FINANCE_BUSINESS_ERROR', async () => {
    // Given: 上游 200 但负载含 error 字段（未知板块等形态）
    const { client } = makeClient({ sequence: [{ body: { error: 'unknown sector' } }] })
    // When: 用户请求
    const error = await client.get('/api/v2/sectors/999999', 1000).catch((e: unknown) => e)
    // Then: 业务错误透出，不按成功消费
    expect((error as FinanceError).code).toBe('FINANCE_BUSINESS_ERROR')
  })
})

describe('FinanceClient TTL 缓存', () => {
  it('用户缓存窗口内重复请求不再触网，窗口外重新拉取', async () => {
    // Given: 上游正常 + 注入假时钟
    const { client, upstream, advance } = makeClient({})
    // When: 用户同路径连取两次（窗口内），推进时钟过窗后再取
    await client.get('/api/snapshot', 60_000)
    await client.get('/api/snapshot', 60_000)
    advance(61_000)
    await client.get('/api/snapshot', 60_000)
    // Then: 触网 2 次（窗口内第二次走缓存）
    expect(upstream.count()).toBe(2)
  })

  it('用户请求失败后结果不进入缓存，重试仍然触网', async () => {
    // Given: 第一次 500、第二次恢复 200
    const { client, upstream } = makeClient({ sequence: [{ status: 500 }, { body: { ready: true } }] })
    // When: 用户连取两次同路径
    const error = await client.get('/api/snapshot', 60_000).catch((e: unknown) => e)
    const payload = await client.get('/api/snapshot', 60_000)
    // Then: 第一次失败不缓存，第二次真实重试成功
    expect((error as FinanceError).code).toBe('FINANCE_UPSTREAM_ERROR')
    expect(payload).toEqual({ ready: true })
    expect(upstream.count()).toBe(2)
  })

  it('用户并发同路径请求合并为一次上游调用（in-flight 去重）', async () => {
    // Given: 上游正常
    const { client, upstream } = makeClient({})
    // When: 用户并发发起三个同路径请求
    const [a, b, c] = await Promise.all([
      client.get('/api/snapshot', 60_000),
      client.get('/api/snapshot', 60_000),
      client.get('/api/snapshot', 60_000),
    ])
    // Then: 只触网一次，三者同负载（限流纪律：每客户端 10 req/s）
    expect(upstream.count()).toBe(1)
    expect(a).toEqual({ ready: true })
    expect(b).toEqual({ ready: true })
    expect(c).toEqual({ ready: true })
  })
})
