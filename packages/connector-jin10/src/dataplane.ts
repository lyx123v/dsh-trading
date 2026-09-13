/**
 * global 市场数据面插件行（patch 行 id：dsh-trading-global-dataplane-jin10）。
 *
 * 与同包主行（@dshtrading/connector-jin10）的分工：主行注册 agent 工具与快讯面，
 * 本行只做**市场路由接线**——provide tradingGlobalMarketData + 向
 * tradingMarketDataRegistry 注册 (global, jin10)，GUI 行情桥与 <market> 工具族
 * 经注册表惰性解析（registry-first，见 docs/exchange-routing.md §2）。
 *
 * 为什么由 base 的 patch 拥有本行：global 是纯数据市场（无 bundle/kit/交易面），
 * 没有任何市场 bundle 会认领它；base 是全部市场无关共享行的唯一拥有者（铁律 #1），
 * 金十连接器行本身也在 base。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MarketDataService } from '@dshtrading/api'
import { createJin10Service, type Config } from './plugin.js'
import {
  GLOBAL_MARKET,
  JIN10_PROVIDER,
  TRADING_GLOBAL_MARKET_DATA_KEY,
  createJin10GlobalMarketDataService,
} from './market-data.js'

export const inject: string[] = []

interface MarketDataRegistryLike {
  register(market: string, provider: string, service: MarketDataService): () => void
}

function resolveMarketDataRegistry(ctx: Context): MarketDataRegistryLike | undefined {
  const candidate = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.('tradingMarketDataRegistry', false)
  return candidate !== undefined ? (candidate as MarketDataRegistryLike) : undefined
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const service = createJin10GlobalMarketDataService(createJin10Service(ctx, config))
  ctx.reflect.provide(TRADING_GLOBAL_MARKET_DATA_KEY, service)
  const registry = resolveMarketDataRegistry(ctx)
  if (registry === undefined) return
  ctx.effect(() => registry.register(GLOBAL_MARKET, JIN10_PROVIDER, service))
}
