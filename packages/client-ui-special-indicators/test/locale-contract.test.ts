/**
 * 词典契约测试（私有包不进 i18n-audit 中心包门禁——那会给已发布 dsh-i18n
 * 引入对私有包的 workspace 依赖；zh/en 对齐由本测试钉住，口径与
 * scripts/i18n-audit.mjs 相同：键集合双向对齐 + {placeholder} 对齐）。
 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** 占位符提取（与 SDK 插值器 /\{(\w+)\}/g 同口径）。 */
function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('特殊指标词典 zh/en 契约', () => {
  it('运营维护词典时 zh/en 键集合保持双向对齐', () => {
    // Given: zh/en 两份词典
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    // When: 求键集差
    const missingInEn = zhKeys.filter((k) => !(k in en))
    const missingInZh = enKeys.filter((k) => !(k in zh))
    // Then: 双向无缺失
    expect(missingInEn).toEqual([])
    expect(missingInZh).toEqual([])
    expect(zhKeys.length).toBeGreaterThan(0)
  })

  it('运营维护词典时每个键的 {placeholder} 在 zh/en 间一致', () => {
    // Given: zh/en 键集已对齐
    // When: 逐键比对占位符集合
    // Then: 插值面零漂移（en 下不会渲染出空占位符）
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(placeholdersOf(en[key]), 'key ' + key).toEqual(placeholdersOf(zh[key]))
    }
  })
})
