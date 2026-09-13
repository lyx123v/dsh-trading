/**
 * 市场快讯面板（右缘会话列容器的功能页签 3 号，2026-09-13）。
 *
 * 与定时任务/资产同款模式（SessionRail 竖条闪电按钮激活时原位覆盖对话列，
 * 非并排非悬浮）：三者互斥，同一容器同时只容一个覆盖面。状态由 SessionRail
 * 写 body[data-dshtrading-flash-open]，shell-pad.css 规则 13 隐去对话列内容；
 * 本组件是 fixed 面板，定位与宽度吃 frame 轨道变量（flash-panel.module.css）。
 *
 * 数据面 = host 面 tradingFlashFeed 服务（桥 /dshtrading/api/flash）：最新快讯流 +
 * cursor 翻页 + 关键词搜索；面板挂载期间 60s 轮询（与新闻面板同款节奏，切走即卸载）。
 * 数据源未安装/凭证缺失时显示可操作提示，绝不把失败画成「没有快讯」。
 */
import { useEffect, useState } from 'react'
import { fetchFlash } from './api.ts'
import { NewsFeedPane, type ClientNewsItem } from './NewsFeedPane.tsx'
import type { MarketLocaleKey } from './contract.ts'
import css from './flash-panel.module.css'

/** 轮询周期：快讯是秒级流，但面板无需实时推送（与新闻面板 60s 一致）。 */
const POLL_MS = 60_000
const PAGE_LIMIT = 30

export type FlashPanelTranslate = (key: MarketLocaleKey) => string

export interface FlashPanelProps {
  t: FlashPanelTranslate
  /** 关闭面板（竖条按钮/头部 ×）。 */
  onClose(): void
}

export function FlashPanel({ t, onClose }: FlashPanelProps) {
  const [items, setItems] = useState<readonly ClientNewsItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const page = await fetchFlash(appliedKeyword ? { keyword: appliedKeyword, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT })
      if (cancelled) return
      if (page === null) {
        setStatus('error')
        return
      }
      setItems(page.items)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setStatus('ready')
    }
    setStatus('loading')
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [appliedKeyword])

  const loadMore = async (): Promise<void> => {
    if (nextCursor === undefined || loadingMore) return
    setLoadingMore(true)
    const page = await fetchFlash({ cursor: nextCursor, limit: PAGE_LIMIT })
    setLoadingMore(false)
    if (page === null) {
      setStatus('error')
      return
    }
    setItems((previous) => [...previous, ...page.items])
    setNextCursor(page.nextCursor)
    setHasMore(page.hasMore)
    setStatus('ready')
  }

  return (
    <div className={css.panel} data-dshtrading-flash-panel="" role="panel" aria-label={t('stage.flash')}>
      <header className={css.head}>
        <strong className={css.title}>{t('stage.flash')}</strong>
        <span className={css.spacer} />
        <button type="button" className={css.closeBtn} aria-label={t('flash.close')} title={t('flash.close')} onClick={onClose}>×</button>
      </header>
      <div className={css.body}>
        <div className={css.toolbar}>
          <input
            className={css.searchInput}
            value={keyword}
            placeholder={t('flash.searchPlaceholder')}
            onChange={(event) => { setKeyword(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') setAppliedKeyword(keyword.trim()) }}
          />
          <button type="button" className={css.button} onClick={() => { setAppliedKeyword(keyword.trim()) }}>
            {t('flash.search')}
          </button>
          {appliedKeyword !== '' ? (
            <button type="button" className={css.button} onClick={() => { setKeyword(''); setAppliedKeyword('') }}>
              {t('flash.clear')}
            </button>
          ) : null}
          <button type="button" className={css.button} onClick={() => { setAppliedKeyword(appliedKeyword) }}>
            {t('flash.refresh')}
          </button>
        </div>
        {status === 'error' ? <p className={css.error}>{t('flash.error')}</p> : null}
        {status !== 'error' && items.length === 0 ? (
          <p className={css.empty}>{status === 'loading' ? t('flash.loading') : t('flash.empty')}</p>
        ) : null}
        {items.length > 0 ? <NewsFeedPane items={items} filterType="media" fullHeight t={t} /> : null}
        {status !== 'error' && hasMore ? (
          <div className={css.moreRow}>
            <button type="button" className={css.button} disabled={loadingMore} onClick={() => { void loadMore() }}>
              {t('flash.loadMore')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
