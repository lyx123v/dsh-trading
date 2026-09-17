# Agent Note: 发布版本门禁豁免 private 包——changesets ignore 与 verify-release-version 的口径对齐

Status: implemented

## Problem

30f24fe 引入本地私有插件 `@dshtrading/client-ui-special-indicators`（private，不公开发布）时做了两个配套决策：changesets `ignore` 该包（不入 fixed 组版本流）、`profile-config-preflight.sh` 对其具名豁免世代检查（DRIFT_EXEMPT）。但发布门禁 `scripts/verify-release-version.mjs` 仍要求**所有** `@dshtrading/*` 目录版本等于 release tag。首次实际触发在 v0.4.0 发布预检：changeset bump 后 54 包到 0.4.0，私有包停在 0.1.0，门禁 exit 1（`tag v0.4.0 does not match 1 package(s)`），发布流程被卡。

## Decision

`verify-release-version.mjs` 跳过 `"private": true` 的 manifest，不进入 tag 等值检查；成功输出以 `(private, tag-exempt: name@version)` 透明列出被跳过者。豁免按 `private` 字段泛化判定，不维护具名清单。

依据：npm 家族一致性契约只覆盖会被 `publish-npm.mjs` 发布的包；private 包从不进 npm。桌面 vendor 闭包（`desktop/scripts/build-runtime.mjs` 两清单、`cordis.patch.yml`）全部按包名引用，无硬编码版本号，私有包版本漂移不产生安装器内不一致——这正是该门禁注释声明要防的唯一危害。

## Alternatives considered

- **把私有包 bump 到家族版本**：直接违背 changesets ignore 决策，给一个永不发布的本地插件制造无意义的版本历史；且 changesets ignore 在先（30f24fe 已定），方向反了。
- **门禁内具名豁免清单**：与 preflight 的 DRIFT_EXEMPT 一样按名字维护，私有包每新增一个就要同步两处清单；按 `private` 字段泛化后新私有包自动豁免，零维护。

## Consequences

- 后续新增 private 包自动获得同等待遇，发布门禁不再被未发布包卡死。
- 门禁输出继续列出被豁免的私有包及其当前版本，审计可见。
- 三个版本口径（changesets ignore、preflight DRIFT_EXEMPT、release gate private-exempt）现在语义一致：private = 不参与发布版本一致性。
- **同日晚更新**：私有插件接入桌面 vendor 闭包后并入 fixed 组版本流
  （changesets ignore 移除，见
  [desktop-update-payload-family-version-parity](2026-09-17-desktop-update-payload-family-version-parity.md)），
  其版本恢复家族等值；本门禁的 private 豁免保留为「新 private 包尚未入族」
  场景的通用兜底，pack-update-payload 对打包包保持零豁免硬校验。
- npm 家族等值契约本身未放松：54 个可发布包仍必须与 tag 完全一致。
