---
"@dshtrading/connector-jin10": minor
"@dshtrading/base": minor
---

新增金十数据 MCP 连接器（跨市场快讯/资讯/财经日历）。`@dshtrading/connector-jin10`
封装 Jin10 标准 MCP 服务（Streamable HTTP，协议 2025-11-25，Bearer BYOK）：9 个市场无关
只读工具 `flash_list` / `flash_search` / `news_list` / `news_search` / `news_get` /
`econ_calendar` / `global_instruments` / `global_quote` / `global_klines`；
`structuredContent` 优先、`cursor → next_cursor / has_more` 分页、限流与未知品种错误映射；
快讯/资讯只下发标题/时间/链接（+ 文章导语），正文零再分发。`@dshtrading/base` 新增
host 平面工具行 `dsh-trading-connector-jin10`（市场无关共享行）并纳入安装闭包。
