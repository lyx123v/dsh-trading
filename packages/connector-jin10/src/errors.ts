import type { TradingErrorCode } from '@dshtrading/api'

/** 本连接器的凭证提示（错误消息里必须给出可执行的配置路径 —— BYOK 铁律）。 */
export const TOKEN_HINT =
  '配置金十 MCP Token：设置中心 dshtrading.credentials.jin10.token，或环境变量 JIN10_MCP_TOKEN。'

/** 错误词汇对齐 @dshtrading/api（本包不做跨包 Error 类基座，与 connector-eastmoney 同款）。 */
export class Jin10Error extends Error {
  readonly code: TradingErrorCode

  constructor(code: TradingErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'Jin10Error'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/**
 * 上游业务错误消息 → 错误码。
 * 限流文案必须单独识别（决定「今天别再试」的语义）；「不支持该品种」= 代码不在
 * quote://codes 名册内（本出口实测文案，2026-09-13），映射到 UNSUPPORTED_SYMBOL
 * 让工具层语义与市场工具族一致。
 */
export function codeForUpstreamMessage(message: string): TradingErrorCode {
  if (/上限|限流|频率|rate.?limit|too many/i.test(message)) return 'TRADING_RATE_LIMITED'
  if (/不支持该品种|unsupported (instrument|code|symbol)/i.test(message)) return 'TRADING_UNSUPPORTED_SYMBOL'
  return 'TRADING_EXCHANGE_ERROR'
}
