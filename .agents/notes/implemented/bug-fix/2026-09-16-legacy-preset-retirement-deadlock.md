# Agent Note: 遗留市场预设退役死锁——备份已存在时名册副本永久残留

Status: implemented

## Problem

`installPresets` 的旧预设退役分支在 `<presetRoot>.legacy-backup/<id>` 已存在时直接 `continue`，
名册根 `<presetRoot>/<id>` 原样保留。本机因此长期显示 `cn-trader` / `hk-trader` /
`crypto-trader` / `us-trader` 四个废弃预设：这些目录由 #70 之前的市场包自安装逻辑在首次
归档之后重新写回，而「不覆盖既有备份」的保护又让退役在第二次及以后永不生效——两者互相锁死。
实测四个目录与归档副本逐字节相同。

## Decision

退役分支按内容分派，备份名永不覆盖：

- 备份不存在 → `rename` 到备份（原行为）。
- 备份存在且两份文件都与名册副本逐字节相同 → 删除名册副本（内容已在归档中，不丢数据）。
- 备份存在但内容不同（另一版本的旧默认）→ 归档到 `.legacy-backup/<id>.<hash8>` 后删除名册
  副本；同名归档已存在则跳过。

保护条件全部不变：只处理管理戳完好、文件集合恰为 `agent.cordis.yml` + `preset.yml` 的受管
目录；自定义或无戳目录、含额外用户文件的目录一律不动；任一替代角色被接管时整组不迁移。

本机四个残留目录同步清除，内容仍在该 home 的同级 `.legacy-backup`。

## Alternatives considered

保留原语义、只做一次性手工删除：本机确实清干净，但任何从旧版本升级且备份名已被占用的安装
都会继续常驻四个死预设，缺陷留在分发面——选择改逻辑。备份已存在时重命名到 `<id>.legacy-2`
或时间戳：与 `<id>.<hash8>` 同效，但 hash 名幂等、重跑不产生新目录——选 hash。差异版本直接
删除而非另名归档：虽只是可再生成的托管文本，仍不值得丢一个版本的历史默认内容。

## Consequences

- 本机 `~/.dsh-trading-presets/` 只剩四个角色预设；旧目录内容保留在
  `~/.dsh-trading-presets.legacy-backup/`。
- 与 [2026-09-06-unified-trading-role-presets.md](../architecture/2026-09-06-unified-trading-role-presets.md)
  的退役语义相比：备份仍不覆盖、自定义目录仍不删除，但**已归档的受管默认副本会被删除**而不是
  留在名册里；该记录的事实行同步更新并指向本记录。
- `packages/base/test/presets.test.ts` 覆盖三条新分支：相同内容退役、差异内容另名归档、
  替代角色被定制时不迁移。

## Verification

`npx vitest run packages/base/test/presets.test.ts` 13 例通过。本机清理后 `ls` 确认名册只剩
`trader` / `instrument-researcher` / `risk-reviewer` / `master`，`.legacy-backup` 下四个目录
仍在；清理前逐目录 `diff` 两份文件与归档一致才删除。
