# Agent Note: 软件更新入口迁出设置面板（左栏底栏更新按钮 + 有新版文案 + 独立更新对话框）

Status: implemented

## Problem

自动更新插件（[2026-09-05-auto-update-plugin](2026-09-05-auto-update-plugin.md)）把「软件更新」做成设置面板一级菜单，更新可用性只在设置按钮上点一个小红点。用户要求：软件更新入口从设置界面抽出来，放到左侧自选栏左下角设置按钮的旁边；有新版本时直接出现「有新版」文字提醒，而不是靠红点猜。

## Decision

1. **入口落位**：client-ui-trading 的 MarketDock 底栏（展开态 = MarketSidebar.footBar，折叠态 = 44px 竖条底部）改为两个并排按钮：软件更新 + 设置。更新可用（updateAvailable，沿用 host /dshtrading/api/updater/state 的挂载 + 30 分钟轮询）时更新按钮文案切换为「有新版」并红字高亮；折叠态无文案空间，回退为按钮上的装饰红点（本轮同时给竖条按钮补 position: relative，此前红点实际相对 fixed 的 dock 定位）。
2. **对话框承载**：client-ui-updater 不再注册 settings.section，改注册宿主 shell.overlay 浮层条目 dshtrading-updater-dialog（order 90）。原 UpdaterSection 拆为 UpdaterPanel（纯内容，保留 30s / 运行中 1.2s 轮询与 update-available 事件同步）+ UpdaterDialog（遮罩、面板、Escape 与遮罩点击关闭，pointer-events: auto 重新接管浮层指针事件）。
3. **跨插件对接**：沿用既有 DOM 自定义事件契约（不 import 彼此模块）——左栏更新按钮 dispatch dshtrading-updater-open（UPDATER_OPEN_EVENT），对话框监听并打开；dshtrading-update-available（UPDATE_AVAILABLE_EVENT）继续由面板在快照变化时同步可用性。设置面板里不再有更新页。
4. **i18n**：dshtrading.market 新增 entry.update / entry.updateAvailable，dshtrading.updater 新增 close；zh/en 同步，contract.ts union 同步，dsh-i18n 中心包经静态 import 自动跟随。

## Alternatives considered

- **保留设置 section，只额外加左栏入口**：与「从设置界面抽出来」相悖，设置里会出现两个入口，否决。
- **对话框做在 client-ui-trading 内**：要把整块更新 UI（版本卡 / 发布说明 / 增量 apply / 重启）连同桥逻辑搬进 trading，破坏 updater 插件归属与 node 半 / 浏览器半同包契约，否决。
- **由 trading 声明子 slot、updater 注册进去**：能拿到类型化宿主位，但让 updater 反向依赖 trading 的 slot 契约，耦合并未减少反而多一条跨包类型边；shell.overlay 是宿主通用浮层，零新增依赖方向，否决。
- **裸 react-dom portal 到 body**：宿主浮层已是全屏 fixed 层，portal 无额外收益，且引入未声明依赖，否决。

## Verification

- pnpm --filter @dshtrading/client-ui-trading build、client-ui-updater build、dsh-i18n build 全绿。
- pnpm i18n:check 绿（5 命名空间 / 1012 zh 键）；node scripts/typecheck-gate.mjs 绿（棘轮总错误 473→472）。
- client-ui-updater test 15/15、client-ui-trading test 394/394 通过。
- UI 实证（一次性 trading-verify 影子 profile + 隔离 headless Chrome CDP，验证后已删除 profile 与临时目录）：左栏底栏渲染「软件更新 | 设置」两个入口；dispatch dshtrading-update-available({available:true}) 后更新入口文案变为红色「有新版」；dispatch dshtrading-updater-open 后弹出 role=dialog[aria-modal=true] 的「软件更新」对话框（遮罩、关闭按钮、版本卡、发布页链接）；全程零 console.error / 零未捕获异常。截图 /tmp/updater-verify-1-nobadge.png、-2-available.png、-3-dialog.png。折叠竖条态本轮未单独截图（无文案空间，仅沿用同一 updateAvailable 点红点；顺带把红点的定位基准补为按钮自身）。

## Consequences

- 更新可用时左栏底栏常驻「有新版」文案，用户无需打开设置即可察觉并一键进入更新对话框。
- 更新对话框与官方设置弹层同为 frame-wide 浮层，互不依赖；updater 的 settings.section 退出后设置面板导航少一项（无其他消费者）。
- 新增 @deepseek-ai/dsh-client-ui-layout 依赖（仅取 shell.overlay 的 slot 类型增强），已随 lockfile 更新。
- 限制：折叠竖条态仍无法显示文案，只有红点；「有新版」文案依赖 host 快照轮询（桥缺席时永不出现，符合既有降级语义）。
