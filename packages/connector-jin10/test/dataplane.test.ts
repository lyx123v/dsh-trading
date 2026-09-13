import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/dataplane.js'
import type { Config } from '../src/plugin.js'

interface RegistryCall {
  market: string
  provider: string
  service: unknown
}

function makeCtx(): {
  ctx: Context
  registered: RegistryCall[]
  provided: Array<{ key: string; value: unknown }>
  disposed: number
} {
  const registered: RegistryCall[] = []
  const provided: Array<{ key: string; value: unknown }> = []
  const state = { disposed: 0 }
  const ctx = {
    get: (key: string) => (key === 'tradingMarketDataRegistry'
      ? { register: (market: string, provider: string, service: unknown) => {
        registered.push({ market, provider, service })
        return () => { state.disposed += 1 }
      } }
      : undefined),
    reflect: { provide: (key: string, value: unknown) => { provided.push({ key, value }) } },
    effect: (run: () => () => void) => run(),
  } as unknown as Context
  return { ctx, registered, provided, get disposed() { return state.disposed } } as never
}

const ENABLED = { enabled: true, endpoint: 'https://mcp.jin10.com/mcp', tokenRef: 'JIN10_MCP_TOKEN', timeoutMs: 1000 } as Config

describe('dsh-trading-global-dataplane-jin10（global 市场路由接线）', () => {
  it('provide tradingGlobalMarketData + 向注册表登记 (global, jin10)', () => {
    const harness = makeCtx() as unknown as { ctx: Context; registered: RegistryCall[]; provided: Array<{ key: string; value: unknown }>; disposed: number }
    apply(harness.ctx, ENABLED)
    expect(harness.provided).toHaveLength(1)
    expect(harness.provided[0]?.key).toBe('tradingGlobalMarketData')
    expect(harness.registered).toHaveLength(1)
    expect(harness.registered[0]?.market).toBe('global')
    expect(harness.registered[0]?.provider).toBe('jin10')
    expect(harness.registered[0]?.service).toBe(harness.provided[0]?.value)
  })

  it('enabled=false：不 provide、不注册（行照常挂载，无副作用）', () => {
    const harness = makeCtx() as unknown as { ctx: Context; registered: RegistryCall[]; provided: unknown[] }
    apply(harness.ctx, { ...ENABLED, enabled: false })
    expect(harness.provided).toHaveLength(0)
    expect(harness.registered).toHaveLength(0)
  })

  it('注册表缺席（老部署）：只 provide，不崩', () => {
    const provided: Array<{ key: string }> = []
    const ctx = {
      get: () => undefined,
      reflect: { provide: (key: string) => { provided.push({ key }) } },
      effect: (run: () => () => void) => run(),
    } as unknown as Context
    expect(() => apply(ctx, ENABLED)).not.toThrow()
    expect(provided.map(entry => entry.key)).toEqual(['tradingGlobalMarketData'])
  })
})
