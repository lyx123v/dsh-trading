/**
 * 特殊指标视图的懒加载壳（代码面异步加载）：
 *
 * 视图本体 + lightweight-charts（client bundle 源体积 ~65%，2026-09-17
 * sourcemap 实测 189KB/248KB）此前在插件激活时随 factory 同步执行——
 * 用户不打开中栏「特殊指标」tab 也全额付执行成本。此处改为 React.lazy
 * 动态 import：tab 首次渲染时才执行视图模块。
 *
 * 单文件契约保持：tsdown.client.config.mjs 的 inlineDynamicImports 让
 * rolldown 把动态 chunk 折叠为 init_* 惰性函数（实测产物形态），不向
 * 供包目录新增文件——ModuleLoader 只认识单文件 client.js，分 chunk 的
 * 相对 require 在浏览器装载器里无法解析。
 *
 * fallback=null：内联 chunk 一个微任务即落地，无可见闪烁；Shell 的
 * MiddleStage 上方无 Suspense 边界，边界必须由本壳自带。
 */
import { lazy, Suspense } from 'react'
import type { SpecialIndicatorsViewProps } from './SpecialIndicatorsView.tsx'

const LazyView = lazy(() =>
  import('./SpecialIndicatorsView.tsx').then((m) => ({ default: m.SpecialIndicatorsView })),
)

export function LazySpecialIndicatorsView(props: SpecialIndicatorsViewProps) {
  return (
    <Suspense fallback={null}>
      <LazyView {...props} />
    </Suspense>
  )
}
