/**
 * Finance 上游客户端（自有服务，docs/api.md 契约）：
 *
 * - HTTP Basic 认证，凭据**惰性到每次请求解析**（设置中心 credentials.finance
 *   → 行配置 → 环境变量兜底；缺省未配置 → FINANCE_NOT_CONFIGURED，不内置密钥）。
 * - 每客户端限流 10 req/s（nginx 模板）：内存 TTL 缓存 + in-flight 去重，
 *   失败不缓存；快照 60s / 历史 300s（服务端成功内容自身缓存 10 分钟，
 *   客户端无需按秒拉取）。
 * - Accept: application/json + 标识 User-Agent（docs/api.md 要求）；401 不
 *   自动重试（密码错误不应触发无限自动重试）。
 */

export interface FinanceClientOptions {
  baseUrl: string
  /** 惰性凭据源：每次请求重新解析（设置中心用户层晚于 apply 加载也生效）。 */
  username: () => string | undefined
  password: () => string | undefined
  /** 单次请求超时（冷缓存上游重算可能十几秒，默认 60s）。 */
  timeoutMs?: number
  /** 注入缝：测试用契约化 fake 替代真实网络。 */
  fetchImpl?: typeof globalThis.fetch
  /** 注入缝：缓存时钟（测试注入单调假时钟，不用 fake timers）。 */
  now?: () => number
}

export class FinanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'FinanceError'
  }
}

interface CacheEntry {
  at: number
  payload: unknown
}

export class FinanceClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly options: FinanceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  /** 凭据是否齐备（username 有 schema 兜底，决定性的是 password）。 */
  configured(): boolean {
    return (this.options.password() ?? '') !== ''
  }

  /**
   * GET 一个上游 API 路径（含查询串），带 TTL 缓存与 in-flight 去重。
   * @param path 上游路径，如 /api/sentiment/snapshot?market=cn&methodology=2
   * @param ttlMs 缓存毫秒；0 = 不缓存
   */
  async get(path: string, ttlMs: number): Promise<unknown> {
    const key = path
    if (ttlMs > 0) {
      const hit = this.cache.get(key)
      if (hit !== undefined && this.now() - hit.at < ttlMs) return hit.payload
    }
    const pending = this.inflight.get(key)
    if (pending !== undefined) return pending

    const promise = this.fetchUpstream(path)
      .then((payload) => {
        if (ttlMs > 0) this.cache.set(key, { at: this.now(), payload })
        return payload
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, promise)
    return promise
  }

  private async fetchUpstream(path: string): Promise<unknown> {
    const username = this.options.username() ?? 'api'
    const password = this.options.password() ?? ''
    if (password === '') {
      throw new FinanceError('FINANCE_NOT_CONFIGURED', 'finance 凭据未配置：设置中心 credentials.finance、行配置 password 或环境变量 FINANCE_API_PASSWORD')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64'),
          'user-agent': 'dsh-trading-special-indicators/0.1',
        },
        signal: controller.signal,
      })
      if (response.status === 401) {
        throw new FinanceError('FINANCE_AUTH_FAILED', 'finance 凭据被拒绝（401）：检查用户名/密码', 401)
      }
      if (response.status === 403 || response.status === 429) {
        throw new FinanceError('FINANCE_RATE_LIMITED', 'finance 入口限流/拒绝（' + response.status + '）：稍后重试', response.status)
      }
      if (!response.ok) {
        throw new FinanceError('FINANCE_UPSTREAM_ERROR', 'finance 上游错误：HTTP ' + response.status, response.status)
      }
      const payload = await response.json() as unknown
      // 上游存在 HTTP 200 + {error} 形态（未知板块等），按业务错误透出。
      if (payload !== null && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
        throw new FinanceError('FINANCE_BUSINESS_ERROR', (payload as { error: string }).error)
      }
      return payload
    } catch (error) {
      if (error instanceof FinanceError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FinanceError('FINANCE_TIMEOUT', 'finance 请求超时（' + this.timeoutMs + 'ms）：冷缓存上游重算可能较慢，可重试')
      }
      throw new FinanceError('FINANCE_UNAVAILABLE', 'finance 服务不可达：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
    }
  }
}
