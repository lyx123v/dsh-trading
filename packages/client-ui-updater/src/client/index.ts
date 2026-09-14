/**
 * dsh-trading auto-update, browser half — the software-update dialog on the
 * host's frame-wide shell.overlay layer. The entry point is the update button
 * beside Settings in the trading sidebar's bottom bar (client-ui-trading
 * dispatches UPDATER_OPEN_EVENT); this plugin owns the modal chrome and body.
 *
 * The dialog talks to the node half over /dshtrading/api/updater (same-origin
 * fetch inside the browser-auth fence). In environments without incremental
 * support (dev checkouts, headless profiles) it degrades to an information
 * surface linking the GitHub releases page.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './contract.ts'
import { en, zh } from './locales.ts'
import { UpdaterDialog } from './UpdaterDialog.tsx'

import { UPDATE_AVAILABLE_EVENT, UPDATER_OPEN_EVENT } from './contract.ts'
/** This dialog's locale namespace. */
const NS = 'dshtrading.updater'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Register the update dialog on shell.overlay (no settings.section: the entry
 * moved beside Settings in the sidebar bottom bar). The sidebar asks this
 * plugin to open through the UPDATER_OPEN_EVENT window event — cross-plugin
 * coupling is a DOM event, never an import.
 */
export function apply(ctx: ClientContext): void {
  ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-trading-updater: dictionaries')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dshtrading-updater-dialog',
    order: 90,
    locale: NS,
  }, UpdaterDialog))
}

export { UPDATE_AVAILABLE_EVENT, UPDATER_OPEN_EVENT } from './contract.ts'
