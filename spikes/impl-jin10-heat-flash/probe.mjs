/**
 * 金十网页版「热度快讯」接口探针（2026-09-13）。
 *
 * 目的：核实金十快讯 火/热/沸/爆 四级热度是否可服务端筛选（官方 MCP list_flash 无此能力）。
 * 来源：www.jin10.com 前端 bundle（index.js）逆向出的网页版实际请求。
 * 运行：node spikes/impl-jin10-heat-flash/probe.mjs
 * 产物：把每个等级的原始响应写入 EVIDENCE/（只读复核，不参与运行时）。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const evidenceDir = join(here, 'EVIDENCE')
mkdirSync(evidenceDir, { recursive: true })

const ENDPOINT = 'https://3318fc142ea545eab931e22a61ec6e5c.z3c.jin10.com/flash'
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'x-app-id': 'bVBF4FyRTn5NJF5n',
  'x-version': '1.0',
  handleError: '1',
  referer: 'https://www.jin10.com/',
}

async function fetchHot(hot, { maxTime } = {}) {
  const params = { channel: [1, 5, 9], hot }
  if (maxTime) params.max_time = maxTime
  const url = new URL(ENDPOINT)
  url.searchParams.set('params', JSON.stringify(params))
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
  return { params, status: response.status, body: await response.json() }
}

const levels = [
  { name: 'all-no-filter', hot: undefined },
  { name: 'huo', hot: ['火'] },
  { name: 're-bao', hot: ['热', '爆'] },
  { name: 'fei', hot: ['沸'] },
  { name: 'bao', hot: ['爆'] },
]
for (const { name, hot } of levels) {
  const result = await fetchHot(hot)
  const items = Array.isArray(result.body?.data) ? result.body.data : []
  const dist = {}
  for (const item of items) dist[item.hot || '(空)'] = (dist[item.hot || '(空)'] || 0) + 1
  writeFileSync(join(evidenceDir, `${name}.json`), JSON.stringify({ params: result.params, http: result.status, status: result.body?.status, count: items.length, dist, sample: items[0] }, null, 2) + '\n')
  console.log(`${name}: http=${result.status} status=${result.body?.status} n=${items.length} hot=${JSON.stringify(dist)}`)
}

// max_time 翻页
const first = await fetchHot(['热', '爆'])
const items = first.body.data ?? []
const oldest = items[items.length - 1]
const second = await fetchHot(['热', '爆'], { maxTime: oldest.time })
writeFileSync(join(evidenceDir, 'paging.json'), JSON.stringify({ page1Oldest: oldest.time, page2Newest: second.body.data?.[0]?.time, overlap: second.body.data?.some((i) => i.id === oldest.id) ?? null }, null, 2) + '\n')
console.log('paging: page1 oldest=' + oldest.time + ' page2 newest=' + second.body.data?.[0]?.time)
