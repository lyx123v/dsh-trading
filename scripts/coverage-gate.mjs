#!/usr/bin/env node
/**
 * 覆盖率棘轮门禁（business-testing-ci §5）：逐包跑 v8 覆盖率，聚合成仓库级
 * 分支/行/函数/语句四项指标，与 scripts/coverage-baseline.json 比较——任何一项
 * 下降即红（只许升不许降，与 typecheck / test-audit 棘轮同款）。
 *
 * 口径说明（重要）：本仓是逐包 vitest（各包自带 vitest.config.ts 与 setupFiles），
 * 因此不能用一个 root vitest 进程统跑（会丢掉 client-ui-trading 的 setupFiles，
 * 让 tasks 账本写进真实 home）。这里逐包独立跑、再按 metric 的 total/covered 求和，
 * 得到仓库级加权百分比——跨包不会重复计数，因为 include 只取本包 src/**。
 *
 * --coverage.all 让「没被测到的源文件」按 0% 计入：这才是真实覆盖面，而不是
 * 「只统计测过的文件」的虚高数字。该指标是回归护栏，不是质量合格证——为什么
 * 有未覆盖分支，仍须按 §5 失败路径清单人工审计。
 *
 * 用法：
 *   node scripts/coverage-gate.mjs --check   # 门禁（CI nightly）
 *   node scripts/coverage-gate.mjs --update  # 刷新基线，拒绝下调（需 --force 强降）
 *   node scripts/coverage-gate.mjs --json
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const COVERAGE_DIR = join(ROOT, '.coverage')
const BASELINE_PATH = join(ROOT, 'scripts', 'coverage-baseline.json')
const METRICS = ['branches', 'lines', 'functions', 'statements']
/**
 * 抖动容差（百分点）：逐包并行跑 v8 时，个别边界分支的计数在两次运行间会差
 * 1~2 个（11200 分支量级上约 0.01pp）。门禁必须是指纹不是骰子——用 0.2pp
 * 容差吸收计数抖动，真实回归（少跑一个测试文件通常掉 1pp 以上）照样红。
 */
const TOLERANCE_PCT = 0.2
const CONCURRENCY = 4
const VITEST = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')

export function listCoverablePackages() {
  const out = []
  for (const name of readdirSync(PACKAGES_DIR)) {
    const pkgPath = join(PACKAGES_DIR, name, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.scripts?.test === undefined) continue
    out.push({ name, dir: join(PACKAGES_DIR, name) })
  }
  return out
}

function runCoverage(pkg) {
  return new Promise((resolve) => {
    execFile(
      VITEST,
      [
        'run', '--passWithNoTests',
        '--coverage', '--coverage.provider=v8', '--coverage.all',
        '--coverage.include=src/**/*.ts', '--coverage.include=src/**/*.tsx',
        '--coverage.exclude=**/*.d.ts',
        '--coverage.reporter=json-summary',
        `--coverage.reportsDirectory=${join(COVERAGE_DIR, pkg.name)}`,
      ],
      { cwd: pkg.dir, env: { ...process.env, CI: '1' } },
      (error, stdout, stderr) => resolve({ pkg, error, stdout, stderr }),
    )
  })
}

export async function aggregate() {
  const pkgs = listCoverablePackages()
  const totals = Object.fromEntries(METRICS.map((m) => [m, { total: 0, covered: 0 }]))
  const perPackage = {}
  const failures = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pkgs.length) }, async () => {
    while (cursor < pkgs.length) {
      const pkg = pkgs[cursor++]
      const result = await runCoverage(pkg)
      const summaryPath = join(COVERAGE_DIR, pkg.name, 'coverage-summary.json')
      if (!existsSync(summaryPath)) {
        failures.push({ package: pkg.name, reason: result.error?.message ?? 'no coverage report' })
        continue
      }
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
      const entry = {}
      for (const metric of METRICS) {
        const m = summary.total?.[metric]
        if (m === undefined) continue
        totals[metric].total += m.total
        totals[metric].covered += m.covered
        entry[metric] = m.pct
      }
      perPackage[pkg.name] = entry
    }
  }))
  const metrics = {}
  for (const metric of METRICS) {
    const { total, covered } = totals[metric]
    metrics[metric] = { total, covered, pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100 }
  }
  return { metrics, perPackage, failures }
}

function format(result) {
  const lines = ['仓库级覆盖率（v8，all=true，逐包聚合）：', '']
  for (const metric of METRICS) {
    const m = result.metrics[metric]
    lines.push(`  ${metric.padEnd(11)} ${String(m.pct).padStart(6)}%  (${m.covered}/${m.total})`)
  }
  const ranked = Object.entries(result.perPackage)
    .map(([name, entry]) => [name, entry.branches ?? 100])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10)
  if (ranked.length > 0) {
    lines.push('')
    lines.push('  分支覆盖率最低的 10 个包（失败路径审计优先看这里）：')
    for (const [name, pct] of ranked) lines.push(`    ${String(pct).padStart(6)}%  ${name}`)
  }
  for (const f of result.failures) lines.push(`  [无报告] ${f.package}: ${f.reason}`)
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--update') ? 'update' : 'check'
  const force = args.includes('--force')
  if (args.includes('--json')) rmSync(COVERAGE_DIR, { recursive: true, force: true })
  if (existsSync(COVERAGE_DIR)) rmSync(COVERAGE_DIR, { recursive: true, force: true })

  return aggregate().then((result) => {
    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      process.stdout.write(format(result) + '\n')
    }

    if (mode === 'update') {
      if (!existsSync(BASELINE_PATH)) {
        writeFileSync(BASELINE_PATH, JSON.stringify(result.metrics, null, 2) + '\n')
        process.stdout.write('已创建基线 scripts/coverage-baseline.json\n')
        return 0
      }
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
      const lowered = METRICS.filter((m) => result.metrics[m].pct < (baseline[m]?.pct ?? 0) - TOLERANCE_PCT)
      if (lowered.length > 0 && !force) {
        process.stderr.write('\n拒绝下调覆盖率基线：\n')
        for (const m of lowered) process.stderr.write(`  ${m}: ${baseline[m].pct}% -> ${result.metrics[m].pct}%\n`)
        process.stderr.write('新增覆盖后再 --update，或 --force 显式接受下降。\n')
        return 1
      }
      writeFileSync(BASELINE_PATH, JSON.stringify(result.metrics, null, 2) + '\n')
      process.stdout.write('基线已更新 scripts/coverage-baseline.json\n')
      return 0
    }

    if (!existsSync(BASELINE_PATH)) {
      process.stderr.write('缺少 scripts/coverage-baseline.json；先跑 --update 建立基线。\n')
      return 2
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const dropped = METRICS.filter((m) => result.metrics[m].pct < (baseline[m]?.pct ?? 0) - TOLERANCE_PCT)
    if (dropped.length === 0) {
      process.stdout.write('\n覆盖率门禁：通过（无指标下降）\n')
      return 0
    }
    process.stderr.write('\n覆盖率门禁：失败——以下指标低于基线：\n')
    for (const m of dropped) process.stderr.write(`  ${m}: ${baseline[m].pct}% -> ${result.metrics[m].pct}%\n`)
    return 1
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code })
}
