/**
 * 特殊指标视图渲染测试（jsdom）：二级页签切换与持久化、未配置引导、
 * 状态桥故障占位、面板隔离。零 mock：桥 fetch 为契约化 fake（真实
 * Response），CSS Modules 类表在 vitest 下为空表、cx() 回落原始类名；
 * 历史序列留空使 LineChart 不实例化（jsdom 无 canvas 实现）。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpecialIndicatorsView } from '../src/client/SpecialIndicatorsView.tsx'
import { zh } from '../src/client/locales.ts'
import type { SpecialIndicatorsLocaleKey } from '../src/client/contract.ts'

/** 与 dsh-client-locale 插值器同口径的 {name} 替换（测试面，不做 \$\$ 转义）。 */
function interpolate(template: string, params?: Record<string, unknown>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

const t = (key: SpecialIndicatorsLocaleKey, params?: Record<string, unknown>): string => interpolate(zh[key], params)

const MOUNT = '/dshtrading/api/special-indicators'

function fixtureFor(url: string): { status?: number; body: unknown } {
  if (url.endsWith(MOUNT + '/status')) return { body: { ok: true, configured: true, baseUrl: 'https://finance.example.test', username: 'api' } }
  if (url.includes('/basis/snapshot')) {
    return {
      body: {
        products: [
          { key: 'IF', name: '沪深300', t: [], ts: [], s: [], f: [], b: [], pct: [], last_spot: 4460.4, last_fut: 4386.2, last_dt: '15:00' },
          { key: 'IM', name: '中证1000', t: [], ts: [], s: [], f: [], b: [], pct: [], last_spot: 7550.1, last_fut: 7381.9, last_dt: '15:00' },
        ],
        stats: {
          IF: { min: 68.7, max: 83.6, mean: 78.8, last: 74.2, pct: 1.66, p25: 72, p75: 81, n: 241 },
          IM: { min: 154.7, max: 187.6, mean: 177.6, last: 168.2, pct: 2.23, p25: 165, p75: 182, n: 241 },
        },
      },
    }
  }
  if (url.includes('/basis/history')) return { body: { basis: { IF: [], IM: [] } } }
  if (url.includes('/sentiment/snapshot')) {
    return {
      body: {
        score: 42.65, label: 'fear', label_text: '恐惧', date: '2026-09-16', stale: false,
        average_5d: 29.24, vs_5d: 13.41,
        components: [{ key: 'cn_momentum', name: '全指动量', raw: -5.35, score: 7.8, direction: 'higher_fear' }],
        coverage: { valid: 1, total: 7, partial: false },
      },
    }
  }
  if (url.includes('/sentiment/history')) return { body: { series: [], overlay: [], snapshot: { score: 42.65, label: 'fear', date: '2026-09-16' } } }
  if (url.includes('/hk-short/snapshot')) {
    return {
      body: {
        data_date: '2026-09-16',
        five_day: { current_pct: 26.79, average_pct: 26.41, pct_difference: 0.38, current_value: 41.09, average_value: 55.2, value_difference: -14.11, index_5d_pct: -2.16 },
        top10: [{ code: '00700', name: '腾讯控股', weight: 8.0 }],
      },
    }
  }
  if (url.includes('/hk-short/chart')) return { body: { short_ratio: [], index: [], ratio_stats: null, top10: [], stale: false } }
  if (url.includes('/sectors/snapshot')) {
    return {
      body: {
        sectors: [{ code: '801951', name: '煤炭', type: 'sw' }],
        data_date: '2026-09-16', n_ready: 18, n_total: 18,
        five_day: { current_change: 12.3, average_change: 47.2, difference: -34.9, total_flow: -34.9, unit: '亿元' },
      },
    }
  }
  if (url.includes('/sectors/ranking')) {
    return { body: [{ code: '801951', name: '煤炭', type: 'sw', chg_pct: 5.48, latest_margin: 103.16, daily_change: -0.23, avg_5d_change: -0.09, total_5d_flow: -0.43, index_5d_pct: -3.87 }] }
  }
  return { status: 404, body: { error: 'unknown' } }
}

/** 契约化 fake fetch：按子路由回真实 Response，记录调用面供断言。 */
function installFakeFetch(overrides?: Record<string, { status?: number; body?: unknown } | 'reject'>) {
  const calls: string[] = []
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (url.includes(key)) {
        if (value === 'reject') throw new Error('bridge down')
        return new Response(JSON.stringify(value.body ?? {}), { status: value.status ?? 200, headers: { 'content-type': 'application/json' } })
      }
    }
    const fixture = fixtureFor(url)
    return new Response(JSON.stringify(fixture.body), { status: fixture.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  const original = globalThis.fetch
  globalThis.fetch = impl as typeof globalThis.fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

let restoreFetch: () => void = () => undefined
let restoreStorage: () => void = () => undefined

/**
 * 内存版 localStorage 契约假件：jsdom 在本 vitest 面下 localStorage 是空壳
 * （与 client-ui-trading market-sidebar 冒烟测试同口径的实证结论），
 * 持久化断言用 defineProperty 遮蔽为完整 Storage 面；视图自身的 try/catch
 * 在无假件时静默降级，两种面都测。
 */
function installMemoryStorage() {
  const store = new Map<string, string>()
  const fake = {
    getItem: (k: string): string | null => (store.has(k) ? (store.get(k) ?? null) : null),
    setItem: (k: string, v: string): void => { store.set(k, v) },
    removeItem: (k: string): void => { store.delete(k) },
    clear: (): void => { store.clear() },
    key: (i: number): string | null => [...store.keys()][i] ?? null,
    get length(): number { return store.size },
  }
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true })
  return {
    store,
    restore: (): void => {
      if (original !== undefined) Object.defineProperty(window, 'localStorage', original)
    },
  }
}

beforeEach(() => {
  // jsdom 空壳 localStorage 下视图降级为不持久化，无需清理。
})

afterEach(() => {
  restoreFetch()
  restoreStorage()
  cleanup()
})

describe('特殊指标二级页签', () => {
  it('用户打开视图时默认落在恐慌指数页签且四个页签齐备', async () => {
    // Given: 桥全量可用
    const fake = installFakeFetch()
    restoreFetch = fake.restore
    // When: 用户打开特殊指标视图
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    // Then: 四个二级页签齐备，恐慌指数默认选中并渲染其卡片内容
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((el) => el.textContent)).toEqual(['A 股恐慌指数', 'IF / IM 期现基差', '恒科权重股卖空', '板块融资余额'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('42.6')).toBeTruthy()
    expect(fake.calls.some((u) => u.includes('/status'))).toBe(true)
  })

  it('用户切换页签时只渲染对应指标卡片并把选择写入持久化', async () => {
    // Given: 内存 Storage + 视图已渲染在默认页签
    const storage = installMemoryStorage()
    restoreStorage = storage.restore
    const fake = installFakeFetch()
    restoreFetch = fake.restore
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    await screen.findByText('42.6')
    // When: 用户点击「IF / IM 期现基差」页签
    fireEvent.click(screen.getByRole('tab', { name: 'IF / IM 期现基差' }))
    // Then: 基差卡片可见、恐慌卡片卸载，localStorage 持久化为 basis
    expect(await screen.findByText('IF 沪深300')).toBeTruthy()
    expect(screen.queryByText('分项（1/7 有效）')).toBeNull()
    expect(storage.store.get('dshtrading.special-indicators.tab.v1')).toBe('"basis"')
  })

  it('用户重开视图时回落到上次选择的二级页签', async () => {
    // Given: 内存 Storage 中上次会话持久化为恒科页签
    const storage = installMemoryStorage()
    restoreStorage = storage.restore
    storage.store.set('dshtrading.special-indicators.tab.v1', '"hkshort"')
    const fake = installFakeFetch()
    restoreFetch = fake.restore
    // When: 用户重开视图
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    // Then: 恒科页签选中并渲染其聚合占比
    expect(await screen.findByText('26.79%')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '恒科权重股卖空' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('特殊指标视图故障面', () => {
  it('用户未配置凭据时视图显示设置引导占位而非裸错误', async () => {
    // Given: 桥 status 回报未配置
    const fake = installFakeFetch({ '/status': { body: { ok: true, configured: false, baseUrl: 'https://finance.example.test', username: '' } } })
    restoreFetch = fake.restore
    // When: 用户打开视图
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    // Then: 未配置引导占位出现，且不再发起任何数据子路由请求
    expect(await screen.findByText('特殊指标未配置')).toBeTruthy()
    expect(fake.calls.filter((u) => !u.endsWith(MOUNT + '/status')).length).toBe(0)
  })

  it('用户遭遇状态桥故障时视图显示错误占位而非白屏', async () => {
    // Given: status 路由抛错
    const fake = installFakeFetch({ '/status': 'reject' })
    restoreFetch = fake.restore
    // When: 用户打开视图
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    // Then: 错误占位展示异常消息（不静默白屏）
    expect(await screen.findByText(/加载失败/)).toBeTruthy()
  })

  it('用户单面板数据失败时其余面板照常渲染（allSettled 面板隔离）', async () => {
    // Given: 仅恐慌指数快照失败，其余正常
    const fake = installFakeFetch({ '/sentiment/snapshot': 'reject' })
    restoreFetch = fake.restore
    render(<SpecialIndicatorsView t={t} view="special-indicators" />)
    // When: 用户切到板块融资页签
    fireEvent.click(await screen.findByRole('tab', { name: '板块融资余额' }))
    // Then: 板块表格照常渲染；恐慌页签内容区显示该面板自身错误
    expect(await screen.findByText('煤炭')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'A 股恐慌指数' }))
    expect(await screen.findAllByText(/bridge down/)).not.toHaveLength(0)
  })
})