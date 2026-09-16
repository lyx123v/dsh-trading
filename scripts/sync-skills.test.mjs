/**
 * sync-skills 可分发判定单测（2026-09-16）。
 *
 * 门禁源自一次真实数据损失：cn/us/hk 三份风控清单正文被指针文本覆盖成 0 行，
 * 而 sync-skills 每次都把这份内容照抄进包资产，损失随发布面扩散。
 */
import { describe, expect, it } from 'vitest'
import { distributableContentError, MIN_SKILL_BYTES } from './sync-skills.mjs'

describe('sync-skills 可分发判定', () => {
  it('admin 拒绝把符号链接落成的路径指针分发给包资产', () => {
    // Given 无 symlink 的 Windows checkout 会把符号链接落成单行相对路径文本
    const pointer = '../../../packages/kit-cn/assets/skills/cn-risk-checklist.md'
    // When 判定该内容能否分发
    const error = distributableContentError(pointer)
    // Then 拒绝，且原因指向指针
    expect(error).toContain('路径指针')
  })

  it('admin 区分损坏残片与真实技能正文', () => {
    // Given 一份低于下限的残片与一份正常长度的技能正文
    const fragment = '# 空壳\n'
    const real = `# 风控清单\n${'开仓前逐项核对。\n'.repeat(80)}`
    // When 分别判定
    const fragmentError = distributableContentError(fragment)
    const realError = distributableContentError(real)
    // Then 残片被拒并报出字节数，正文放行
    expect(fragmentError).toContain(String(Buffer.byteLength(fragment, 'utf8')))
    expect(Buffer.byteLength(real, 'utf8')).toBeGreaterThan(MIN_SKILL_BYTES)
    expect(realError).toBeNull()
  })
})
