# 金十网页版热度快讯接口 —— 原始证据（2026-09-13）

## 结论

金十快讯的四级热度（火/热/沸/爆）是网页版能力，可服务端筛选；官方 MCP 不行。

- 官方 MCP list_flash 的 inputSchema 只有 cursor（additionalProperties:false）；传 level/important/heat/channel 等被上游拒绝：validating "arguments": ... unexpected additional properties ["level"]。条目字段仅 content/time/url（search_flash 多 title），无任何热度字段。
- 网页版接口（www.jin10.com 前端 bundle index.06ae0c93d9.js 逆向 + 真实网络复核）：

      GET https://3318fc142ea545eab931e22a61ec6e5c.z3c.jin10.com/flash?params=<JSON>
      headers: x-app-id: bVBF4FyRTn5NJF5n
               x-version: 1.0
               handleError: 1
               referer: https://www.jin10.com/
      params : { channel:[1,5,9], hot:["热","爆"], max_time? }
      响应   : { status, message, data:[{ id, time, data:{title,content,source,…}, hot, important, … }] }

  单页固定 50 条；max_time = 上一页最旧一条的 time 原串翻页；详情 URL = https://flash.jin10.com/detail/<id>。

Bundle 中的常量（index.js @9136 模块）：r=[1,2,3,4]、o={4:"爆",3:"沸",2:"热",1:"火"}，默认 hotFilter=[1,2,3,4]（网页版默认全选四档）；请求参数由 ed() 组装，hot 非空才带。

## 实测（probe.mjs，2026-09-13）

| 请求 hot | 条数 | 返回 hot 分布 |
| --- | --- | --- |
| 不带 | 50 | 49 空 + 1 热 |
| ["火"] | 50 | 火 50 |
| ["沸"] | 50 | 沸 50 |
| ["爆"] | 50 | 爆 50 |
| ["热","爆"] | 50 | 热 38 + 爆 12 |

翻页：page1 最旧 2026-09-12 00:01:35；以它作 max_time 得 page2 最新 2026-09-12 00:01:09，无重叠。

原始响应见 EVIDENCE/ 目录。sample.data.title 常为空，标题需从 content 的 【…】 提取（与服务层 flashTitle 一致）。

## 边界

- 这是非官方网页接口（与官方 MCP 两套入口，写死逆向的 x-app-id），仅用于热度筛选路径；MCP 仍是主入口。
- 只下发标题/时间/链接/热度标签，content 正文不下发（铁律 #5）。
- hot 是分类语义：选中若干档 = 只返回该档已分类条目；不带 hot 则返回含大量未分类（hot 为空）的完整流。
