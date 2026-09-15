/**
 * rightbar-store：宿主右侧栏展开状态镜像契约。
 *
 * 快照语义 = frame data-rightbar-collapsed 的反像（true = 宿主 dock 展开）；
 * 宿主未挂载（frame 不存在）恒 false；观察器随首订阅安装、末退订断开，
 * 重订阅时重读当前 DOM（断开期间的变化不丢状态，只丢中间通知）。
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rightbarStore } from '../src/client/rightbar-store.ts'

/** 挂一个宿主 frame 最小骨架：overlayLayer 的父元素即 AppFrame。 */
function mountFrame(collapsed: boolean): HTMLElement {
  document.body.innerHTML = ''
  const frame = document.createElement('div')
  const overlay = document.createElement('div')
  overlay.dataset.shellOverlay = ''
  frame.appendChild(overlay)
  if (collapsed) frame.setAttribute('data-rightbar-collapsed', '')
  document.body.appendChild(frame)
  return frame
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

  it('订阅时同步当前 DOM：收起（有属性）false，展开（无属性）true', () => {
    const store = rightbarStore()

    mountFrame(true)
    let unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(false)
    unsubscribe()

    mountFrame(false)
    unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toBe(true)
    unsubscribe()
  })

  it('宿主写入/移除 data-rightbar-collapsed 时观察器翻转快照', async () => {
    const frame = mountFrame(true)
    const store = rightbarStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    expect(store.getSnapshot()).toBe(false)

    frame.removeAttribute('data-rightbar-collapsed')
    await settle()
    await vi.waitFor(() => { expect(store.getSnapshot()).toBe(true) })
    expect(listener).toHaveBeenCalled()

    frame.setAttribute('data-rightbar-collapsed', '')
    await vi.waitFor(() => { expect(store.getSnapshot()).toBe(false) })
    unsubscribe()
  })

  it('末个退订断开观察器；重订阅重读当前 DOM（断开期间的变化不丢状态）', async () => {
    const frame = mountFrame(true)
    const store = rightbarStore()
    const unsubscribe = store.subscribe(() => {})
    unsubscribe()

    // 断开期间宿主展开：无通知（listener 不在），状态不丢。
    frame.removeAttribute('data-rightbar-collapsed')
    await settle()
    expect(store.getSnapshot()).toBe(false)

    const listener = vi.fn()
    const resubscribe = store.subscribe(listener)
    expect(store.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalled()
    resubscribe()
  })
})
