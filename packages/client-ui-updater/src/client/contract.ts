/**
 * Locale contract for the software-update dialog. The zh dictionary in
 * locales.ts is the key source of truth; this union + the LocaleNamespaceMap
 * merge give the framework-injected t seat its key types.
 *
 * Type-only imports pull the host slot augmentations (shell.overlay) into the
 * program so the dialog registers against a declared slot.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export type UpdaterLocaleKey =
  | 'nav'
  | 'lead'
  | 'currentVersion'
  | 'desktopApp'
  | 'unsupported'
  | 'viewReleases'
  | 'checkNow'
  | 'checking'
  | 'lastCheck'
  | 'never'
  | 'upToDate'
  | 'available'
  | 'publishedAt'
  | 'notesTitle'
  | 'applyNow'
  | 'payloadMissing'
  | 'phase.prepare'
  | 'phase.download'
  | 'phase.verify'
  | 'phase.install'
  | 'progress'
  | 'done'
  | 'restartHint'
  | 'restartNow'
  | 'restartManual'
  | 'checkError'
  | 'retry'
  | 'close'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Software-update dialog copy (check / notes / incremental apply). */
    'dshtrading.updater': UpdaterLocaleKey
  }
}

/**
 * Window event contract with the trading shell sidebar (client-ui-trading
 * MarketDock update entry). Cross-plugin coupling is intentionally a DOM
 * custom event, not an import (client plugins never import each other's
 * modules).
 *
 * - UPDATE_AVAILABLE_EVENT: fired by the dialog whenever the host snapshot
 *   changes. Detail: { available: boolean, version?: string }.
 * - UPDATER_OPEN_EVENT: fired by the sidebar update entry to ask this plugin
 *   to open its dialog. No detail.
 */
export const UPDATE_AVAILABLE_EVENT = 'dshtrading-update-available'
export const UPDATER_OPEN_EVENT = 'dshtrading-updater-open'
