# Agent Note: Astra 指令审计——发布授权与知识库写入边界

Status: implemented

## Problem

2026-09-12 依据 OpenAI《Rethinking skills and prompts for GPT-6 Astra》对本机用户级与项目级指令做整体审计，dsh-trading 侧发现三类实质冲突：

1. `.dsh/skills/dsh-trading-release/SKILL.md` 把「build/repair/change release pipeline」也触发完整发版，且同时声称「npm 未授权」与「2026-09-03 起 npm 已授权」；允许删除远端 tag 重推、删除 GitHub Release，并以宽目录 `git add` 暂存。
2. `.agents/skills/content-insight/SKILL.md` 把知识库入库设为默认步骤，并在 `knowledge_ingest` 不可用时直写活跃 store 的 `cards.json`——该 store 有进程内缓存，直写会被后续 flush 覆盖，一次读改写不等于并发安全。
3. 根 `AGENTS.md` 与 `.agents/notes/README.md` 重复承载 Prompt 分层、模型别名（flash/pro）、固定 4 步 CI 闭环与「3 次熔断必须问用户」流程，且硬编码宿主版本。

## Decision

- 发布技能按任务分流：修 CI/管线只诊断、修复与验证；恢复失败 run 需当前授权；完整发布才走版本统一、tag 与推送。历史授权、token、`NPM_PUBLISH_ENABLED` 均不构成当前发布许可。当前配置下推 tag 会连带 npm 发布，只授权桌面发布时不得直接推 tag。失败恢复不得改变已发布 tag 的 SHA，版本修复走新版本。
- 知识库入库仅在用户明确请求时执行，且只经 `knowledge_ingest` 等正式写入接口；工具不可用时保留待导入卡片并报告，禁止直写 `cards.json`、禁止擅自重启实例。
- 根 `AGENTS.md` 收敛为项目契约与按需路由；模型选择按任务难度与成本而非固定别名；熔断条件是「无新证据的原样重试」而非固定次数；宿主版本以实际安装核验。
- 用户级对应项（`~/.agents/skills/content-insight` 等）同批修复，备份与完整清单见 `~/.agents/audits/2026-09-12-astra/`。

## Alternatives considered

- 保留直写回退协议：否决。活跃 store 的内存缓存使直写静默失效甚至丢数据，正确路径是报告工具故障并让用户重载实例。
- 完全拆分 release-config 与 release-execute 两个技能：未采纳。单一技能内的路径分流已能表达边界，拆分会增加路由开销；若将来混淆复发再拆。
- 删除全部治理条款：否决。门禁基线、交付流分级、home 隔离等是实证换来的项目契约，属于要保留的具体边界，不是流程冗余。

## Consequences

- 修发布管线不再可能意外触发发版；发布动作的用户确认点前置且显式。
- 内容总结任务不再默认写共享知识库；入库失败的可见性提高，代价是工具故障时需要用户介入重载。
- 旧笔记中关于「npm 未授权」「删 tag 重推安全」的表述被本决策取代；历史发布记录不回滚，遗留越权发布另行报告。
