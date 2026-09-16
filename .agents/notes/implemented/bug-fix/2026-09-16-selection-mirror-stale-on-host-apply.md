# Agent Note: 选中标的 localStorage 镜像滞后——host 落地补持久化

Status: implemented

## Problem

`selection` 升位 host SSOT（[watchlist host SSOT](../feature/2026-09-01-watchlist-host-ssot.md)）后，
localStorage 只剩「降级缓存镜像」一职，但它只在 GUI 点选路径（`selection.select()`）被写；
工具/其它标签页驱动的选点经 SSE 重拉落地时走 `selection.set()`——observable 更新了，镜像没更新：

- `host-watchlist-sync.ts` 的两处 host 落地（`boot()` 的 `GET /selection`、SSE `'selection'`
  处理器）都调 `selection.set({ instrument })`，不写 `dshtrading.selection.v1`。
- 复现链：GUI 点 AAPL（镜像 AAPL）→ agent `watchlist_select` 换 00700（observable 变、镜像仍 AAPL）
  → 桥降级（宿主未起 / 503）启动 → `boot()` 拉不到 host → `createSelectionStore()` 读旧镜像 AAPL，
  中栏图回到旧标的，与 host 的 00700 不一致。
- 正常路径（host 可达）无害：每次启动同步都用 host 覆盖 observable；危害只在「镜像被当作权威」
  的降级启动那一刻暴露，因此长期未被察觉。

## Decision

- `SelectionStore` 增 `applyHost(instrument)`：清洗 → `store.set()` → `writeJson(SELECTION_KEY)`，
  observable 与 localStorage 镜像一次做完；`select()` 与它共用同一 `applyLocal` 实现。
- `host-watchlist-sync.ts` 的 `boot()` 与 SSE `'selection'` 两处改走 `applyHost`。**不**改走
  `selection.select()`：该方法已被包装为 host-first，在 SSE 里调用会把刚收到的值再 PUT 回 host，
  自激成信号回环。
- 市场词汇清洗（非法/缺失 → `inferMarket` 回推）由 `createSelectionStore` 里两处重复内联收敛为
  `sanitizeInstrument()`；初始化、`select`、`applyHost` 三条路径同源。

## Alternatives considered

- **只在 SSE 处理器补一行 `writeJson(SELECTION_KEY, …)`**（最初设想的最小补丁）：要导出私有存储键，
  且启动同步仍滞后——工具在标签页关闭期间换点，下次启动读到 host 却不刷镜像，桥降级后照样回退，只堵一半。
- **让 selection store 覆写 observable 的 `set()` 一律持久化**：写路径唯一，但 `WritableObservable.set`
  是 watchlist/chart/groups 共用的通用契约，按 store 改语义会让「set 是否落盘」变成隐性差异；且
  `select()` 会双重写。
- **SSE 处理器改调 `selection.select()`**：省一个方法，但如上会自激，否决。

## Consequences

- 降级启动回落到的是最近一次 host 权威选中值，而不是上一个 GUI 点选值。
- 同族滞后仍在（本次未改）：watchlist 行（`syncFromHost`）、chart 激活名册（`host-chart-sync`）、
  分组注册表（`syncGroupsFromHost`）的 host 落地同样走 `set()` 不写镜像。它们的回退面是左栏行/
  指标/分组而非行情主图，影响面更小；需要时按同一 `applyHost` 模式补。
- 回归：`store.test.ts` +3 例（GUI 点选持久化 / `applyHost` 换点后重载不回退 / host 非法 market 清洗）、
  `host-watchlist-sync.test.ts` +1 例（SSE `'selection'` 必须经 `applyHost` 落地，防回归到裸 `set`）。
- 新用例按测试棘轮写（角色前缀 + Given/When/Then + 断言、零 `vi.*` 新增），`test-audit` 计数零上升。

## Verification

- `packages/client-ui-trading` 全量：53 文件 / 443 例通过（新增 4 例）；仓库门禁 `pnpm -r test`（47 包）
  与 `pnpm -r build` 均 exit 0。
- `node scripts/test-audit.mjs --check` 通过（零新增测试债）；`node scripts/typecheck-gate.mjs` 通过
  （总错误 472 / 基线 473）。
- 交付面：`pnpm build`（client-ui-trading）后，`lib/client.js` 与桌面 profile
  `~/.dsh-trading/profiles/trading-web/node_modules/@dshtrading/client-ui-trading/lib/client.js`
  仍是同一 inode（哈希一致）；运行中的桌面宿主（127.0.0.1:52573，tokenized URL）按页面清单
  请求 `/plugins/??…@dshtrading/client-ui-trading/client.js` 返回 200 且正文含 `applyHost`
  ——客户端模块即取即读，重载交易 UI 即生效，不需要 `plugin install` 或宿主重启。
