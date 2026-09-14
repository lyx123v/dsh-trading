/**
 * Trading settings section (tab container): the '交易' 一级菜单 host. The
 * section chrome is a tab bar projected from the dshtrading.market.tab slot
 * ledger; each market contributes its own panel (id = market id) and the
 * section renders it through the child slot. New market = new tab registration,
 * no section changes (官方 settings.plugins.tab 模式).
 *
 * Layout is grouped: 通用 (display/source preferences that apply to every
 * market) above 市场数据源 (the per-market tab switcher + the active market's
 * provider panel), so global controls never read as market-scoped.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type {} from './contract/locale-keys.ts'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TradingSettingsState } from './trading-settings-controller.ts'
import css from './trading-settings.module.css'

/** One tab projected from a dshtrading.market.tab contribution. */
export interface TradingMarketTabEntry {
  id: string
  order: number
  label: string
}

/** SnapshotStore face for subscribing to controller state. */
interface ControllerStore {
  getSnapshot: () => TradingSettingsState
  subscribe: (listener: () => void) => () => void
}

/** Registration-side business face for the section. */
export interface TradingSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the market tab ledger. */
    tabs: HostObservable<readonly TradingMarketTabEntry[]>
    /** Shared dshtrading controller (for colorMode + Jin10 credential state). */
    controller: ControllerStore
  }
  /** Write action: set global color mode. */
  setColorMode: (mode: 'red-up' | 'green-up') => Promise<void>
  /** Write action: set/clear the Jin10 MCP token (empty string clears it). */
  setJin10Token: (value: string) => Promise<void>
  /** Write action: clear the Jin10 MCP token. */
  clearJin10Token: () => Promise<void>
}

/** Props the renderer binds for the section. */
export type TradingSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'dshtrading.settings'>
  & PropsRenderSlots<'dshtrading.market.tab'>
  & InjectFace<TradingSettingsSectionInjected>

/** Render the Trading page: 通用 group (color mode + flash source) + 市场数据源 group (tabs + active market panel). */
export function TradingSettingsSection({ t, renderSlot, useTabs, useController, setColorMode, setJin10Token, clearJin10Token }: TradingSettingsSectionProps) {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rows = useTabs(value => value)
  const controllerState = useController((value: TradingSettingsState) => value)
  const [activeId, setActiveId] = useState<string>()
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id

  // 首次选中即挂载，切换后保持挂载（draft 存活）。
  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  const currentColorMode = controllerState.colorMode ?? 'red-up'

  // 金十 MCP Token：读 = credentials.jin10.token（共享控制器快照），写 = 注入的两个动作。
  const jin10Token = controllerState.credentials.jin10?.token
  const jin10Configured = jin10Token !== undefined
  const tokenInputId = useId()
  const [tokenDraft, setTokenDraft] = useState<string | undefined>(undefined)
  const [tokenSaving, setTokenSaving] = useState(false)
  const [tokenMessage, setTokenMessage] = useState<string | undefined>(undefined)
  const tokenValue = tokenDraft ?? jin10Token ?? ''
  const tokenDirty = tokenValue.trim() !== (jin10Token ?? '')
  async function saveToken(): Promise<void> {
    setTokenSaving(true)
    try {
      await setJin10Token(tokenValue)
      setTokenDraft(undefined)
      setTokenMessage(t('flashSourceSaved'))
    } catch {
      setTokenMessage(t('flashSourceFailed'))
    } finally {
      setTokenSaving(false)
    }
  }
  async function clearToken(): Promise<void> {
    setTokenSaving(true)
    try {
      await clearJin10Token()
      setTokenDraft(undefined)
      setTokenMessage(t('flashSourceCleared'))
    } catch {
      setTokenMessage(t('flashSourceFailed'))
    } finally {
      setTokenSaving(false)
    }
  }

  return (
    <div className={css.root}>
      <p className={css.lead}>{t('lead')}</p>

      {/* 通用：市场无关的显示与数据源偏好。 */}
      <section className={css.group}>
        <header className={css.groupHead}>
          <h3 className={css.groupTitle}>{t('groupGeneral')}</h3>
          <p className={css.groupHint}>{t('groupGeneralHint')}</p>
        </header>

        <div className={css.cards}>
          <div className={css.card}>
            <div className={css.cardHead}>
              <h4 className={css.cardTitle}>{t('colorMode.label')}</h4>
            </div>
            <p className={css.cardHint}>{t('colorMode.hint')}</p>
            <div className={css.colorModeOptions}>
              <label className={css.colorModeOption} data-active={currentColorMode === 'red-up' ? 'true' : undefined}>
                <input
                  type="radio"
                  name="dshtrading-color-mode"
                  value="red-up"
                  checked={currentColorMode === 'red-up'}
                  onChange={() => { void setColorMode('red-up') }}
                  className={css.colorModeRadio}
                />
                <span className={css.colorModeSwatch} style={{ background: '#e64545' }} />
                <span className={css.colorModeSwatchDown} style={{ background: '#2ba471' }} />
                <span>{t('colorMode.redUp')}</span>
              </label>
              <label className={css.colorModeOption} data-active={currentColorMode === 'green-up' ? 'true' : undefined}>
                <input
                  type="radio"
                  name="dshtrading-color-mode"
                  value="green-up"
                  checked={currentColorMode === 'green-up'}
                  onChange={() => { void setColorMode('green-up') }}
                  className={css.colorModeRadio}
                />
                <span className={css.colorModeSwatch} style={{ background: '#2ba471' }} />
                <span className={css.colorModeSwatchDown} style={{ background: '#e64545' }} />
                <span>{t('colorMode.greenUp')}</span>
              </label>
            </div>
          </div>

          {/* 市场快讯数据源（金十 MCP）：市场无关的数据源凭证。 */}
          <div className={css.card}>
            <div className={css.cardHead}>
              <h4 className={css.cardTitle}>{t('flashSourceTitle')}</h4>
              <span className={css.statusChip} data-on={jin10Configured ? 'true' : 'false'}>
                {jin10Configured ? t('flashSourceChipOn') : t('flashSourceChipOff')}
              </span>
            </div>
            <p className={css.cardHint}>{t('flashSourceLabel')}</p>
            <div className={css.field}>
              <label className={css.fieldLabel} htmlFor={tokenInputId}>{t('field.label.mcpToken')}</label>
              <input
                id={tokenInputId}
                type="password"
                className={css.input}
                value={tokenValue}
                disabled={!controllerState.writable || tokenSaving}
                onChange={(event) => { setTokenDraft(event.target.value) }}
                placeholder={t('flashSourcePlaceholder')}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={css.cardActions}>
              <button
                type="button"
                className={css.btnPrimary}
                disabled={!tokenDirty || tokenSaving || !controllerState.writable}
                onClick={() => { void saveToken() }}
              >
                {t('save')}
              </button>
              <button
                type="button"
                className={css.btnGhost}
                disabled={tokenSaving || !controllerState.writable || jin10Token === undefined}
                onClick={() => { void clearToken() }}
              >
                {t('flashSourceClear')}
              </button>
              {tokenMessage !== undefined ? <span className={css.actionMsg} role="status">{tokenMessage}</span> : null}
            </div>
            <p className={css.cardHint}>{t('flashSourceHint')}</p>
          </div>
        </div>
      </section>

      {/* 市场数据源：市场作用域，tab 切换只影响本组内容。 */}
      <section className={css.group}>
        <header className={css.groupHead}>
          <h3 className={css.groupTitle}>{t('groupMarket')}</h3>
          <p className={css.groupHint}>{t('groupMarketHint')}</p>
        </header>

        {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
          <>
            <div className={css.tabList} role="tablist" aria-label={t('tabs')}>
              {rows.map((row, index) => {
                const selected = row.id === active
                return (
                  <button
                    key={row.id}
                    ref={(element) => { tabRefs.current[index] = element }}
                    id={`${tabsId}-tab-${row.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`${tabsId}-panel-${row.id}`}
                    data-active={selected ? 'true' : undefined}
                    tabIndex={selected ? 0 : -1}
                    className={css.tab}
                    onClick={() => { setActiveId(row.id) }}
                    onKeyDown={(event) => {
                      let nextIndex: number
                      switch (event.key) {
                        case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                        case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                        case 'Home': nextIndex = 0; break
                        case 'End': nextIndex = rows.length - 1; break
                        default: return
                      }
                      event.preventDefault()
                      const nextRow = rows[nextIndex] as TradingMarketTabEntry
                      const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
                      setActiveId(nextRow.id)
                      nextTab.focus()
                    }}
                  >
                    {row.label}
                  </button>
                )
              })}
            </div>
            <div className={css.panelWrap}>
              {rows
                .filter(row => row.id === active || visitedIds.has(row.id))
                .map((row) => {
                  const selected = row.id === active
                  return (
                    <div
                      key={row.id}
                      id={`${tabsId}-panel-${row.id}`}
                      role="tabpanel"
                      aria-labelledby={`${tabsId}-tab-${row.id}`}
                      className={css.tabPanel}
                      hidden={!selected}
                    >
                      {renderSlot('dshtrading.market.tab', {}, { only: row.id })}
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export type { TradingSettingsSectionProps as TradingSettingsSectionPropsType }
