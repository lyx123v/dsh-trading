/**
 * 金十地区词汇（2026-09-15，宏观/利率数据面的地区归属推断）。
 *
 * 两条推断路径（spikes/impl-jin10-macro-rates/EVIDENCE.md）：
 * - 日历条目：MCP list_calendar 无 country 字段，但标题一律以地区名开头
 *   （「日本8月外汇储备(亿美元)」），按前缀匹配；
 * - 央行利率：flagImgUrl 文件名即地区名（`…/flag/美国.png`）。
 * 词汇表是封闭小集合（实测 indicator_list 字典全集 33 个地区值的核心母集）；
 * 长名在前防止「印度尼西亚」被短前缀「印度」截胡。未命中返回空串（= 仅
 * 「全部」视图可见），绝不猜。
 */

/** 地区词汇（顺序即匹配优先级：长名在前）。 */
export const JIN10_REGIONS = [
  '美国', '中国', '日本', '欧元区', '德国', '法国', '英国', '中国香港', '中国台湾',
  '韩国', '新加坡', '澳大利亚', '加拿大', '瑞士', '印度尼西亚', '印度', '俄罗斯',
  '巴西', '墨西哥', '南非', '新西兰', '土耳其', '瑞典', '挪威', '丹麦', '波兰',
  '匈牙利', '捷克', '乌克兰', '以色列', '菲律宾', '泰国', '马来西亚', '越南',
  '沙特', '智利', '哥伦比亚', '尼日利亚', '罗马尼亚', '全球', 'OECD',
] as const

export type Jin10Region = (typeof JIN10_REGIONS)[number]

/** 日历标题 → 地区（前缀命中；未命中 = 空串）。 */
export function regionOfTitle(title: string): string {
  for (const region of JIN10_REGIONS) {
    if (title.startsWith(region)) return region
  }
  return ''
}

/** 利率 flagImgUrl → 地区（取文件名去扩展名；空串 = 无法识别）。 */
export function regionOfFlagUrl(flagUrl: string): string {
  const name = flagUrl.trim().split('/').pop() ?? ''
  return name.replace(/\.[a-zA-Z]+$/, '')
}
