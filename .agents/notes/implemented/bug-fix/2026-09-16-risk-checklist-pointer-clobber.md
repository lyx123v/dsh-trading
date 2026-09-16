# Agent Note: 三份风控清单正文被路径指针覆盖——恢复与可分发门禁

Status: implemented

## Problem

`cn-risk-checklist` / `us-risk-checklist` / `hk-risk-checklist` 的包资产正文（各 22-23 行、约
3.3-4.3 KB）在 `81f239f fix(skills): resolve sync-skills merge conflict and enhance symlink
resolution` 中被覆盖成 59 字节的单行内容——`../../../packages/kit-*/assets/skills/*-risk-checklist.md`，
即 `.agents/skills/<name>/SKILL.md` 这条符号链接自身的落盘文本（Windows 无 symlink 时 git 会把
链接存成含目标路径的普通文件）。该内容随后被 `sync-skills` 反复照抄回资产并随每个 kit 包发布。

影响是静默的：技能名、frontmatter 描述都还在，只有正文没了；`presets.ts` 把
`${market}-risk-checklist` 写进 trader 与 risk-reviewer 的技能白名单，于是 US/CN/HK 两个真正
做下单与复核的角色加载到的是空清单，而 crypto/futures/global 三份同族清单是正常的，对照之下
更难发现。三份清单的实际加载态在本机 profile 副本里同样是指针。

## Decision

1. **恢复正文**：从最后一版完好内容 `c707d2e` 取回三份清单原文写入 kit 资产；因符号链接仍指向
   资产，`.agents/skills/<name>/SKILL.md` 随即可读到正文。恢复后按上一变更的口径补上
   「依据闸门」一条，与 crypto/futures/global 三份保持同一契约。不重写内容——历史正文是既有
   领域判断，重写等于替 owner 重新定义 A 股/美股/港股规则。
2. **堵住再犯路径**：`scripts/sync-skills.mjs` 新增可分发判定 `distributableContentError`，源内容
   为纯路径指针、或体量低于 `MIN_SKILL_BYTES`（512）时**拒绝写入包资产并抛错使构建失败**；
   判定函数导出供测试，CLI 入口加 invoked-directly 守卫以便 import。
3. 保留符号链接布局不动。

## Alternatives considered

只修数据、不加门禁：同样的覆盖在任何 `core.symlinks=false` 的 checkout 上都会重演，且没有任何
一处会报错——必须同时堵路径。把六个 `.agents/skills` 符号链接改造成实体文件：能从源头消掉
Windows 落盘风险，但要改动六个技能的 git 文件模式，属独立的结构决策；门禁已阻断损害路径，本次
不做，留在记录里备查。指针合成三份新清单：历史里就有真内容，重写既浪费又可能偏离 owner 规则——
直接恢复。让 sync-skills 只告警不失败：三份清单丢了近一个月无人察觉，正是因为没有任何一处变红。

## Consequences

- 三份清单回到 3821 / 3278 / 4316 字节，本机技能目录立即可见正文（恢复后当前会话的技能面
  已带上三份清单的 description）。
- `pnpm build` 现在会在源技能损坏时以非零退出并列出被拒技能；`MIN_SKILL_BYTES=512` 位于
  最小真实技能（crypto-risk-checklist 3297 字节）与指针（59 字节）之间，留有足够余量。
- `crypto-instrument-analysis` / `crypto-risk-checklist` / `futures-risk-checklist` 仍是符号链接，
  在非 symlink checkout 上属同一类隐患——现在会被门禁拦下而不是静默分发。
- 同步契约本体在 [2026-08-31-skills-architecture-specification.md](../architecture/2026-08-31-skills-architecture-specification.md)，
  其事实行同步更新并指向本记录。

## Verification

`pnpm test:scripts` 22 例通过（新增 2 例覆盖指针拒绝与残片/正文区分，均按 BDD 门禁写）；恢复后
逐文件 `wc -c` 确认字节数、`grep 依据闸门` 三份各 1 处；`pnpm build` 的 sync-skills 步骤 19 条
同步无 Refused，说明恢复内容可通过门禁往返；`pnpm test:audit`、`node scripts/typecheck-gate.mjs`
通过。
