# Agent Note: 私有插件并入 fixed 组版本流——桌面更新载荷家族等值硬校验

Status: implemented

## Problem

v0.4.0 发布（tag `bd76c7d`，run 35218411220）macOS `build-desktop` 在
`node scripts/pack-update-payload.mjs` 失败：`version mismatch:
@dshtrading/client-ui-special-indicators@0.1.0 != release 0.4.0`。该脚本把
`desktop/runtime/profile-trading/vendor/*.tgz`（安装器内实际载荷字节）打成
增量更新包并生成信任锚 manifest，硬校验每个打包包版本等于 release tag——
设计注释明言「payload can never drift from the tagged family version」。
95b209c 把私有插件接进桌面 vendor tgz 闭包后，它进入了这个等值世界，但
30f24fe 的 changesets `ignore` 把它排除在版本联动外，两套决策在同一次发布里
相撞。npm 0.4.0 已发布（npm-publish job 全绿）、Windows 构建成功，github-release
因 mac 失败被跳过。

## Decision

- 私有插件**并回 fixed 组版本流**：移除 changesets `ignore`，其版本随家族
  统一 bump（patch changeset 走 `@dshtrading/client-ui-special-indicators`）；
  保持 `private: true`，永不 npm 发布（`publish-npm.mjs` 按 private 字段跳过）。
- `profile-config-preflight.sh` 的具名 `DRIFT_EXEMPT` 集合删除，世代一致性
  检查改按 manifest `private` 字段泛化跳过——不再维护具名清单，且对已安装
  副本逐个读 private 标志，无过渡死锁。
- `verify-release-version.mjs` 的 private 豁免保留（见
  [release-version-gate-private-package-exempt](2026-09-17-release-version-gate-private-package-exempt.md)），
  作为新 private 包尚未入族的通用兜底；pack-update-payload 保持零豁免硬校验。

为什么不是在 pack-update-payload 里豁免私有包：更新 manifest 记录每包版本，
更新器按版本比较决定刷新——版本冻结而内容随发布演进，等于在桌面增量通道里
制造「同版本换内容」/永久陈旧副本，正是发布契约禁止的事。

## Alternatives considered

- **pack-update-payload 豁免 private**：见上，被内容一致性否决。
- **保留具名 DRIFT_EXEMPT**：注释「不进 fixed 族」从此为假，且每加一个私有
  包要多维护一处清单；private 字段泛化后零维护。
- **每次发布手工 bump 私有包**：重复摩擦，漏做即发布失败，不如交给 changesets。

## Consequences

- 发布流程零特殊步骤：`pnpm changeset version` 自动把私有包带到家族版本。
- 桌面安装器与增量更新载荷里的每个包版本恒等于 tag，manifest 信任锚语义完整。
- 本地 profile 过渡：下次 `pnpm build && scripts/refresh-trading-web-profile.sh`
  会把私有插件副本统一装到家族版本，世代检查恢复全体一致。
- v0.4.0 的 npm 发布内容保持锁定；桌面/Release 通道由下一 patch 版本补齐
  （tag 不可改写，按失败恢复契约走新版本）。
