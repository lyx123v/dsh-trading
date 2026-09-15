/**
 * rightbar-store：宿主右侧栏展开状态镜像契约。
 *
 * 快照语义 = **宿主面板自己的展开标记** data-sidebar-right-open（面板收起后仍挂载
 * 在 DOM 里，只是被 transform 推到 frame 右缘之外）；宿主未挂载（面板不存在）恒
 * false；观察器随首订阅安装、末退订断开，重订阅时重读当前 DOM（断开期间的变化不丢
 * 状态，只丢中间通知）。
 *
 * 关键反例（2026-09-15 评审 M1）：视口 < 768px 的 autoFullscreen 下宿主「面板已
 * 展开但右栏轨道宽为 0」，frame 会带 data-rightbar-collapsed——读那个属性会把页签
 * 状态读反，本组用例把它钉死。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rightbarStore } from '../src/client/rightbar-store.ts'

interface HostOptions {
  /** 宿主面板已展开（写 data-sidebar-right-open）。 */
  shown: boolean
  /** 右栏**轨道**宽为 0（frame 写 data-rightbar-collapsed，窄窗口/折叠态都会写）。 */
  trackCollapsed?: boolean
  /** 宿主面板是否存在（旧宿主 ≤0.1.4 没有 sidebar-right dock）。 */
  mounted?: boolean
}

/** 挂一个宿主 frame 最小骨架：overlayLayer 的父元素即 AppFrame，面板挂 rightbar 列。 */
function mountHost(options: HostOptions): { frame: HTMLElement; panel: HTMLElement } {
  document.body.innerHTML = ''
  const frame = document.createElement('div')
  const overlay = document.createElement('div')
  overlay.dataset.shellOverlay = ''
  frame.appendChild(overlay)

  const column = document.createElement('div')
  column.setAttribute('data-rightbar-col', '')
  const panel = document.createElement('div')
  panel.setAttribute('data-sidebar-right-panel', 'push')
  if (options.shown) panel.setAttribute('data-sidebar-right-open', 'true')
  if (options.mounted !== false) column.appendChild(panel)
  frame.appendChild(column)

  if (options.trackCollapsed === true) frame.setAttribute('data-rightbar-collapsed', 'true')
  document.body.appendChild(frame)
  return { frame, panel }
}

async function settle(): Promise<void> {
  await vi.waitFor(() => { /* MutationObserver 投递等一个宏任务即可 */ }, { timeout: 200, interval: 10 })
}

describe('rightbarStore', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('宿主未挂载时快照恒 false', () => {
    const store = rightbarStore()
    const unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(false)
    unsubscribe()
  })

  it('旧宿主（没有 sidebar-right 面板）恒 false：页签不该被点成常亮并隐去对话列', () => {
    mountHost({ shown: false, mounted: false })
    const store = rightbarStore()
    const unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(false)
    unsubscribe()
  })

  it('订阅时同步当前 DOM：面板收起 false，展开 true', () => {
    const store = rightbarStore()

    mountHost({ shown: false })
    let unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(false)
    unsubscribe()

    mountHost({ shown: true })
    unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(true)
    unsubscribe()
  })

  it('轨道宽为 0 但面板已展开（视口 <768px 的 autoFullscreen）→ 快照仍 true', () => {
    // 回归 M1：旧实现读 frame[data-rightbar-collapsed]，这里会读成 false。
    mountHost({ shown: true, trackCollapsed: true })
    const store = rightbarStore()
    const unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(true)
    unsubscribe()
  })

  it('宿主翻转面板展开标记时观察器翻转快照（轨道属性变化不影响快照）', async () => {
    const { frame, panel } = mountHost({ shown: false })
    const store = rightbarStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    expect(store.getSnapshot()).toBe(false)

    panel.setAttribute('data-sidebar-right-open', 'true')
    await settle()
    await vi.waitFor(() => { expect(store.getSnapshot()).toBe(true) })
    expect(listener).toHaveBeenCalled()

    // 窄窗口：面板仍展开、轨道被归零 —— 快照必须保持 true
    frame.setAttribute('data-rightbar-collapsed', 'true')
    await settle()
    expect(store.getSnapshot()).toBe(true)

    panel.removeAttribute('data-sidebar-right-open')
    await vi.waitFor(() => { expect(store.getSnapshot()).toBe(false) })
    unsubscribe()
  })

  it('末个退订断开观察器；重订阅重读当前 DOM（断开期间的变化不丢状态）', async () => {
    const { panel } = mountHost({ shown: false })
    const store = rightbarStore()
    const unsubscribe = store.subscribe(() => {})
    unsubscribe()

    // 断开期间宿主展开：无通知（listener 不在），状态不丢。
    panel.setAttribute('data-sidebar-right-open', 'true')
    await settle()
    expect(store.getSnapshot()).toBe(false)

    const listener = vi.fn()
    const resubscribe = store.subscribe(listener)
    expect(store.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalled()
    resubscribe()
  })
})
