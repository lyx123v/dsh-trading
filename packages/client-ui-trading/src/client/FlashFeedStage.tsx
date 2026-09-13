/**
 * 市场快讯视图（中栏内置 tab，2026-09-13 金十接入）。
 *
 * 数据面 = host 面 tradingFlashFeed 服务（桥 /dshtrading/api/flash）：最新快讯流 +
 * cursor 翻页 + 关键词搜索；面板挂载期间 60s 轮询（与新闻面板同款节奏，切走即卸载）。
 * 数据源未安装/凭证缺失时显示可操作提示，绝不把失败画成「没有快讯」。
 */
import { useEffect, useState } from 'react'
import { fetchFlash } from './api.ts'
import { NewsFeedPane, type ClientNewsItem } from './NewsFeedPane.tsx'
import type { StageViewProps } from './stage-views.ts'
import css from './flash-feed-stage.module.css'

/** 轮询周期：快讯是秒级流，但面板无需实时推送（与新闻面板 60s 一致）。 */
const POLL_MS = 60_000
const PAGE_LIMIT = 30

export function FlashFeedStage({ t }: StageViewProps) {
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
    <div className={css.root}>
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
      <div className={css.body}>
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
