/**
 * 宏观/利率面板（右缘会话列容器的功能页签 4 号，2026-09-15）。
 *
 * 与定时任务/资产/快讯同款模式（SessionRail 竖条地球按钮激活时原位覆盖对话列，
 * 五者互斥，同一容器同时只容一个覆盖面）。状态由 SessionRail 写
 * body[data-dshtrading-macro-open]，shell-pad.css 规则 15 隐去对话列内容；
 * 本组件是 fixed 面板，定位与宽度吃 frame 轨道变量（macro-panel.module.css）。
 *
 * 数据面 = host 面 tradingMacroFeed 服务（桥 /dshtrading/api/macro/*）：
 * - 经济数据 = 官方 MCP list_calendar 当周（周一~周日，北京时间），地区按标题
 *   前缀推断（上游无 country 参数，见 spikes/impl-jin10-macro-rates/EVIDENCE.md）；
 * - 央行利率 = 金十网页版 interest_rates（全量 30 家），地区按 flag 名推断。
 * 默认只看美/日/中（用户 2026-09-15 裁决）；日历 5 分钟轮询（MCP 上游限流
 * 1500 次/天/工具，60s 节奏会吃穿配额），利率随同一节拍复用快照。
 * 数据源未安装时显示可操作提示，绝不把失败画成「没有数据」。
 */
import { useEffect, useRef, useState } from 'react'
import { fetchMacroCalendar, fetchMacroRates, type ClientMacroCalendarEntry, type ClientMacroRateEntry } from './api.ts'
import type { MarketLocaleKey } from './contract.ts'
import css from './macro-panel.module.css'

/** 轮询周期：日历是日级发布流，5 分钟足够新且不侵蚀 MCP 配额（1500 次/天/工具）。 */
const POLL_MS = 300_000
/** 日历全周条目上限（与桥/连接器侧同值；整周实测已到 254 条，250 会把周尾静默裁掉）。 */
const CALENDAR_LIMIT = 400

/** 默认地区过滤（美/日/中；用户 2026-09-15 裁决）。 */
const G3_REGIONS: readonly string[] = ['美国', '日本', '中国'] // i18n-allow: 地区名是上游数据词汇（与条目 region 比对），非 UI 文案

/** 单个数据源的加载状态：两源各自记账，任一源失败不影响另一个页签的展示。 */
type FeedState = 'loading' | 'ready' | 'error'

export type MacroPanelTranslate = (key: MarketLocaleKey) => string

export interface MacroPanelProps {
  t: MacroPanelTranslate
  /** 关闭面板（竖条按钮/头部 ×）。 */
  onClose(): void
}

/** 上游影响词 → 色系（数据源词汇，非 UI 文案；原样透传展示）。 */
function affectKind(affect: string | undefined): 'bull' | 'bear' | 'neutral' | undefined {
  if (affect === undefined) return undefined
  if (affect.includes('利多')) return 'bull' // i18n-allow: 上游影响词原文匹配
  if (affect.includes('利空')) return 'bear' // i18n-allow: 上游影响词原文匹配
  return 'neutral'
}

/** ISO → 面板行短时间（MM-DD HH:mm，本地时区）。 */
function shortTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** ISO → 本地日期键（YYYY-MM-DD；解析失败 = 空串）。 */
export function localDateKeyOf(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 首屏锚定日期（列表升序，打开面板应直接看到「今天」而不是从周一滚起——2026-09-15
 * 用户反馈「只有 9.14 的数据」，实测数据是全的，首屏被周一占满）。优先今天；今天
 * 没有条目（周末/深夜）→ 锚定第一条未公布的条目；全部已公布 → 锚定最后一条；
 * 空列表 = 空串（不滚动）。
 */
export function calendarAnchorDate(rows: readonly { publishedAt: string }[], now: Date): string {
  if (rows.length === 0) return ''
  const today = localDateKeyOf(now.toISOString())
  if (today !== '' && rows.some((row) => localDateKeyOf(row.publishedAt) === today)) return today
  const upcoming = rows.find((row) => Date.parse(row.publishedAt) >= now.getTime())
  if (upcoming !== undefined) return localDateKeyOf(upcoming.publishedAt)
  return localDateKeyOf(rows[rows.length - 1]!.publishedAt)
}

export function MacroPanel({ t, onClose }: MacroPanelProps) {
  const [tab, setTab] = useState<'calendar' | 'rates'>('calendar')
  const [g3Only, setG3Only] = useState(true)
  const [calendar, setCalendar] = useState<readonly ClientMacroCalendarEntry[] | null>(null)
  const [rates, setRates] = useState<readonly ClientMacroRateEntry[] | null>(null)
  // 两个数据源（MCP 日历 / 网页版利率）独立记状态：任一源失败只在自己那个页签出
  // 错误提示，绝不把「一个源挂了」画成「没有数据」（2026-09-15 评审 M3）。
  const [calendarState, setCalendarState] = useState<FeedState>('loading')
  const [ratesState, setRatesState] = useState<FeedState>('loading')
  // 首屏锚定：日历列表升序铺开整周，打开面板不锚定的话首屏永远是周一（看起来
  // 「只有昨天的数据」）。首次出数据后把当天滚到列表顶部，之后不再打扰用户滚动位置。
  const calListRef = useRef<HTMLDivElement | null>(null)
  const anchoredRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [calendarPage, ratePage] = await Promise.all([fetchMacroCalendar(CALENDAR_LIMIT), fetchMacroRates()])
      if (cancelled) return
      setCalendar(calendarPage)
      setRates(ratePage)
      setCalendarState(calendarPage === null ? 'error' : 'ready')
      setRatesState(ratePage === null ? 'error' : 'ready')
    }
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const filterRegion = <T extends { region: string }>(items: readonly T[]): readonly T[] =>
    g3Only ? items.filter((item) => G3_REGIONS.includes(item.region)) : items

  // 日历按公布时间升序（时间轴顺序读周）；利率保持上游顺序（大体量级先行）。
  const calendarRows = calendar === null ? null : [...filterRegion(calendar)].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
  const rateRows = rates === null ? null : filterRegion(rates)

  useEffect(() => {
    if (calendarState !== 'ready' || calendar === null || tab !== 'calendar' || anchoredRef.current) return
    const anchor = calendarAnchorDate(calendarRows ?? [], new Date())
    if (anchor === '') return
    // rAF 等行先上屏；手写 scrollTop 而非 scrollIntoView（jsdom 无后者，面板是唯一滚动容器）。
    // 锚定成功才记账：先停在利率页签/容器未挂载时下一拍补锚。
    requestAnimationFrame(() => {
      const scroller = calListRef.current?.parentElement
      const row = calListRef.current?.querySelector<HTMLElement>(`[data-dshtrading-cal-date="${anchor}"]`)
      if (scroller === undefined || scroller === null || row === null || row === undefined) return
      anchoredRef.current = true
      scroller.scrollTop = Math.max(0, row.offsetTop - scroller.offsetTop)
    })
    // 单次锚定；g3Only 变化不重滚（不打扰用户已调好的位置）。
  }, [calendarState, calendar, calendarRows, tab])

  return (
    <div className={css.panel} data-dshtrading-macro-panel="" role="panel" aria-label={t('stage.macro')}>
      <header className={css.head}>
        <strong className={css.title}>{t('stage.macro')}</strong>
        <span className={css.spacer} />
        <button type="button" className={css.closeBtn} aria-label={t('flash.close')} title={t('flash.close')} onClick={onClose}>×</button>
      </header>
      <div className={css.body}>
        <div className={css.controls}>
          <div className={css.tabs} role="group" aria-label={t('stage.macro')}>
            <button type="button" className={css.tab} aria-pressed={tab === 'calendar'} onClick={() => { setTab('calendar') }}>
              {t('macro.tab.calendar')}
            </button>
            <button type="button" className={css.tab} aria-pressed={tab === 'rates'} onClick={() => { setTab('rates') }}>
              {t('macro.tab.rates')}
            </button>
          </div>
          <div className={css.regionSeg} role="group" aria-label={t('macro.regionAll')}>
            <button type="button" className={css.seg} aria-pressed={g3Only} onClick={() => { setG3Only(true) }}>
              {t('macro.regionG3')}
            </button>
            <button type="button" className={css.seg} aria-pressed={!g3Only} onClick={() => { setG3Only(false) }}>
              {t('macro.regionAll')}
            </button>
          </div>
        </div>
        {tab === 'calendar' ? (
          <div className={css.list} ref={calListRef}>
            <p className={css.hint}>{t('macro.weekHint')}</p>
            {calendarState === 'error' ? <p className={css.error}>{t('macro.error')}</p> : null}
            {calendarState === 'loading' ? <p className={css.empty}>{t('macro.loading')}</p> : null}
            {calendarState === 'ready' && calendarRows !== null && calendarRows.length === 0 ? (
              <p className={css.empty}>{t('macro.empty')}</p>
            ) : null}
            {(calendarRows ?? []).map((entry, index) => (
              <div key={`${entry.publishedAt}-${index}`} className={css.calItem} data-dshtrading-cal-date={localDateKeyOf(entry.publishedAt)}>
                <div className={css.calTop}>
                  <span className={css.calTime}>{shortTime(entry.publishedAt)}</span>
                  {/* 星号先夹到 [0,5]：上游给负值/NaN 时 repeat 会抛 RangeError 炸掉整块面板。 */}
                  <span className={css.calStars} title={`${entry.star}`}>{'★'.repeat(Math.max(0, Math.min(entry.star, 5))) || '·'}</span>
                  <span className={css.calTitle}>{entry.title}</span>
                  <span className={css.calRegion}>{entry.region}</span>
                </div>
                <div className={css.calValues}>
                  <span className={css.val}>{t('macro.col.previous')} <b>{entry.previous ?? '--'}</b></span>
                  <span className={css.val}>{t('macro.col.consensus')} <b>{entry.consensus ?? '--'}</b></span>
                  <span className={css.val}>{t('macro.col.actual')} <b className={css.actual} data-pending={entry.actual === undefined ? 'true' : 'false'}>{entry.actual ?? '--'}</b></span>
                  {affectKind(entry.affect) !== undefined ? (
                    <span className={css.affect} data-kind={affectKind(entry.affect)}>{entry.affect}</span>
                  ) : null}
                  {entry.revised !== undefined ? <span className={css.val}>{t('macro.col.revised')} <b>{entry.revised}</b></span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={css.list}>
            {ratesState === 'error' ? <p className={css.error}>{t('macro.error')}</p> : null}
            {ratesState === 'loading' ? <p className={css.empty}>{t('macro.loading')}</p> : null}
            {ratesState === 'ready' && rateRows !== null && rateRows.length === 0 ? (
              <p className={css.empty}>{t('macro.empty')}</p>
            ) : null}
            {(rateRows ?? []).map((rate) => (
              <div key={rate.bankName} className={css.rateItem}>
                <div className={css.rateMain}>
                  <span className={css.rateBank}>{rate.bankName}</span>
                  <span className={css.rateValue}>{rate.rate}<span className={css.ratePct}>%</span></span>
                </div>
                <div className={css.rateMeta}>
                  <span className={css.rateRegion}>{rate.region}</span>
                  {rate.indicatorName !== undefined ? <span className={css.rateIndicator}>{rate.indicatorName}</span> : null}
                  <span className={css.rateDate}>{t('macro.col.rateDate')} {rate.publishedAt}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
