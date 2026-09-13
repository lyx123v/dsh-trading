/**
 * 金十数据「快讯/资讯」覆盖探针：快讯源到底覆盖哪些市场标的、能不能按品种取新闻？
 *
 * 结论口径：
 *   - 快讯（list_flash/search_flash）与资讯（news_*）都是**市场综合线**，条目只有
 *     {content→title, time, url}，没有 symbol/code/tag 字段，也没有按品种过滤的参数；
 *   - 唯一可按主题收敛的入口是中文关键词 search_flash（一次性返回，最多 150 条）；
 *   - quote://codes 的 97 个品种是**报价/K线**代码表，不是新闻分区。
 * 本脚本实测：拉全量品种表分组 + 对一组资产类别关键词跑 search_flash 统计命中。
 *
 * 用法： JIN10_TOKEN=sk-... node spikes/impl-jin10-mcp/flash-coverage.mjs
 */
import { Jin10McpClient, Jin10Service } from '../../packages/connector-jin10/lib/index.js'

const token = process.env.JIN10_TOKEN
if (token === undefined || token.length === 0) throw new Error('JIN10_TOKEN env required')

const service = new Jin10Service(new Jin10McpClient({ token: () => token }))

// ---------- A. 报价品种表（quote://codes, 97）分组 ----------
const instruments = await service.listInstruments()
const groups = {
  '贵金属/金属': (i) => /XAU|XAG|COPPER|铜|金|银/.test(i.code + i.name),
  '能源': (i) => /OIL|NG|GAS|油|气|能源/.test(i.code + i.name),
  '外汇': (i) => /^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|CNH|CNY|HKD|SGD)/.test(i.code) && !/^USDX/.test(i.code),
  '全球指数': (i) => /SPX|NDX|DJI|DAX|FTSE|NIKKEI|CAC|STOXX|HSI|HSCEI|指数/.test(i.code + i.name),
  'A股指数': (i) => /SH|SZ|CSI|上证|深证|沪深|创业板|科创/.test(i.code + i.name),
}
const claimed = new Set()
const grouped = {}
for (const [label, test] of Object.entries(groups)) {
  grouped[label] = instruments.filter((i) => { if (claimed.has(i.code)) return false; if (test(i)) { claimed.add(i.code); return true } return false })
}
grouped['其他'] = instruments.filter((i) => !claimed.has(i.code))

console.log('==== A. 报价品种表 quote://codes: ' + instruments.length + ' 个 ====')
for (const [label, items] of Object.entries(grouped)) {
  if (items.length === 0) continue
  console.log('\n[' + label + '] ' + items.length + ' 个')
  console.log('  ' + items.map((i) => i.code + '(' + i.name + ')').join('、'))
}

// ---------- B. 快讯线按资产类别关键词探测 ----------
const keywords = [
  // 贵金属/金属
  '黄金', '白银', '铜', '铂金',
  // 能源
  '原油', '布伦特', 'WTI', '天然气', '欧佩克',
  // 外汇
  '美元', '欧元', '日元', '英镑', '人民币',
  // 全球指数
  '标普500', '纳斯达克', '道琼斯', '恒生指数', '日经',
  // A股
  'A股', '上证指数', '深证成指', '创业板',
  // 加密（报价表没有，看新闻线有没有）
  '比特币', '以太坊',
  // 宏观/事件
  '美联储', '非农', 'CPI', '关税', '地缘',
]
const results = []
for (const kw of keywords) {
  try {
    const items = await service.searchFlash(kw, 5)
    results.push({ kw, count: items.length, sample: items.slice(0, 2).map((i) => i.title) })
  } catch (error) {
    results.push({ kw, error: String(error?.message ?? error) })
  }
}
console.log('\n==== B. search_flash 关键词命中（cap=5, 150=命中搜索上限）====')
for (const r of results) {
  console.log((r.count === undefined ? 'ERR' : String(r.count).padStart(3)) + ' | ' + r.kw + (r.error ? ' | ' + r.error : ' | ' + (r.sample ?? []).join(' // ')))
}

// ---------- B2. 真实命中量级（limit=150，搜到上限即 150=“≥150”） ----------
const countSet = ['黄金', '白银', '铜', '原油', '天然气', '美元', '欧元', '日元', '标普500', '恒生指数', 'A股', '比特币', '加密', '数字货币', '稳定币', 'ETH', 'BTC']
const counts = []
for (const kw of countSet) {
  try {
    const items = await service.searchFlash(kw, 150)
    counts.push({ kw, count: items.length })
  } catch (error) {
    counts.push({ kw, error: String(error?.message ?? error) })
  }
}
console.log('\n==== B2. search_flash 命中量级（limit=150，含加密类）====')
for (const r of counts) console.log(String(r.count ?? 'ERR').padStart(4) + ' | ' + r.kw)
console.log('  汇总: ' + JSON.stringify(Object.fromEntries(counts.map((r) => [r.kw, r.count ?? r.error]))))

// ---------- C. 最新快讯流（市场综合线） ----------
const page = await service.listFlash({ limit: 5 })
console.log('\n==== C. list_flash 最新 ' + page.items.length + ' 条（hasMore=' + page.hasMore + '）====')
for (const i of page.items) console.log(i.publishedAt + ' | ' + i.title)

// ---------- D. 汇总 ----------
const summary = {
  instrumentCount: instruments.length,
  instrumentGroups: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])),
  keywordHits: Object.fromEntries(results.map((r) => [r.kw, r.count ?? r.error])),
}
console.log('\n==== D. summary JSON ====')
console.log(JSON.stringify(summary, null, 2))
