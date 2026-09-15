/**
 * @dshtrading/connector-jin10
 * global 市场 preset 面插件入口：在 preset 的 isolate 组内直接 provide
 * tradingGlobalMarketData（对照 connector-hithink/futures-plugin 的形态）。
 *
 * 与 ./dataplane 的分工（docs/connector-playbook.md §4/§4.1）：
 * - preset 行用本入口：隔离组内直接 provide 服务，会话可见；
 * - host 面（@dshtrading/global bundle 的 cordis.patch.yml）用 dataplane：
 *   注册 (global, jin10) 进共享注册表（GUI 行情桥）。
 * 两面同挂时 preset 侧若也用 dataplane，会对同一 (market, provider) 注册第二个服务实例而
 * 响亮失败（router register 的重复注册检查），故 preset 必须走本入口。
 *
 * 凭证与主行同源：settings credentials 优先、env 兜底，请求期惰性解析（plugin.ts
 * createTokenProvider 同款）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS } from './mcp.js'
import { createJin10Service, type Config } from './plugin.js'
import { TRADING_GLOBAL_MARKET_DATA_KEY, createJin10GlobalMarketDataService } from './market-data.js'

export { Config } from './plugin.js'

export const name = 'dsh-trading-global-connector-jin10'

export const inject: string[] = []

export function apply(ctx: Context, config?: Partial<Config>): void {
  if (config?.enabled === false) return
  const service = createJin10GlobalMarketDataService(createJin10Service(ctx, {
    endpoint: config?.endpoint ?? DEFAULT_ENDPOINT,
    tokenRef: config?.tokenRef ?? 'JIN10_MCP_TOKEN',
    timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }))
  ctx.reflect.provide(TRADING_GLOBAL_MARKET_DATA_KEY, service)
}
