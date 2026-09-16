import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { composePresets, connectorRowsOf, installFromLoader, installPresets, isUnmodifiedManaged, MARKETS, stamp, Config } from '../src/presets.js'
import { getPresetContribution as crypto } from '../../crypto/src/index.js'
import { getPresetContribution as us } from '../../us/src/index.js'
import { getPresetContribution as cn } from '../../cn/src/index.js'
import { getPresetContribution as hk } from '../../hk/src/index.js'

const dirs: string[] = []
async function root() { const dir = await mkdtemp(join(tmpdir(), 'trading-roles-')); dirs.push(dir); return join(dir, 'presets') }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const contributions = () => Promise.all([crypto(), us(), cn(), hk()])

it('accepts empty config', () => {
  expect(Config({})).toEqual({})
})

it('boots through the real loader with asynchronous preset installation', async () => {
  const presetRoot = await root()
  const script = `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { readFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { Context } from '@deepseek-ai/cordis';
    import * as presets from ${JSON.stringify(new URL('../src/presets.ts', import.meta.url).href)};
    const require = createRequire(import.meta.url);
    const cordisRequire = createRequire(require.resolve('@deepseek-ai/cordis'));
    const { Loader } = await import(pathToFileURL(cordisRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href);
    const ctx = new Context();
    await ctx.plugin(Loader);
    const loader = ctx.get('loader');
    let applies = 0;
    const wrapped = {
      ...presets,
      apply: async (pluginCtx, config) => { applies += 1; return presets.apply(pluginCtx, config); },
    };
    const market = {
      apply() {},
      async getPresetContribution() {
        // A concurrent loader notify (another row finishing init, a tree
        // update) must not cancel the in-flight installation. The old
        // inject.loader.await form counted the installer's own init task in
        // loader.getTasks(), so this notify flipped the loader service off and
        // restarted the fiber forever (issue #99). Keeping this probe makes
        // the regression test fail if that intercept form ever returns.
        loader.ctx.reflect.notify(['loader']);
        return ${JSON.stringify(await crypto())};
      },
    };
    loader.import = async name => name === '@dshtrading/base/presets' ? wrapped : market;
    await Promise.all([
      loader.create({ id: 'presets', name: '@dshtrading/base/presets', config: { presetRoot: ${JSON.stringify(presetRoot)} } }),
      loader.create({ id: 'crypto', name: '@dshtrading/crypto' }),
      loader.create({ id: 'us', name: '@dshtrading/us', disabled: true }),
    ]);
    await loader.await();
    const text = await readFile(join(${JSON.stringify(presetRoot)}, 'trader', 'agent.cordis.yml'), 'utf8');
    console.log(JSON.stringify({ crypto: text.includes('@dshtrading/kit-crypto'), us: text.includes('@dshtrading/kit-us'), applies }));
    await ctx.fiber.dispose();
  `
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  const child = spawnSync(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 6000,
  })
  expect(child.error, child.stderr).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  expect(JSON.parse(child.stdout.trim())).toEqual({ crypto: true, us: false, applies: 1 })
}, 10000)

it('composes all 16 installed-market subsets deterministically, preserving connector realms for trader and master', async () => {
  const all = await contributions()
  for (let mask = 0; mask < 16; mask++) {
    const subset = all.filter((_, i) => mask & (1 << i))
    const result = composePresets(subset)
    expect(result.map(p => p.id)).toEqual(['trader', 'instrument-researcher', 'risk-reviewer', 'master'])
    expect(composePresets([...subset].reverse())).toEqual(result)
    for (const preset of result) {
      const text = preset.files['agent.cordis.yml']
      expect((text.match(/^- id: persona$/gm) ?? [])).toHaveLength(1)
      const ids = [...text.matchAll(/^\s*- id: (.+)$/gm)].map(m => m[1])
      expect(new Set(ids).size).toBe(ids.length)
      for (const market of MARKETS) {
        expect(text.includes(`name: '@dshtrading/kit-${market}'`)).toBe(subset.some(c => c.market === market))
      }
      expect(text).toContain('knowledge_search')
      expect(text).toContain('*_get_fundamentals')
      expect(text).toContain('cn_get_news / hk_get_news include announcements')
      expect(text).toContain('Never predict')
      expect(text).toContain('Never cite sell-side ratings or target prices')
      // 证据契约（2026-09-16）：全部角色与委派人设共享同一刻度——来源等级 + 四态判定 + 锚点。
      expect(text).toContain('Evidence contract')
      expect(text).toContain('source grade, verdict, anchor')
      expect(text).toContain('supported | contradicted | mixed | insufficient')
      expect(text).toContain('one C/D/E source may never alone support a conclusion')
      expect(text).toContain('scarcity')
      expect(text).toContain('Always reply in the language the user writes in')
      // Workspace instructions: the Web surface disables the host-plane row, so the
      // preset must mount it or the role sees no AGENTS.md at all (2026-09-08).
      expect(text).toContain("- id: dsh-trading-agent-instructions\n  name: '@deepseek-ai/dsh-agent-instructions'\n  config:\n    maxBytes: 65536\n")
      expect(text).not.toContain("name: '@dshtrading/knowledge/plugin'") // shared host registration stays single
      if (preset.id === 'instrument-researcher' || preset.id === 'risk-reviewer') {
        expect(text).not.toContain("name: '@dshtrading/connector-")
        expect(text.includes("name: '@dshtrading/base/research-tools'")).toBe(subset.length > 0)
      } else {
        for (const contribution of subset) {
          expect(contribution.traderRows).toMatch(/^.*connector(?:-group)?\n  name: cordis:group\n  group: true\n  isolate:/)
          expect(contribution.traderRows).not.toContain('liveTrading: true')
          if (preset.id === 'trader') {
            // kit row is split out of the market block and rewritten with the trader whitelist (#70)
            expect(text).toContain(connectorRowsOf(contribution.market, contribution.traderRows))
            expect(text).toContain(`skills: ["${contribution.market}-risk-checklist","trading-strategy-paradigms","indicator-authoring","trading-notes-setup"]`)
          } else {
            expect(text).toContain(contribution.traderRows) // master keeps the market block verbatim (full kit catalog)
          }
        }
        expect(text).not.toContain("name: '@dshtrading/base/research-tools'") // connector tools already registered
      }
      if (preset.id === 'master') {
        expect(text).toContain('provider: fork\n    toolName: researcher_subagent')
        expect(text).toContain('toolName: trader_subagent')
        expect(text).toContain('toolName: risk_reviewer_subagent')
        expect(text).toContain('backgroundMode: one-shot')
        expect(text).toContain("name: '@deepseek-ai/dsh-tool-jobs'") // background one-shot delegates need a job controller in the owner's composition
        expect(text).toContain('instrument research analyst')
        expect(text).toContain('unified trader')
        expect(text).toContain('independent risk reviewer')
        expect((text.match(/@deepseek-ai\/dsh-tool-subagent/g) ?? [])).toHaveLength(3)
        expect((text.match(/one-shot delegate/g) ?? [])).toHaveLength(3)
        // Master orchestration: capital ledger first, then knowledge, skills and delegation.
        expect(text).toContain('holdings_list')
        expect(text).toContain('holdings_stage')
        expect(text).toContain('trade-plan drafting to trader_subagent')
        expect(text).toContain('hypotheses to verify with invalidation signals')
        expect(text).toContain('dynamic-capabilities')
        expect(text).toContain('strategy_backtest')
        expect(text).toContain('knowledge-curation')
        // Skill surface + shell: the master drives session skills (content-insight
        // pipelines) and therefore carries the bash row; specialists do not.
        expect(text).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
        expect(text).toContain("name: '@deepseek-ai/dsh-tool-skill'")
        expect(text).toContain("name: '@deepseek-ai/dsh-tool-bash'")
      } else {
        expect(text).not.toContain('@deepseek-ai/dsh-tool-subagent')
        expect(text).not.toContain('@deepseek-ai/dsh-tool-jobs') // no delegation, no background jobs
        expect(text).not.toContain("name: '@deepseek-ai/dsh-tool-bash'") // shell is master-only
      }
      // Every role gets the skill catalog and loader (host web rows are disabled;
      // without these the persona's skill names are dead references — 2026-09-07).
      expect(text).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
      expect(text).toContain("name: '@deepseek-ai/dsh-tool-skill'")
      // Role skill distribution (#70): the mounted base-skill row follows the persona discipline.
      if (preset.id === 'master') {
        expect(text).toContain("- id: dsh-trading-role-skills\n  name: '@dshtrading/base/role-skills'\n") // full pair, no whitelist
        expect(text).not.toContain('config:\n    skills:')
      } else if (preset.id === 'trader') {
        expect(text).not.toContain('- id: dsh-trading-role-skills') // no base skills for the execution role
      } else if (preset.id === 'instrument-researcher') {
        expect(text).toContain('skills: ["company-analysis"]')
        for (const contribution of subset) {
          expect(text).toContain(contribution.market === 'crypto'
            ? 'skills: ["crypto-instrument-analysis","knowledge-curation","trading-notes-setup"]'
            : 'skills: ["knowledge-curation","trading-notes-setup"]')
        }
        expect(text).not.toContain('risk-checklist') // ordering discipline stays out of the research role
      } else if (preset.id === 'risk-reviewer') {
        for (const contribution of subset) {
          expect(text).toContain(`skills: ["${contribution.market}-risk-checklist","trading-notes-setup"]`)
        }
        expect(text).not.toContain('trading-strategy-paradigms')
        expect(text).not.toContain('indicator-authoring')
      }
    }
  }
})

it('installs four roles idempotently and removes stale market rows after uninstall', async () => {
  const path = await root()
  const all = await contributions()
  expect((await installPresets(all, path)).every(r => r.wrote.length === 2)).toBe(true)
  expect((await installPresets(all, path)).every(r => r.wrote.length === 0)).toBe(true)
  await installPresets([all[0]], path)
  const trader = await readFile(join(path, 'trader/agent.cordis.yml'), 'utf8')
  expect(trader).toContain('@dshtrading/connector-binance')
  expect(trader).not.toContain('@dshtrading/connector-yahoo')
  expect(isUnmodifiedManaged(trader)).toBe(true)
  expect((await readdir(path)).sort()).toEqual(['instrument-researcher', 'master', 'risk-reviewer', 'trader'])
  const master = await readFile(join(path, 'master/preset.yml'), 'utf8')
  expect(master).toContain('name: 大师')
  expect(master).toContain('order: 90')
})

it.each(['no-stamp', 'modified-stamp'])('preserves %s customizations and leaves both role files untouched', async kind => {
  const path = await root()
  const all = await contributions()
  await installPresets([all[0]], path)
  const target = join(path, 'trader/agent.cordis.yml')
  const before = await readFile(target, 'utf8')
  const custom = kind === 'no-stamp' ? '# custom\n[]\n' : `${before}# retained stamp but edited\n`
  await writeFile(target, custom)
  const metaPath = join(path, 'trader/preset.yml')
  const meta = await readFile(metaPath, 'utf8')
  const results = await installPresets(all, path)
  expect(results[0].skipped).toHaveLength(1)
  expect(await readFile(target, 'utf8')).toBe(custom)
  expect(await readFile(metaPath, 'utf8')).toBe(meta)
})

async function legacy(path: string, id: string, edited = false, extra = false) {
  const dir = join(path, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), stamp('[]\n') + (edited ? '# user edit\n' : ''))
  await writeFile(join(dir, 'preset.yml'), stamp(`name: ${id}\n`))
  if (extra) await writeFile(join(dir, 'my-notes.md'), 'mine')
}
it('archives only intact managed legacy defaults outside roster; preserves edits and extra user files', async () => {
  const path = await root()
  await legacy(path, 'crypto-trader')
  await legacy(path, 'us-trader', true)
  await legacy(path, 'cn-trader', false, true)
  await installPresets(await contributions(), path)
  expect(await readdir(path)).not.toContain('crypto-trader')
  expect(await readFile(join(`${path}.legacy-backup`, 'crypto-trader/agent.cordis.yml'), 'utf8')).toBe(stamp('[]\n'))
  expect(await readdir(path)).toEqual(expect.arrayContaining(['us-trader', 'cn-trader']))
})
it('operator retires a re-created legacy default whose identical copy is already archived', async () => {
  // Given 名册根与归档根各有一份逐字节相同的受管旧默认
  const path = await root()
  await legacy(path, 'crypto-trader')
  await legacy(`${path}.legacy-backup`, 'crypto-trader')
  const archived = await readFile(join(`${path}.legacy-backup`, 'crypto-trader/agent.cordis.yml'), 'utf8')
  // When 安装器再次执行
  await installPresets([], path)
  // Then 名册副本被清除，归档原样保留
  expect(await readdir(path)).not.toContain('crypto-trader')
  expect(await readFile(join(`${path}.legacy-backup`, 'crypto-trader/agent.cordis.yml'), 'utf8')).toBe(archived)
})
it('operator archives a differing legacy default under its own name instead of overwriting the backup or leaving it in the roster', async () => {
  // Given 备份名下是用户改过的副本，名册根是另一份受管默认
  const path = await root()
  await legacy(path, 'crypto-trader')
  await legacy(`${path}.legacy-backup`, 'crypto-trader', true)
  const edited = await readFile(join(`${path}.legacy-backup`, 'crypto-trader/agent.cordis.yml'), 'utf8')
  // When 安装器再次执行
  await installPresets([], path)
  // Then 名册副本被清除，改过的备份未被覆盖，差异版本另名归档
  expect(await readdir(path)).not.toContain('crypto-trader')
  expect(await readFile(join(`${path}.legacy-backup`, 'crypto-trader/agent.cordis.yml'), 'utf8')).toBe(edited)
  const siblings = (await readdir(`${path}.legacy-backup`)).filter(name => name.startsWith('crypto-trader.'))
  expect(siblings).toHaveLength(1)
  expect(await readFile(join(`${path}.legacy-backup`, siblings[0], 'agent.cordis.yml'), 'utf8')).toBe(stamp('[]\n'))
})
it('operator re-checks a differing default that is already archived instead of leaving it in the roster', async () => {
  // Given 差异版本已按内容哈希归档，名册根又出现同一份受管默认
  const path = await root()
  await legacy(path, 'crypto-trader')
  await legacy(`${path}.legacy-backup`, 'crypto-trader', true)
  await installPresets([], path)
  await legacy(path, 'crypto-trader')
  // When 安装器再次执行
  await installPresets([], path)
  // Then 名册副本被清除，归档仍只有一份
  expect(await readdir(path)).not.toContain('crypto-trader')
  expect((await readdir(`${path}.legacy-backup`)).filter(name => name.startsWith('crypto-trader.'))).toHaveLength(1)
})
it('operator leaves a legacy default in place while a replacement role is customized', async () => {
  // Given 替代角色被用户定制，名册根另有一个受管旧默认
  const path = await root()
  await installPresets([], path)
  await legacy(path, 'us-trader')
  await writeFile(join(path, 'trader/preset.yml'), 'name: custom\n')
  // When 安装器再次执行
  await installPresets([], path)
  // Then 旧默认不被迁移，保留在原处
  expect(await readdir(path)).toContain('us-trader')
})
it('refuses symlink targets without writing through them', async () => {
  const path = await root()
  await mkdir(path, { recursive: true })
  const external = join(path, '../external')
  await mkdir(external)
  await symlink(external, join(path, 'trader'), 'dir')
  await expect(installPresets([], path)).rejects.toThrow('symlink')
  expect(await readdir(external)).toEqual([])
})
it('uses effective enabled loader rows, not installed package reachability; honors common root', async () => {
  const path = await root()
  const imported = vi.fn(async () => ({ getPresetContribution: crypto }))
  await installFromLoader({ entries: () => [
    { disabled: false, options: { name: '@dshtrading/crypto', config: { presetRoot: path } } },
    { disabled: true, options: { name: '@dshtrading/us' } },
    { disabled: false, options: { name: '@dshtrading/connector-tencent/dataplane' } },
  ], import: imported })
  expect(imported).toHaveBeenCalledExactlyOnceWith('@dshtrading/crypto')
  expect(await readdir(path)).toEqual(['instrument-researcher', 'master', 'risk-reviewer', 'trader'])
})
it('rejects conflicting roots and unreadable market assets instead of silently dropping a market', async () => {
  const imported = vi.fn(async () => { throw new Error('missing asset') })
  await expect(installFromLoader({ entries: () => [
    { disabled: false, options: { name: '@dshtrading/crypto', config: { presetRoot: '/a' } } },
    { disabled: false, options: { name: '@dshtrading/us', config: { presetRoot: '/b' } } },
  ], import: imported })).rejects.toThrow('Conflicting')
  expect(imported).not.toHaveBeenCalled()
  await expect(installFromLoader({ entries: () => [{ disabled: false, options: { name: '@dshtrading/crypto' } }], import: imported })).rejects.toThrow('missing asset')
})
