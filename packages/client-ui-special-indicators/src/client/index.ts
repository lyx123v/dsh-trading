/**
 * client-ui-special-indicators, browser half.
 *
 * 接入面（一切皆插件）：ctx.inject(['tradingStageViews']) 把「特殊指标」视图
 * 注册进中栏注册表（与策略/知识库同级，order 30）。数据面不走 shell 的
 * tradingBridge——本包 node 半自带 /dshtrading/api/special-indicators 桥
 * （同源 fetch），shell 未安装时 inject 回调不触发，本插件静默无 UI
 * （可选依赖语义）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ComponentType } from 'react'
import { LazySpecialIndicatorsView } from './LazySpecialIndicatorsView.tsx'
import './contract.ts'

import { en, zh } from './locales.ts'
const NS = 'dshtrading.specialIndicators'

/** Required services：locale 官方服务 + 视图注册面（后者由 client-ui-trading
 * client 半 provide；本插件 apply 同步访问 ctx.locale，故声明 locale；
 * tradingStageViews 在 apply 内 ctx.inject 异步等待，不进静态名单）。 */
export const inject = ['slots', 'locale']

/** tradingStageViews 的最小结构面（避免对 shell 包类型依赖）。 */
interface StageViewsService {
  register(definition: {
    id: string
    titleKey: string
    order?: number
    render: ComponentType<{ t: (key: string) => string; view: string }>
  }): void
}

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-trading-special-indicators-view: dictionaries')

  // 中栏「特殊指标」tab：t 在 apply 期只建一次（引用稳定——render 闭包里每次
  // 新建字面量会让视图 useEffect 自激振荡，2026-09-01 fetch 风暴同款教训）。
  ctx.inject(['tradingStageViews'] as never, (scope) => {
    const faces = scope as unknown as { tradingStageViews: StageViewsService }
    faces.tradingStageViews.register({
      id: 'special-indicators',
      titleKey: 'stage.special',
      order: 30,
      // 视图经 LazySpecialIndicatorsView 动态 import：tab 首访才执行视图 +
      // lightweight-charts 模块体（激活期零图表成本）；createElement 让视图
      // 挂在独立 fiber 上，不经 render 闭包直调。
      render: (props) => createElement(LazySpecialIndicatorsView, {
        t: t as unknown as (key: string) => string,
        view: props.view,
      }),
    })
  })
}
