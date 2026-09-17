/**
 * 多序列小线图（lightweight-charts v5 薄封装）：
 * - 1–2 条日频序列，支持左/右双价格轴（score 0–100 与指数点位不同量纲）。
 * - series 引用变化即整体重建（数据每次刷新整体到达，重建成本 < 一帧；
 *   与 StrategyView 权益曲线同款生命周期纪律：卸载即 chart.remove()）。
 */
import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type Time,
} from 'lightweight-charts'
import type { ChartPoint } from './wire.ts'

export interface LineChartSeries {
  id: string
  points: ChartPoint[]
  color: string
  /** 价格轴：默认 right；左轴用于第二量纲。 */
  scale?: 'left' | 'right'
  /** area = 渐变填充面积图，默认细线。 */
  area?: boolean
  title?: string
}

export interface LineChartProps {
  series: LineChartSeries[]
  height?: number
}

export function LineChart({ series, height = 160 }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null || series.every((s) => s.points.length === 0)) return

    const chart: IChartApi = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8e95a3',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(128, 128, 128, 0.08)' },
        horzLines: { color: 'rgba(128, 128, 128, 0.08)' },
      },
      timeScale: { borderColor: 'rgba(128, 128, 128, 0.25)' },
      rightPriceScale: { borderColor: 'rgba(128, 128, 128, 0.25)' },
      leftPriceScale: { visible: series.some((s) => s.scale === 'left'), borderColor: 'rgba(128, 128, 128, 0.25)' },
      crosshair: { vertLine: { labelVisible: false } },
    })

    for (const s of series) {
      if (s.points.length === 0) continue
      const common = {
        priceScaleId: s.scale ?? 'right',
        title: s.title ?? '',
        priceLineVisible: false,
        lastValueVisible: true,
      }
      const data = s.points.map((p) => ({ time: p.time as Time, value: p.value }))
      if (s.area === true) {
        chart.addSeries(AreaSeries, {
          ...common,
          lineColor: s.color,
          topColor: s.color + '55',
          bottomColor: s.color + '08',
          lineWidth: 2,
        }).setData(data)
      } else {
        chart.addSeries(LineSeries, { ...common, color: s.color, lineWidth: 2 }).setData(data)
      }
    }
    chart.timeScale().fitContent()

    const handleResize = () => {
      if (containerRef.current !== null) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [series, height])

  return <div ref={containerRef} style={{ height }} />
}
