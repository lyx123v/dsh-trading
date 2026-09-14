/**
 * Software-update dialog (the 'shell.overlay' entry registered by this plugin).
 * The sidebar's update entry dispatches UPDATER_OPEN_EVENT; this component owns
 * the modal chrome (mask click + Escape close) around UpdaterPanel. Frame-wide
 * floating layer: fixed overlay opts back into pointer events.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { UPDATER_OPEN_EVENT } from './contract.ts'
import { UpdaterPanel } from './UpdaterPanel.tsx'
import css from './updater-dialog.module.css'

export type UpdaterDialogProps = PropsLocale<'dshtrading.updater'>

export function UpdaterDialog({ t }: UpdaterDialogProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = (): void => { setOpen(true) }
    window.addEventListener(UPDATER_OPEN_EVENT, onOpen)
    return () => { window.removeEventListener(UPDATER_OPEN_EVENT, onOpen) }
  }, [])

  const close = useCallback((): void => { setOpen(false) }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, close])

  if (!open) return null

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={close} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('nav')}>
        <div className={css.header}>
          <span className={css.title}>{t('nav')}</span>
          <button type="button" className={css.close} aria-label={t('close')} title={t('close')} onClick={close}>
            <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5" />
            </svg>
          </button>
        </div>
        <div className={css.body}>
          <UpdaterPanel t={t} />
        </div>
      </div>
    </div>
  )
}
