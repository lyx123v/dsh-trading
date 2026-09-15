# Agent Note: 宿主原生右侧栏（文件面板）容器化进 SessionRail 文件页签

Status: implemented

## Problem

宿主 0.1.5 起把 details 列交给官方 sidebar-right dock（`文件`/预览等原生页签）。交易壳用 rtl 四轨道接管宿主栅格后，这个 dock 落在第 4 轨道——视觉上出现在窗口**最左缘**（360px 工具详情轨），与本侧右缘的定时任务/资产/快讯面板分居两角。用户点击对话内文件链接或打开文件树时，面板从最左边弹出，割裂且远离操作焦点。

要求：把宿主自带的这个「右侧边栏」收进我们自己的右侧栏容器，与定时任务、快讯等共用一个容器（同一条对话列轨道、同一组互斥页签），不再出现在最左边。

## Root Cause

- 宿主 dock 的 DOM 挂在 `AppFrame` 的 `data-rightbar-col` 列（frame 第 3 个元素子节点）；交易壳 shell-pad.css 规则 2 把该列钉在 grid-column 4，rtl 下即视觉左缘。
- 宿主 dock 的开合是宿主自有状态（per-session surface store + `ctx.sidebarRight` 控制器），交易壳此前没有任何接管点：既不能改宿主源码（宿主只读），也没有把它的展开态镜像进自有页签体系。

## Decision

四件套，全部走既有契约，不改宿主：

1. **镜像 store**（新模块 `rightbar-store.ts`）：宿主 sidebar-right 面板展开时写 `data-sidebar-right-open`、收起时移除（面板收起后仍挂载在 DOM 里，只被 transform 推出 frame 右缘）。MutationObserver 把该属性镜像成布尔快照（订阅时安装、末退订断开），作为「文件页签激活态」的唯一事实源——宿主侧入口（对话文件链接、dock 自身折叠钮）与本侧按钮共用同一状态，任何一方开合另一方即时同步。读的是**面板**属性而不是 frame 的 `data-rightbar-collapsed`（那是「右栏轨道宽为 0」，窄窗口下与展开态同现，见「评审后续修复」）。
2. **页签开合面**（`client/index.ts` 注入）：ON = `ctx.get('sidebarRight').openTab('files')`（官方导航通路：页签幂等揭示 + 同步展开列）；OFF/互斥 = `isExpanded()` 为真时 `toggleExpanded()`。类型用本地最小结构面（`WorkspaceNavigation` 先例），不 import SDK 包（client 产物 purity gate 禁未声明外部包）；服务点击时惰性解析（apply 时序不保证纪律）。
3. **CSS 搬移**（shell-pad.css 规则 14）：`body[data-dshtrading-files-open='on']` 时把 `[data-rightbar-col]` 列从 grid-column 4 改判到 2（对话列轨道，即各功能页签的容器位），对话列直接子节点隐去（规则 11-13 同款），`--dshtrading-details-w: 0px` 防左缘留空。列锚点用宿主稳定 data 属性 `data-rightbar-col`，不用位置序数。会话列折叠态另见规则 14b（把宿主面板改判 fixed，见「评审后续修复」）。
4. **页签与互斥**（`SessionRail.tsx`）：竖条新增功能页签（文件夹图标，`files.open` = 文件/Files）；激活态 `useSyncExternalStore` 消费镜像 store；`files-open` 写 body 属性驱动规则 14。页签互斥闭环：文件开 → 收任务/资产/快讯/宏观；其余页签开 → 收宿主右栏；新建会话走 `closeContainer()` 统一收起全部覆盖面 + 宿主右栏（先前只收定时任务，见「评审后续修复」）。

## Bugfix（2026-09-15 用户回归：文件打开时左侧自选栏空白）

首版规则 14 上线后用户报告：打开「文件」面板时左侧自选栏变空白（附截图），关闭后中栏行情区又整片空白。实机复现抓到两条链：

1. **MarketDock 旧避让逻辑误判**（主因）：dock 有一段 0.1.4 时代（2.3 定稿）的「工具详情列打开时避让」逻辑——把 `frame.children[2]` 当成落左缘的工具详情列，`setLeft(children[2].rect.right)`。0.1.5 起该位置是 sidebar-right 列，规则 14 又把它搬进对话轨，文件打开时 `rect.right` 变 1426，dock 被内联 `left: 1426px` 甩到视口右缘外 → 左侧空白。
2. **QuotePane 缓存坏测量**（次生）：pane 的几何是组件实测后写内联样式，`left` 取 `dock.right`。dock 跳走期间某次重测把 `dock.right=1699` 缓存住；关面板后 dock 回位但**位置变化不触发 ResizeObserver（尺寸没变）**，坏值永不自愈 → 中栏白屏。

修复：

- `MarketDock.tsx`：避让仅对**旧宿主**生效——children[2] 带 `data-rightbar-col` 标记（0.1.5 sidebar-right 列）时恒 `setLeft(0)`；无标记（≤0.1.4 真工具详情列）保持原避让，不破坏旧 cohort 契约。
- `market-dock.module.css`：`.dock` 显式钉 `left: 0`——fixed 无水平偏移时水平位置走浏览器「静态位置」解析，在 rtl 栅格下随轨道几何漂移，属潜伏脆弱点，与内联避让双保险。

## 评审后续修复（2026-09-15）

同日 review-spd（三个提交）对本容器化提出两条，已同变更修掉：

- **镜像读错信号**：原读 frame 的 `data-rightbar-collapsed`，那是「右栏**轨道**宽为 0」而非
  「面板收起」——宿主在视口 < 768px 的 autoFullscreen 下 `track = shown && !autoFullscreen`
  同样为 0，于是「面板已展开但属性在位」：页签不亮、点不掉（`openTab` 幂等展开不会收）、
  五页签互斥对「宿主侧打开文件」这一路不生效；旧宿主（≤0.1.4 无该属性）则读到常亮，
  隐去对话列却无面板可看。改读面板自己的
  `[data-sidebar-right-panel][data-sidebar-right-open]`，观察器 attributeFilter 同步换到该属性。
- **折叠态面板塌成 0 宽**：规则 14 把 `data-rightbar-col` 搬进第 2 轨、规则 9 折叠时把该轨
  归零，面板被 `width:100% !important` 压成 0 宽而页签仍亮（「先折叠再开文件」与「开着文件
  再折叠」两条路都命中）。新增规则 14b：折叠态把宿主面板本身改判为与定时任务/资产/快讯/
  宏观四块面板同款 fixed（右缘 `--dshtrading-sidebar-w` 起、对话列宽，变量缺席回落 380px），
  只对 `push` 形态生效，`fullscreen` 交宿主 `inset:0` 规则自理。
- **新建会话只收定时任务**：`onClick` 原先只 `setTasksOpen(false)`，资产/快讯/宏观/文件会
  继续盖住新会话。抽 `closeContainer()`（五个覆盖面 + 宿主右栏）供新建会话调用；折叠仍只切
  折叠态（折叠态由规则 14b 兜底，不联动收起）。

回归：`test/rightbar-store.test.ts` 改为面板属性契约，新增「轨道为 0 但面板已展开 → 快照仍
true」与「旧宿主恒 false」；新增 `test/session-rail.smoke.test.tsx` 钉住新建会话的容器让位、
折叠不联动、文件页签开合分流。

## Alternatives considered

- **重排宿主栅格模板把对话列挪到中间**：动第 2/4 轨分工会波及 QuotePane 测量、ChatResizeHandle 定位与规则 9 折叠链，影响面远大于本需求。
- **DOM re-parent 宿主面板进自有容器**：宿主 React 树所有物被搬走后，宿主重渲染时行为不可控（reconciliation 锚点失效），且宿主升级即碎。
- **复刻一个自己的文件树面板**：违背 host-first——文件树/预览/`openResource` 的会话语义全在宿主，复刻要追着 SDK cohort 升级跑。
- **不做镜像 store，只在本侧按钮里存开关**：宿主侧打开文件时页签状态失真（按钮不亮、互斥不生效），回到「容器化不彻底」的老问题。

## Consequences

- 文件/预览面板从此在对话列容器位（紧贴 44px 竖条，380px 用户可拖宽度）展开；左缘工具详情轨在文件态归零，行情区反而变宽。宿主 dock 内部的页签管理（+ 号导览、多页签、分栏、悬浮、fullscreen）全部原样保留。
- 收益与代价同源：面板几何完全由 CSS 规则 14 决定，宿主若改 `data-rightbar-col` 的挂载结构或 `data-rightbar-collapsed` 写入语义，本功能失效但**不劣于现状**（面板回到左缘原位）；锚点用稳定 data 属性已把此风险压到最低。
- 验证遗留：宿主面板滑出/滑入动画依赖页面渲染时钟——**后台标签页**里 transform 过渡冻结（2026-09-04 已知坑），表现为属性已翻转但面板视觉滞后一拍；前台使用不受影响。
- 验证：`rightbar-store` 单测 4 例 + 包内 410 用例全绿；`node scripts/typecheck-gate.mjs` 472 ≤ 基线 473；`node scripts/i18n-audit.mjs --check` OK。实机（trading-web 桌面宿主 55001）CDP 断言全链——初始收起 `files-open=off`；按钮开 `openTab('files')` 展开且面板落对话列轨道（x=1046）；dock 全程 x=0、pane 恒 273/773（修复后开→关→开三循环不漂移）；宿主自身折叠钮收起 → 页签熄灭；定时任务与文件互斥；前台截图核对面板目录树渲染在右缘容器位、自选栏完整。
- 残留：宿主 dock 的原生半屏宽度偏好（662px）仍被既有 `width:100% !important` 钳制规则覆盖为容器宽度，行为与升级前一致，未单独处理。后台标签页里宿主面板 transform 过渡冻结（2026-09-04 已知坑）会让 CDP 读数滞后一帧（属性已翻转、transform 未推进），仅影响自动化验证读数，前台使用不受影响。
