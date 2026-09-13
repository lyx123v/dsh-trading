/**
 * cn_get_news 个股新闻改动效果验证（真实网络，跑构建产物 packages/kit-cn/lib/news.js）。
 * 对比：旧行为 sources=['eastmoney']（全市场快讯 + symbol 过滤） vs 新默认（加 eastmoney-symbol-news）。
 * 用法：node spikes/impl-cn-symbol-news/live-check.mjs
 */
import { aggregateNews } from '../../packages/kit-cn/lib/news.js'

const symbols = ['600519', '002594', '300750', '600036', '000858', '601398', '002714', '300059']
const rows = []
for (const symbol of symbols) {
  const oldWay = await aggregateNews({ symbol, sources: ['eastmoney'] })
  const newWay = await aggregateNews({ symbol })
  const symNews = newWay.items.filter((i) => i.source === 'eastmoney-symbol-news')
  const ann = newWay.items.filter((i) => i.source.includes('announcement'))
  rows.push({ symbol, oldOnly: oldWay.items.length, newTotal: newWay.items.length, symbolNews: symNews.length, announcements: ann.length, unavailable: newWay.unavailable })
  console.log('')
  console.log('=== ' + symbol + ': old(market-wide only)=' + oldWay.items.length + ' | new(default)=' + newWay.items.length + ' (symbolNews ' + symNews.length + ', announcements ' + ann.length + ')')
  for (const i of newWay.items.slice(0, 5)) console.log('   [' + i.source + '] ' + i.publishedAt.slice(0, 10) + ' ' + i.title.slice(0, 64))
}
console.log('')
console.log('=== summary ===')
console.log(JSON.stringify(rows, null, 2))
