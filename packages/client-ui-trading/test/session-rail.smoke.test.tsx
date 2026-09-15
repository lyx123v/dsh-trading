/**
 * SessionRail 容器让位冒烟（2026-09-15 评审 L4 回归）：新建会话 = 换一个对话列容器，
 * 旧容器上的覆盖面必须整体让位（此前只收定时任务，资产/快讯/宏观/文件继续盖住新会话），
 * 并收起宿主右侧栏。
 *
 * 折叠会话列仍只切折叠态：文件面板在折叠态由 shell-pad.css 规则 14b 转 fixed 浮动兜底
 * （0 宽轨道上不会隐形），所以折叠不联动面板——本用例把这个语义钉住。
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    fetchFlash: async () => ({ items: [], hasMore: false }),
  }
})

import { SessionRail } from '../src/client/SessionRail.tsx'

/** key 直出翻译（断言用 key 而非文案，与词典解耦）。 */
const t = (key: MarketLocaleKey): string => key

interface Calls {
  startNewSession: number
  toggleFold: number
  collapseRightbar: number
  openFilesPanel: number
}

function renderRail(filesOpen = false): { calls: Calls; view: ReturnType<typeof render> } {
  const calls: Calls = { startNewSession: 0, toggleFold: 0, collapseRightbar: 0, openFilesPanel: 0 }
  const view = render(
    <SessionRail
      t={t}
      useFolded={<T,>(sel: (value: boolean) => T): T => sel(false)}
      useRightbar={<T,>(sel: (value: boolean) => T): T => sel(filesOpen)}
      startNewSession={() => { calls.startNewSession += 1 }}
      toggleFold={() => { calls.toggleFold += 1 }}
      openSession={() => {}}
      openFilesPanel={() => { calls.openFilesPanel += 1 }}
      collapseRightbar={() => { calls.collapseRightbar += 1 }}
    />,
  )
  return { calls, view }
}

/** 打开快讯面板（真实面板 mount，数据面走 api 桩）。 */
async function openFlashPanel(view: { container: HTMLElement }): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'stage.flash' }))
  await waitFor(() => { expect(view.container.querySelector('[data-dshtrading-flash-panel]')).not.toBeNull() })
}

describe('SessionRail 新建会话/折叠的容器让位', () => {
  afterEach(() => cleanup())

  it('新建会话：收起全部功能面板（不只定时任务）并收起宿主右侧栏', async () => {
    const { calls, view } = renderRail()
    await openFlashPanel(view)
    // 打开任何功能页签本身就会互斥收起宿主右栏（toggleX(true) 的既有语义），
    // 故基线取打开后的计数，只断言「新建会话」这一步的增量。
    const collapsedBefore = calls.collapseRightbar

    fireEvent.click(screen.getByRole('button', { name: 'entry.new' }))
    expect(calls.startNewSession).toBe(1)
    expect(calls.collapseRightbar).toBe(collapsedBefore + 1)
    await waitFor(() => { expect(view.container.querySelector('[data-dshtrading-flash-panel]')).toBeNull() })
  })

  it('折叠会话列：只切折叠态，面板留给规则 14b 浮动兜底（不联动收起）', async () => {
    const { calls, view } = renderRail()
    await openFlashPanel(view)
    const collapsedBefore = calls.collapseRightbar

    fireEvent.click(screen.getByRole('button', { name: 'chat.fold' }))
    expect(calls.toggleFold).toBe(1)
    expect(calls.collapseRightbar).toBe(collapsedBefore)
    expect(view.container.querySelector('[data-dshtrading-flash-panel]')).not.toBeNull()
  })

  it('文件页签：展开态点击收起宿主右栏，收起态点击走官方 openTab 通路', async () => {
    const open = renderRail(true)
    fireEvent.click(screen.getByRole('button', { name: 'files.open' }))
    expect(open.calls.collapseRightbar).toBe(1)
    expect(open.calls.openFilesPanel).toBe(0)
    open.view.unmount()

    const closed = renderRail(false)
    fireEvent.click(screen.getByRole('button', { name: 'files.open' }))
    expect(closed.calls.openFilesPanel).toBe(1)
    expect(closed.calls.collapseRightbar).toBe(0)
  })
})
