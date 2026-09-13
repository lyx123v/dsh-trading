/**
 * 快讯源服务（host 平面 provide `tradingFlashFeed`）。
 *
 * 为什么是服务而不只是 agent 工具：GUI 快讯面板走 /dshtrading/api/flash 桥（node 半），
 * 桥只能经 cordis 服务拿到取数实现。面板面与工具面共用同一个 Jin10Service 实例，
 * 避免两份取数逻辑漂移；服务缺席（连接器未装/未启用）时桥报 TRADING_NOT_IMPLEMENTED，
 * 绝不把「没装数据源」伪装成「没有快讯」。
 *
 * 形态选普通对象 + `ctx.reflect.provide`（与 client 半 tradingStageViews/tradingIndicators
 * 同款），不用 `extends Service`：cordis 的 context.d.ts 同时导出 public interface Context
 * 与 class Context，Service 构造签名上的 Context 解析随程序内文件顺序漂移（本包实测
 * TS2379：解析成窄接口后缺 inject/get/set…）。普通对象形态零构造签名，无该陷阱。
 */
import type { FlashFeedService, NewsItem } from '@dshtrading/api'
import type { Jin10Service } from './service.js'
import { isJin10HeatLevel } from './web-flash.js'

export const TRADING_FLASH_FEED_KEY = 'tradingFlashFeed'

/** 快讯源实现（桥与工具面共用同一 Jin10Service）。 */
export function createJin10FlashFeed(feed: Jin10Service): FlashFeedService {
  return {
    /**
     * 最新快讯流（cursor 翻页；条目只含元数据，正文零再分发）。
     * `hot` 含有效热度等级时走网页版服务端过滤（火/热/沸/爆）；否则走 MCP 全量流。
     */
    async listFlash(options: { cursor?: string | undefined; limit?: number | undefined; hot?: readonly string[] | undefined } = {}): Promise<{ items: readonly NewsItem[]; nextCursor?: string | undefined; hasMore: boolean }> {
      const hot = (options.hot ?? []).filter(isJin10HeatLevel)
      const page = hot.length > 0
        ? await feed.listFlashByHeat({ hot, ...(options.cursor !== undefined ? { cursor: options.cursor } : {}) })
        : await feed.listFlash(options)
      return {
        items: page.items,
        hasMore: page.hasMore,
        ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
      }
    },
    /** 关键词搜快讯（上游一次性返回、不支持翻页）。 */
    async searchFlash(keyword: string, limit?: number | undefined): Promise<readonly NewsItem[]> {
      return feed.searchFlash(keyword, limit)
    },
  }
}
