# Agent Note: 市场快讯从中间容器迁到右缘会话竖条（功能页签 3 号）

Status: implemented

## Problem

金十快讯接入时（见 [金十 MCP 连接器](./2026-09-13-jin10-mcp-flash-news-connector.md)）以
`stageViews.register({ id: 'flash' })` 挂在**中间容器**，与行情/策略/知识库并列成中栏 tab。
用户裁决（2026-09-13）：快讯不要占中间容器，应放右缘侧边栏容器，和「定时任务」「资产」一个思路
（竖条功能页签，激活时原位覆盖对话列）。

## Decision

1. 移除 `client/index.ts` 的 flash stage 注册与 `FlashFeedStage` 引用；删除
   `FlashFeedStage.tsx` / `flash-feed-stage.module.css`——快讯不再出现于中栏 tab。
2. 新建 `FlashPanel.tsx` + `flash-panel.module.css`（取数/轮询/搜索/翻页逻辑从旧 stage 平移）：
   fixed 面板，定位与宽度吃 frame 的 `--dshtrading-sidebar-w` / `--dshtrading-chat-user-w`，
   与 `ScheduledTasksPanel` / `HoldingsPanel` 同款原位覆盖对话列；头部标题 + × 关闭。
3. `SessionRail` 增加第四项功能按钮（`IconFlash` 闪电，新增矢量图标）与 `flashOpen` 状态；
   **三页签互斥**（定时任务/资产/快讯同一容器二选一），写
   `body[data-dshtrading-flash-open='on']`；`shell-pad.css` 规则 13 隐去对话列直接子节点，
   `chat-resize-handle.module.css` 在快讯面板激活时同步隐藏对话列调宽手柄（与任务页签一致）。
4. locale 新增 `flash.close`（zh/en + contract 联合）；`stage.flash`「快讯」继续作竖条
   aria-label / 面板标题复用。

## Alternatives considered

- 保留中栏 stage 并同时加竖条入口：放弃——双入口冗余，且用户明确不要中栏。
- 做成可并排的独立右栏新轨道：放弃——与现有「面板原位覆盖对话列、三者互斥」的容器模型不符，
  会新增轨道并牵动 shell-pad 栅格与 QuotePane 测量。
- 复用 `session-rail.module.css` 的 `.tasksPanel` 类：放弃——面板自持 CSS module 是既有模式
  （HoldingsPanel 先例），跨面板复用任务类名会污染语义。

## Consequences

- 中栏只剩 行情/策略/知识库；快讯改由右缘闪电按钮开合，点击后原位覆盖对话列（非并排非悬浮）。
- 验证（构建产物 + 桌面壳，2026-09-13）：无头 Chrome CDP 点击 `[aria-label="快讯"]` ——
  点击前 `panelMounted=false`、可见文本无「快讯」（中栏 tab 已移除）、竖条五项
  [折叠/新会话/定时任务/资产/快讯]；点击后 `panelMounted=true`、`body.dataset.dshtradingFlashOpen='on'`、
  面板标题「快讯」、搜索框在；截图确认面板位于右缘、列表含金十快讯与「加载更多」。
- `client-ui-trading` 46 文件 / 389 用例全绿；构建通过。
- 快讯面板的 CSS 令牌改走 `--dsw-futu-*`（与竖条其余面板一致），不再用旧 `--panel-*` 名。
