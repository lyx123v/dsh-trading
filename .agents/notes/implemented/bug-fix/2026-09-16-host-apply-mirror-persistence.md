# Agent Note: host 落地 localStorage 镜像滞后——四个 store 统一走 applyHost 持久化

Status: implemented

## Problem

`selection` / 自选行 / 图表激活名册 / 分组注册表升位 host SSOT 后（[watchlist host SSOT](../feature/2026-09-01-watchlist-host-ssot.md)、
[indicator chart activation](../feature/2026-09-04-indicator-agent-chart-activation.md)），localStorage 只剩
「降级缓存镜像」一职，但四家的镜像只在**本地交互路径**（GUI 点选 / add / remove / togglePreset …）被写；
**host 权威落地**一律调通用 observable 的 `set()`——观察值更新了，镜像没更新：

- `host-watchlist-sync.ts`：`syncFromHost()` / `boot()` 的 `GET /watchlists`、SSE `'watchlists'` 重拉的
  自选行与分组注册表；
- `host-chart-sync.ts`：`syncFromHost()` / `boot()` 的 `GET /chart/indicators`；
- `host-watchlist-sync.ts`：SSE `'selection'` 与启动同步的选中标的。

复现链（选中标的）：GUI 点 AAPL（镜像 AAPL）→ agent `watchlist_select` 换 00700（观察值变、镜像仍 AAPL）
→ 桥降级（宿主未起 / 503）启动 → `boot()` 拉不到 host → `createSelectionStore()` 读旧镜像 AAPL，
中栏图回到旧标的。自选行 / 名册 / 分组同构。正常路径（host 可达）无害：每次启动同步都用 host 覆盖观察值；
危害只在「镜像被当作权威」的降级启动那一刻暴露，因此长期未被察觉。

派生本地写同样滞后：`applyLocalMembership`（入组/移出）与 `stripLocalGroup`（删组剥离）走 `update()`。

## Decision

四个 store 各暴露 `applyHost(...)`：**观察值 + localStorage 镜像一次写完**，host 落地与派生本地写一律经它。

- `SelectionStore.applyHost(instrument)`：清洗 → `set` → `writeJson`（`select()` 共用同一 `applyLocal`）。
- `WatchlistStore.applyHost(rows)`：host 行原样写入（开放市场词汇不做 sanitize，与既有裁决一致）→ `set` → `persist`；
  `applyLocalMembership` 改为接收 `WatchlistStore` 并以 `applyHost` 落地（不再走 `update()`）。
- `ChartStateStore.applyHost(instances)`：原样写入（host 行不过 sanitize，同创建裁决）→ `set` → `persist`。
- `WatchlistGroupsStoreApi.applyHost(groups)`：`set`（`activeGroupId` 是纯本地 UI 态，原位保留）→ `persist`。

调用点：`host-watchlist-sync.ts` 的 `syncFromHost` / `boot`×2 / `syncGroupsFromHost` / `stripLocalGroup`，
`host-chart-sync.ts` 的 `syncFromHost` / `boot`×2。

**不改走 `selection.select()`**：它已被包装成 host-first，SSE 里调用会把刚收到的值再 PUT 回 host，
自激成信号回环。**也不让这三家覆写 `set()/update()` 一律持久化**（见备选）。

## Alternatives considered

- **只给选中标的补（第一版的克制范围）**：危害最大的一处已堵，但同族三处的回退面（左栏行 / 指标名册 /
  分组）实测同构、补丁形状相同；分两次改只会让后来者按 store 逐个踩。
- **让 watchlist/chart/groups 覆写通用 `WritableObservable.set`（改一处全生效）**：代码更少，但
  `createObservable` 是四家共用的通用契约，「set 是否落盘」按 store 分叉会变成隐性差异；且与选中标的
  已落地的 `applyHost` 形成两套机制，补第五家时无从判断该照哪套。
- **SSE 处理器改调 `selection.select()`**：省一个方法，但会自激，否决。
- **只在 SSE 处理器补一行 `writeJson(SELECTION_KEY, …)`**：需导出私有存储键，且启动同步仍滞后
  （工具在标签页关闭期间换点，下次启动读到 host 却不刷镜像），只堵一半。

## Consequences

- 四个镜像的降级启动都回落到最近一次 host 权威值，而不是上一个本地交互值。
- 四个 store 的写路径收敛为一条语义：状态变更落盘（`applyHost`，或自带 `persist()` 的本地方法）。
  已知未覆盖的同类点：无——`groups.upsertGroup/removeGroupLocal/setActiveGroup`、`watchlists.add/remove`、
  `chart` 的四个本地方法本就走 `persist()`。
- 回归：`store.test.ts` +6（选中标的 3 + 自选行 / 分组注册表 / 派生 membership 各 1）、
  `chart-state.test.ts` +1、`host-watchlist-sync.test.ts` +4（SSE 选点、boot 自选行、SSE 自选行+分组、
  chart 名册的 `applyHost` 落地守卫）。图表同步守卫寄居 `host-watchlist-sync.test.ts`：它复用同一份
  api 替身，测试棘轮下新建带模块替身的测试文件即新增测试债。
- 新用例按测试棘轮写（角色前缀 + Given/When/Then + 断言、零 `vi.*` 新增；chart 的 localStorage 用
  手写契约假件并按用例还原全局）。

## Verification

- `packages/client-ui-trading` 全量：53 文件 / 450 例通过（新增 11）。
- 仓库门禁 `pnpm -r test`（47 包）与 `pnpm -r build` 均 exit 0；`node scripts/test-audit.mjs --check`
  零新增测试债；`node scripts/typecheck-gate.mjs` 通过（总错误 472 / 基线 473）。
- 交付面：`pnpm build`（client-ui-trading）后，`lib/client.js` 与桌面 profile
  `~/.dsh-trading/profiles/trading-web/node_modules/@dshtrading/client-ui-trading/lib/client.js`
  仍是同一 inode（哈希一致）。运行中的桌面宿主（127.0.0.1:52573）重取页面清单后 `rev` 从
  `88b8c092a4c4` 变为 `96f320c75d58`，按新 `rev` 请求
  `/plugins/??…@dshtrading/client-ui-trading/client.js` 返回 200、正文含 17 处 `applyHost`
  （旧 `rev` URL 仍回旧内容——rev 是内容指纹，也就是缓存键）。结论：重载交易 UI 即生效，
  不需要 `plugin install` 或宿主重启。
