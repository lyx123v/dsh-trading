/**
 * client-ui-special-indicators 的 locale 契约：独立 namespace
 * 「dshtrading.specialIndicators」（与 shell 的 dshtrading.market 词典分离——
 * 同 NS 双包注册会整表覆盖）。key 前缀 si.*；键 union 由 zh 词典推导，
 * zh/en 对齐由 scripts/i18n-audit.mjs 门禁兜底。
 */
import type { zh } from './locales.ts'

export type SpecialIndicatorsLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    /** 特殊指标视图词典（client-ui-special-indicators 包私有）。 */
    'dshtrading.specialIndicators': SpecialIndicatorsLocaleKey
  }
}
