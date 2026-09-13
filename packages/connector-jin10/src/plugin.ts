/**
 * 插件入口（host 平面工具行，市场无关共享行 → 归 base 所有，README 铁律 #1）。
 *
 * 为什么在 host 平面而不是某个市场的 preset 平面：金十快讯/资讯/财经日历是**跨市场**
 * 内容（宏观、大宗、外汇、A 股、地缘），任何单一市场会话都需要；host 行注册一次
 * 全会话可见（与 @dshtrading/base/market-tools 同款形态）。
 *
 * 凭证：BYOK。设置中心 `dshtrading.credentials.jin10.token` 优先、环境变量
 * （缺省 JIN10_MCP_TOKEN）兜底，**惰性到每次请求解析** —— settings 用户层加载/修改
 * 晚于插件 apply 也生效（2026-09-12 hithink 凭证失效根因的同款纪律）。不内置密钥。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS, Jin10McpClient } from './mcp.js'
import { Jin10Service } from './service.js'
import { createJin10Tools } from './tools.js'
import { TRADING_FLASH_FEED_KEY, createJin10FlashFeed } from './flash-service.js'

/** Cordis 插件名 = patch 行 id（TEMPLATES §8）。 */
export const name = 'dsh-trading-connector-jin10'

export const inject = ['tools']

export interface Config {
  enabled: boolean
  endpoint: string
  tokenRef: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true).description('是否注册金十数据 MCP 工具'),
  endpoint: Schema.string().default(DEFAULT_ENDPOINT).description('金十数据 MCP 服务地址'),
  tokenRef: Schema.string().default('JIN10_MCP_TOKEN').description('金十 MCP Token 的环境变量名（BYOK）'),
  timeoutMs: Schema.number().default(DEFAULT_TIMEOUT_MS).description('单次 MCP 请求超时（ms）'),
})

interface RouterLike {
  getCredential?(provider: string): Record<string, string> | undefined
}

/** 惰性凭证源：provider 键固定 `jin10`（settings credentials 字典的键）。 */
export function createTokenProvider(ctx: Context, tokenRef: string): () => string | undefined {
  return () => {
    const router = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.('tradingMarketRouter', false) as RouterLike | undefined
    return router?.getCredential?.('jin10')?.token || process.env[tokenRef]
  }
}

/** 组装取数服务（测试可直接注入 fetchImpl 的 MCP 客户端）。 */
export function createJin10Service(ctx: Context, config: Pick<Config, 'endpoint' | 'tokenRef' | 'timeoutMs'>, overrides: { fetchImpl?: typeof globalThis.fetch } = {}): Jin10Service {
  return new Jin10Service(new Jin10McpClient({
    endpoint: config.endpoint,
    token: createTokenProvider(ctx, config.tokenRef),
    timeoutMs: config.timeoutMs,
    ...(overrides.fetchImpl !== undefined ? { fetchImpl: overrides.fetchImpl } : {}),
  }))
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const service = createJin10Service(ctx, config)
  // GUI 快讯面板经桥读本服务（tradingFlashFeed）；与工具面共用同一取数实例。
  ctx.reflect.provide(TRADING_FLASH_FEED_KEY, createJin10FlashFeed(service))
  const tools = ctx.tools as unknown as { register(definition: unknown): void; get(name: string): unknown }
  for (const tool of createJin10Tools(service)) {
    // 同名先到先得，绝不重复注册（dsh-tools 对同名重复注册直接抛错）。
    if (tools.get(tool.name) === undefined) tools.register(tool)
  }
}
