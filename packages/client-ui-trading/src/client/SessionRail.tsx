/**
 * 会话竖条（2.9）：右缘常驻功能栏，参考同花顺式右侧竖排工具栏。
 *
 * - 永不隐藏：折叠只收会话列轨道（fold-store → shell-pad.css 规则 9），
 *   竖条始终占住右缘 44px（shell-pad.css 规则 8 预留的侧栏轨道），会话
 *   进行中也在——取代 2.8「右上浮动簇 + 会话头内联按钮」双入口。
 * - 结构自上而下：折叠/展开、新会话、分隔线、功能页签（定时任务、资产、
 *   快讯、文件）；设置入口 3.0 起迁往左侧自选面板底部（MarketDock），
 *   竖条不再承载。
 * - 功能页签 = 对话列容器的切换页签：激活时对话列内容被隐去（shell-pad.css
 *   规则 11/12），面板原位覆盖同一列——与对话非并排、同一容器二选一；
 *   状态走 body[data-dshtrading-*] 联动。定时任务（3.0）、资产面板
 *   （2026-09-05）、快讯（2026-09-13）、文件（2026-09-15）互斥：
 *   同一条轨道同时只容一个覆盖面。
 * - 文件页签（2026-09-15）是宿主右侧栏 dock 的容器化：面板本体是官方
 *   sidebar-right（文件/预览等原生页签，CSS 规则 14 把宿主列搬进本容器位），
 *   页签激活态 = 宿主 dock 展开态（rightbar-store 镜像 frame 的
 *   data-rightbar-collapsed 反像），宿主侧打开（对话文件链接等）同样点亮本页签。
 * - 资产面板开关走 holdings-store 的 holdingsPanelStore（共享单例）：
 *   QuoteStage 下单成功后 setHoldingsPanelOpen(true) 跨树联动打开。
 * - 折叠态同步 body[data-dshtrading-chat-folded] 的 effect 从旧 WindowChrome
 *   移入本组件（竖条恒挂载，单一同步点）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FoldStore } from './fold-store.ts'
import type { RightbarStore } from './rightbar-store.ts'
import { holdingsPanelStore, setHoldingsPanelOpen } from './holdings-store.ts'
import { IconClock, IconFlash, IconFolder, IconFoldPanel, IconNewSession, IconWallet } from './icons.tsx'
import { ScheduledTasksPanel } from './ScheduledTasksPanel.tsx'
import { HoldingsPanel } from './HoldingsPanel.tsx'
import { FlashPanel } from './FlashPanel.tsx'
import type { FillComposerFn } from './fill-composer.ts'
import css from './session-rail.module.css'

export interface SessionRailInjected {
  startNewSession(): void
  toggleFold(): void
  /** 定时任务执行历史「打开会话」（官方 sessions 通路，index.ts 注入）。 */
  openSession(sessionId: string): void
  /** 会话输入框填入入口（资产面板「导入持仓」只填不发；index.ts 注入）。 */
  fillComposer?: FillComposerFn | undefined
  /** 文件页签 ON：宿主 sidebarRight.openTab('files')（index.ts 注入）。 */
  openFilesPanel(): void
  /** 文件页签 OFF / 自有面板互斥：收起宿主右侧栏（index.ts 注入）。 */
  collapseRightbar(): void
  hooks: { folded: FoldStore; rightbar: RightbarStore }
}

export type SessionRailProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'dshtrading.market'>
  & InjectFace<SessionRailInjected>

export function SessionRail({ t, useFolded, useRightbar, startNewSession, toggleFold, openSession, fillComposer, openFilesPanel, collapseRightbar }: SessionRailProps) {
  const folded = useFolded(value => value)
  // 定时任务页签（功能页签 1 号）：会话级开关（无需持久化——每次进来默认收起）。
  const [tasksOpen, setTasksOpen] = useState(false)
  // 资产面板（功能页签 2 号）：开关在共享 store（QuoteStage 下单联动），
  // 本组件是渲染点与 rail 页签入口；与定时任务互斥（同一容器二选一）。
  const holdingsOpen = useSyncExternalStore(holdingsPanelStore.subscribe, holdingsPanelStore.getSnapshot)
  // 快讯页签（功能页签 3 号，2026-09-13）：从中间容器迁来；与定时任务/资产互斥。
  const [flashOpen, setFlashOpen] = useState(false)
  // 文件页签（功能页签 4 号，2026-09-15）：宿主右侧栏 dock 展开态的镜像
  // （rightbar-store），不是本组件的私有开关——宿主侧入口同样点亮/熄灭。
  const filesOpen = useRightbar(value => value)

  useEffect(() => {
    document.body.dataset.dshtradingChatFolded = folded ? 'on' : 'off'
    return () => { delete document.body.dataset.dshtradingChatFolded }
  }, [folded])

  useEffect(() => {
    document.body.dataset.dshtradingTasksOpen = tasksOpen ? 'on' : 'off'
    return () => { delete document.body.dataset.dshtradingTasksOpen }
  }, [tasksOpen])

  useEffect(() => {
    document.body.dataset.dshtradingHoldingsOpen = holdingsOpen ? 'on' : 'off'
    return () => { delete document.body.dataset.dshtradingHoldingsOpen }
  }, [holdingsOpen])

  useEffect(() => {
    document.body.dataset.dshtradingFlashOpen = flashOpen ? 'on' : 'off'
    return () => { delete document.body.dataset.dshtradingFlashOpen }
  }, [flashOpen])

  useEffect(() => {
    document.body.dataset.dshtradingFilesOpen = filesOpen ? 'on' : 'off'
    return () => { delete document.body.dataset.dshtradingFilesOpen }
  }, [filesOpen])

  // 互斥联动（四页签共用同一容器）：资产面板打开（含 QuoteStage 下单成功
  // 的跨树联动）→ 收定时任务/快讯并收起宿主右侧栏。
  useEffect(() => {
    if (holdingsOpen) { setTasksOpen(false); setFlashOpen(false); collapseRightbar() }
  }, [holdingsOpen])

  // 宿主右侧栏展开（含宿主侧打开，如对话内文件链接）→ 收定时任务/资产/快讯。
  useEffect(() => {
    if (filesOpen) { setTasksOpen(false); setHoldingsPanelOpen(false); setFlashOpen(false) }
  }, [filesOpen])

  const toggleTasks = (next: boolean): void => {
    setTasksOpen(next)
    if (next) { setHoldingsPanelOpen(false); setFlashOpen(false); collapseRightbar() }
  }

  const toggleFlash = (next: boolean): void => {
    setFlashOpen(next)
    if (next) { setTasksOpen(false); setHoldingsPanelOpen(false); collapseRightbar() }
  }

  const toggleHoldings = (next: boolean): void => {
    setHoldingsPanelOpen(next)
    if (next) { setTasksOpen(false); setFlashOpen(false); collapseRightbar() }
  }

  return (
    <div className={css.rail} data-dshtrading-rail="" role="toolbar" aria-orientation="vertical">
      <button
        type="button"
        className={css.button}
        aria-pressed={folded}
        aria-label={folded ? t('chat.expand') : t('chat.fold')}
        title={folded ? t('chat.expand') : t('chat.fold')}
        onClick={toggleFold}
      >
        <IconFoldPanel size={16} />
      </button>
      <button
        type="button"
        className={css.button}
        aria-label={t('entry.new')}
        title={t('entry.new')}
        onClick={() => { toggleTasks(false); collapseRightbar(); startNewSession() }}
      >
        <IconNewSession size={16} />
      </button>
      {/* 功能页签扩展位：分隔线下方（注释见 2.9 定稿）；激活时与对话列同容器
          切换（见文件头注），复用 .button 样式保持竖条节奏。 */}
      <div className={css.divider} aria-hidden="true" />
      <button
        type="button"
        className={css.button}
        aria-pressed={tasksOpen}
        aria-label={t('tasks.open')}
        title={t('tasks.open')}
        onClick={() => { toggleTasks(!tasksOpen) }}
      >
        <IconClock size={16} />
      </button>
      <button
        type="button"
        className={css.button}
        aria-pressed={holdingsOpen}
        aria-label={t('trade.holdings.panel.open')}
        title={t('trade.holdings.panel.open')}
        onClick={() => { toggleHoldings(!holdingsOpen) }}
      >
        <IconWallet size={16} />
      </button>
      <button
        type="button"
        className={css.button}
        aria-pressed={flashOpen}
        aria-label={t('stage.flash')}
        title={t('stage.flash')}
        onClick={() => { toggleFlash(!flashOpen) }}
      >
        <IconFlash size={16} />
      </button>
      {/* 文件页签 = 宿主右侧栏 dock（官方 sidebar-right）：ON 走官方导航
          openTab('files')（幂等揭示 + 展开列），OFF 收起列；激活态镜像自
          宿主（rightbar-store），故 aria-pressed 不是本地开关回写。 */}
      <button
        type="button"
        className={css.button}
        aria-pressed={filesOpen}
        aria-label={t('files.open')}
        title={t('files.open')}
        onClick={() => { if (filesOpen) collapseRightbar(); else openFilesPanel() }}
      >
        <IconFolder size={16} />
      </button>
      {tasksOpen && (
        <ScheduledTasksPanel
          t={t}
          openSession={(sessionId) => { toggleTasks(false); openSession(sessionId) }}
          close={() => { toggleTasks(false) }}
        />
      )}
      {holdingsOpen && (
        <HoldingsPanel
          t={t}
          fillComposer={fillComposer}
          onClose={() => { setHoldingsPanelOpen(false) }}
        />
      )}
      {flashOpen && (
        <FlashPanel
          t={t}
          onClose={() => { setFlashOpen(false) }}
        />
      )}
    </div>
  )
}
