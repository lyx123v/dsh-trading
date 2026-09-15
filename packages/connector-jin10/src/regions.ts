/**
 * 金十地区词汇（2026-09-15，宏观/利率数据面的地区归属推断）。
 *
 * 两条推断路径（spikes/impl-jin10-macro-rates/EVIDENCE.md）：
 * - 日历条目：MCP list_calendar 无 country 字段，但标题一律以地区名开头
 *   （「日本8月外汇储备(亿美元)」），按前缀匹配；
 * - 央行利率：flagImgUrl 文件名即地区名（`…/flag/美国.png`）。
 * 词汇表是封闭小集合（实测 indicator_list 字典 33 个 country 取值的母集）；
 * 匹配一律按**长度降序**（「中国香港」「中国台湾」「印度尼西亚」不会被
 * 「中国」「印度」截胡——手写顺序不算数，见 2026-09-15 评审 M4）。未命中
 * 返回空串（= 仅「全部」视图可见），绝不猜。
 */

/** 地区词汇（封闭集合；匹配顺序由长度降序推导，与书写顺序无关）。 */
export const JIN10_REGIONS = [
  '美国', '中国', '日本', '欧元区', '德国', '法国', '英国', '中国香港', '中国台湾',
  '韩国', '新加坡', '澳大利亚', '加拿大', '瑞士', '印度尼西亚', '印度', '意大利',
  '西班牙', '印尼', '俄罗斯', '巴西', '墨西哥', '南非', '新西兰', '土耳其', '瑞典',
  '挪威', '丹麦', '波兰', '匈牙利', '捷克', '乌克兰', '以色列', '菲律宾', '泰国',
  '马来西亚', '越南', '沙特', '智利', '哥伦比亚', '尼日利亚', '罗马尼亚', '全球', 'OECD',
] as const

export type Jin10Region = (typeof JIN10_REGIONS)[number]

/** 上游同义写法 → 规范地区名（两条推断路径共用，同一国家只有一个标签）。 */
const REGION_ALIASES: Readonly<Record<string, string>> = { '印尼': '印度尼西亚' }

/** 匹配顺序：长名在前（前缀匹配的唯一要求；书写顺序不参与语义）。 */
const MATCH_ORDER: readonly string[] = [...JIN10_REGIONS].sort((a, b) => b.length - a.length)

function canonical(region: string): string {
  return REGION_ALIASES[region] ?? region
}

/** 日历标题 → 地区（前缀命中；未命中 = 空串）。 */
export function regionOfTitle(title: string): string {
  for (const region of MATCH_ORDER) {
    if (title.startsWith(region)) return canonical(region)
  }
  return ''
}

/** 利率 flagImgUrl → 地区（取文件名去扩展名，别名归一；空串 = 无法识别）。 */
export function regionOfFlagUrl(flagUrl: string): string {
  const name = flagUrl.trim().split('/').pop() ?? ''
  const base = name.replace(/\.[a-zA-Z]+$/, '')
  return base.length > 0 ? canonical(base) : ''
}
