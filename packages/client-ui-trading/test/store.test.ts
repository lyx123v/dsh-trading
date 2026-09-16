/**
 * Client 纯逻辑单测：observable、自选 store（含种子回落与持久化）、
 * 行选择辅助。localStorage 用 vi.stubGlobal 假件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoreMap = Map<string, string>
const backing: StoreMap = new Map()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => { backing.set(key, value) },
  removeItem: (key: string) => { backing.delete(key) },
})

import type { Instrument } from '../src/client/types.ts'
import {
  applyLocalMembership,
  createObservable,
  createSelectionStore,
  createWatchlistGroupsStore,
  createWatchlistStore,
  rowsFor,
  sameInstrument,
} from '../src/client/store.ts'

beforeEach(() => { backing.clear() })

describe('createObservable', () => {
  it('set/update 触发订阅，退订后不再触发', () => {
    const store = createObservable({ count: 0 })
    const seen: number[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot().count) })
    store.set({ count: 1 })
    store.update(current => ({ count: current.count + 1 }))
    off()
    store.set({ count: 99 })
    expect(seen).toEqual([1, 2])
    expect(store.getSnapshot().count).toBe(99)
  })
})

describe('createSelectionStore（中栏切图选中标的）', () => {
  it('用户点选标的后重载仍恢复同一标的（GUI 点选持久化契约）', () => {
    // Given 全新客户端（localStorage 无选中值）
    const store = createSelectionStore()
    // When 用户在自选栏点选美股 AAPL
    store.select({ market: 'us', symbol: 'AAPL', name: '苹果' })
    // Then 快照与重载镜像都落在 AAPL
    expect(store.getSnapshot().instrument).toEqual({ market: 'us', symbol: 'AAPL', name: '苹果' })
    expect(createSelectionStore().getSnapshot().instrument).toEqual({ market: 'us', symbol: 'AAPL', name: '苹果' })
  })

  it('用户经 watchlist_select 工具换标的后，桥降级重载不回落旧标的（host 落地同步写镜像）', () => {
    // Given 本地已由 GUI 点选 AAPL（镜像里是旧标的）
    const store = createSelectionStore()
    store.select({ market: 'us', symbol: 'AAPL' })
    // When host 权威选中值（工具写入后的 SSE 重拉）经 applyHost 落地为港股腾讯
    store.applyHost({ market: 'hk', symbol: '00700', name: '腾讯控股' })
    // Then 桥不可用时重载读到腾讯，而不是旧 AAPL
    expect(createSelectionStore().getSnapshot().instrument).toEqual({ market: 'hk', symbol: '00700', name: '腾讯控股' })
  })

  it('用户遇到 host 送达非法市场标记时按 symbol 回推，非法值不写进镜像', () => {
    // Given 一个选中 store
    const store = createSelectionStore()
    // When applyHost 送来市场标记非法的 AAPL
    store.applyHost({ market: 'nasdaq', symbol: 'AAPL' } as unknown as Instrument)
    // Then 市场按 symbol 回推为美股，非法字段不落盘
    expect(store.getSnapshot().instrument).toEqual({ market: 'us', symbol: 'AAPL' })
    expect(createSelectionStore().getSnapshot().instrument).toEqual({ market: 'us', symbol: 'AAPL' })
  })
})

describe('createWatchlistStore', () => {
  it('未定制 → 种子列表；add/remove 定制后持久化', () => {
    const store = createWatchlistStore()
    expect(store.isCustomized('crypto')).toBe(false)
    expect(store.listFor('crypto').map(row => row.symbol)).toContain('BTCUSDT')

    store.add('crypto', { market: 'crypto', symbol: 'TONUSDT' })
    expect(store.isCustomized('crypto')).toBe(true)
    expect(store.listFor('crypto').some(row => row.symbol === 'TONUSDT')).toBe(true)

    store.add('crypto', { market: 'crypto', symbol: 'TONUSDT' })
    expect(store.listFor('crypto').filter(row => row.symbol === 'TONUSDT')).toHaveLength(1)

    store.remove('crypto', 'TONUSDT')
    expect(store.listFor('crypto').some(row => row.symbol === 'TONUSDT')).toBe(false)
  })

  it('重载后从 localStorage 恢复（持久化契约）', () => {
    const first = createWatchlistStore()
    first.add('us', { market: 'us', symbol: 'TSLA', name: '特斯拉' })
    const second = createWatchlistStore()
    expect(second.listFor('us').some(row => row.symbol === 'TSLA')).toBe(true)
  })

  it('未定制状态下直接 remove 种子标的：物化定制列表并持久化', () => {
    const store = createWatchlistStore()
    expect(store.isCustomized('us')).toBe(false)
    expect(store.listFor('us').map(row => row.symbol)).toContain('AAPL')

    // 未定制状态下直接删除 AAPL
    store.remove('us', 'AAPL')
    expect(store.isCustomized('us')).toBe(true)
    expect(store.listFor('us').map(row => row.symbol)).toEqual(['MSFT', 'NVDA', 'GOOGL'])

    // 从 localStorage 恢复验证持久化
    const reloaded = createWatchlistStore()
    expect(reloaded.isCustomized('us')).toBe(true)
    expect(reloaded.listFor('us').map(row => row.symbol)).toEqual(['MSFT', 'NVDA', 'GOOGL'])
  })

  it('删光自选标的后保持空列表，不复活种子', () => {
    const store = createWatchlistStore()
    store.remove('cn', '600519')
    store.remove('cn', '000001')
    store.remove('cn', '601318')

    expect(store.isCustomized('cn')).toBe(true)
    expect(store.listFor('cn')).toEqual([])
    expect(rowsFor(store.getSnapshot(), 'cn')).toEqual([])

    // 重载后依然保持空列表
    const reloaded = createWatchlistStore()
    expect(reloaded.isCustomized('cn')).toBe(true)
    expect(reloaded.listFor('cn')).toEqual([])
    expect(rowsFor(reloaded.getSnapshot(), 'cn')).toEqual([])
  })

  it('rowsFor：定制列表优先（含空数组），仅缺键回落种子', () => {
    expect(rowsFor({}, 'hk').map(row => row.symbol)).toContain('00700')
    expect(rowsFor({ hk: [] }, 'hk')).toEqual([])
    expect(rowsFor({ hk: [{ market: 'hk', symbol: '00001', name: '长和' }] }, 'hk'))
      .toEqual([{ market: 'hk', symbol: '00001', name: '长和' }])
  })

  it('sameInstrument：market+symbol 二元组判定', () => {
    expect(sameInstrument({ market: 'us', symbol: 'AAPL' }, { market: 'us', symbol: 'AAPL' })).toBe(true)
    expect(sameInstrument({ market: 'us', symbol: 'AAPL' }, { market: 'crypto', symbol: 'AAPL' })).toBe(false)
  })
})

describe('watchlist groups（issue #82）', () => {
  it('add 时携带 groups 直落行上并在 localStorage 镜像保真；坏项清洗', () => {
    const store = createWatchlistStore()
    store.add('us', { market: 'us', symbol: 'AAPL', name: '苹果', groups: ['g_1', 'g_1', ''] })
    expect(store.listFor('us')[0]?.groups).toEqual(['g_1'])
    // 从 localStorage 重载：groups 字段保留
    const reloaded = createWatchlistStore()
    expect(reloaded.listFor('us')[0]?.groups).toEqual(['g_1'])
  })

  it('groups store：create/rename 本地降级路径 + 同名拒绝 + activeGroup 持久化', async () => {
    const store = createWatchlistGroupsStore()
    const created = await store.create('核心仓')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect((await store.create('核心仓')).reason).toBe('duplicate')
    expect((await store.create('  ')).reason).toBe('unavailable')

    const renamed = await store.rename(created.group.id, '观察仓')
    expect(renamed.ok).toBe(true)
    // 改名原位替换不挪顺序
    await store.create('备选')
    expect(store.getSnapshot().groups.map(group => group.name)).toEqual(['观察仓', '备选'])

    store.setActiveGroup(created.group.id)
    expect(store.getSnapshot().activeGroupId).toBe(created.group.id)
    // 重载后 activeGroupId 恢复
    const reloaded = createWatchlistGroupsStore()
    expect(reloaded.getSnapshot().activeGroupId).toBe(created.group.id)

    // 删除组降级路径 fail-closed；本地摘除后活动分组指向被删组 → 归位 null
    await expect(store.delete(created.group.id)).resolves.toBe(false)
    store.removeGroupLocal(created.group.id)
    expect(store.getSnapshot().activeGroupId).toBeNull()
    expect(store.getSnapshot().groups.map(group => group.name)).toEqual(['备选'])
  })

  it('applyLocalMembership：种子基线物化 + 移出清键', () => {
    const store = createWatchlistStore()
    applyLocalMembership(store, 'us', 'g_9', 'AAPL', true)
    const rows = store.listFor('us')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.find(row => row.symbol === 'AAPL')?.groups).toEqual(['g_9'])
    applyLocalMembership(store, 'us', 'g_9', 'AAPL', false)
    expect(store.listFor('us').find(row => row.symbol === 'AAPL')?.groups).toBeUndefined()
  })
})
