/**
 * 宏观/利率源服务（host 平面 provide `tradingMacroFeed`）。
 *
 * 与快讯源（flash-service.ts）同款形态与理由：GUI 宏观面板走 /dshtrading/api/macro/*
 * 桥（node 半），桥只能经 cordis 服务拿到取数实现；面板面与 agent 工具面共用同一个
 * Jin10Service 实例（日历与 econ_calendar 工具同源），避免两份取数逻辑漂移。服务缺席
 * （连接器未装/未启用）时桥报 TRADING_NOT_IMPLEMENTED，绝不把「没装数据源」伪装成
 * 「没有数据」。形态选普通对象 + `ctx.reflect.provide`，理由见 flash-service.ts 头注。
 */
import type { MacroFeedService } from '@dshtrading/api'
import type { Jin10Service } from './service.js'

export const TRADING_MACRO_FEED_KEY = 'tradingMacroFeed'

/** 日历全周截尾上限（上游一页即整周；桥侧同值校验，超出 400）。 */
export const MACRO_CALENDAR_MAX = 250

/** 宏观/利率源实现（桥与工具面共用同一 Jin10Service）。 */
export function createJin10MacroFeed(feed: Jin10Service): MacroFeedService {
  return {
    /** 当周经济日历（MCP list_calendar；地区已按标题前缀推断）。 */
    async listCalendar(limit?: number | undefined) {
      return feed.listCalendar(limit)
    },
    /** 央行最新利率（网页版接口全量，客户端按地区过滤）。 */
    async listRates() {
      return feed.listRates()
    },
  }
}
