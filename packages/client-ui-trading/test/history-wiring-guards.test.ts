/**
 * 接线层**静态护栏单测**（QA 独立验证第一轮，2026-09-19 图表左缘惰性分页）。
 *
 * 这些断言覆盖无法在零 mock 下用运行时单测表达、却属于最高风险的「结构不变量」：
 * - **R-2**：视窗补偿 effect 必须声明在**所有** `setData` effect 之后（末尾单点应用），
 *   否则同一次提交里镜像/指标的 `setData` 会重算时间轴、吃掉补偿；
 * - **R-1 调用点**：补偿量必须取自 `detectHeadChange` 的 `prependCount`，不得出现长度差；
 * - **R-3**：`QuoteStage` 前插时必须同批位移 `hoverIndex` 与 `rangeSelection` 两个逻辑下标；
 * - **Q10 单一口径**：`QuoteStage` 不得残留重复的页大小常量，日线参考取数走同一出口；
 * - **跨包 face 契约**：`fetchKlines` 签名逐字未变、分页函数不进 `TradingBridgeService` 面。
 *
 * 手法：读取源码文本做确定性结构断言（非 mock、非 timers）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readSource(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

describe('TvChart 视窗补偿结构（R-1 调用点 / R-2）', () => {
  it('用户 TvChart 的视窗补偿应用点声明在所有 setData 之后', () => {
    // Given TvChart 源码（在指标函数定义之前即为组件体）
    const src = readSource('../src/client/TvChart.tsx')
    const componentBody = src.split('function syncIndicators')[0] ?? src
    // When 定位补偿应用点与组件体内最后的 setData / syncIndicators 调用
    const compIndex = componentBody.indexOf('setVisibleLogicalRange(compensation)')
    const lastSetData = componentBody.lastIndexOf('.setData(')
    const lastIndicatorSync = componentBody.lastIndexOf('syncIndicators(')
    // Then 补偿应用点存在且晚于所有 setData 与指标同步
    expect(compIndex).toBeGreaterThan(-1)
    expect(compIndex).toBeGreaterThan(lastSetData)
    expect(compIndex).toBeGreaterThan(lastIndicatorSync)
  })

  it('客户 补偿 effect 之后不再声明任何 useEffect（确属最末单点）', () => {
    // Given TvChart 源码
    const src = readSource('../src/client/TvChart.tsx')
    const componentBody = src.split('function syncIndicators')[0] ?? src
    const compIndex = componentBody.indexOf('setVisibleLogicalRange(compensation)')
    // When 截取补偿应用点之后的片段
    const after = componentBody.slice(compIndex)
    // Then 其后不得再出现 useEffect（否则补偿会被后续提交的 setData 吃掉）
    expect(after.includes('useEffect(')).toBe(false)
  })

  it('管理员 前插补偿量取自前置根数而非长度差', () => {
    // Given TvChart 源码
    const src = readSource('../src/client/TvChart.tsx')
    // When / Then 必须是 compensateViewport(range, change.prependCount)
    expect(src.includes('compensateViewport(range, change.prependCount)')).toBe(true)
    // 且不得以任何长度差作为补偿量
    expect(src.includes('compensateViewport(range, bars.length')).toBe(false)
    expect(src.includes('compensateViewport(range, volumes.length')).toBe(false)
    expect(src.includes('bars.length - prev')).toBe(false)
  })
})

describe('QuoteStage 前插逻辑下标位移（R-3）', () => {
  it('客户 QuoteStage 前插时同批位移 hoverIndex 与 rangeSelection', () => {
    // Given QuoteStage 源码
    const src = readSource('../src/client/QuoteStage.tsx')
    // When / Then 两个逻辑下标 state 都必须按前插根数同批位移（漏一个即高亮/读数偏 k 根）
    expect(src.includes('setHoverIndex(index => (index === null ? null : index + count))')).toBe(true)
    expect(src.includes('setRangeSelection(selection => (selection === null ? null : { start: selection.start + count, end: selection.end + count }))')).toBe(true)
  })

  it('访客 QuoteStage 把前插回调接到 useKlineHistory 且不新增重复逻辑下标 state', () => {
    // Given QuoteStage 源码
    const src = readSource('../src/client/QuoteStage.tsx')
    // When / Then onPrepend 必须指向位移处理器；逻辑下标 state 仅 hoverIndex / rangeSelection
    expect(src.includes('useKlineHistory({ market, symbol, interval: chartInterval, onPrepend: handleKlinePrepend })')).toBe(true)
    const indexStates = src.match(/useState<number \| null>/g) ?? []
    expect(indexStates.length).toBe(1)
  })
})

describe('页大小单一口径（Q10）', () => {
  it('运营 QuoteStage 不残留重复的页大小常量', () => {
    // Given QuoteStage 源码
    const src = readSource('../src/client/QuoteStage.tsx')
    // When / Then 旧的本地常量与辅助函数必须全部迁走（一个数字只有一个家）
    expect(/KLINE_LIMIT_DEFAULT|KLINE_LIMIT_BY_MARKET|DAILY_LIMIT|KLINE_RESYNC_MS/.test(src)).toBe(false)
    expect(/klineLimit\s*\(/.test(src)).toBe(false)
  })

  it('用户 QuoteStage 的日线参考取数走同一页大小出口', () => {
    // Given QuoteStage 源码
    const src = readSource('../src/client/QuoteStage.tsx')
    // When / Then 日线参考取数必须经 klinePageSize(market, '1d')
    expect(src.includes("fetchKlines(market, symbol, '1d', klinePageSize(market, '1d'))")).toBe(true)
  })

  it('客户 useKlineHistory 的分页页大小也经同一函数解析', () => {
    // Given 分页 hook 源码
    const src = readSource('../src/client/useKlineHistory.ts')
    // When / Then 页大小经 klinePageSize 解析，且不得内联任何页大小常量
    expect(src.includes('const pageSize = klinePageSize(market, interval)')).toBe(true)
    expect(/KLINE_PAGE_SIZE_|KLINE_LIMIT_|DAILY_LIMIT/.test(src)).toBe(false)
  })
})

describe('客户端取数面契约（跨包红线）', () => {
  it('管理员 fetchKlines 签名与返回类型逐字未变且未新增分页函数进服务面', () => {
    // Given client api 源码
    const src = readSource('../src/client/api.ts')
    // When / Then 跨包 face 契约的签名逐字保留
    expect(src.includes('export async function fetchKlines(market: MarketId, symbol: string, interval: string, limit: number): Promise<Kline[]>')).toBe(true)
    expect(src.includes('fetchKlines: typeof fetchKlines')).toBe(true)
    // 且分页函数不在 TradingBridgeService 面内
    expect(src.includes('fetchKlinesPage:')).toBe(false)
  })
})
