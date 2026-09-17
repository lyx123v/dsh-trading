# @dshtrading/client-ui-special-indicators

## 0.4.1

### Patch Changes

- 私有插件并入 fixed 组版本流：桌面 vendor 闭包与增量更新载荷硬校验所有打包包版本等于 release tag（pack-update-payload），changesets ignore 使其停在 0.1.0 并令 v0.4.0 mac 构建失败。版本随家族演进，保持 private 不发布（publish-npm 跳过 private）。
