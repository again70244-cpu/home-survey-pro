/** 防呆規則引擎共用型別（純資料，與畫面無關，可單元測試） */

/** 風險等級：高風險 > 必須人工確認 > 注意事項 > 一般提醒 */
export type RiskLevel = 'high' | 'confirm' | 'caution' | 'info'

export const RISK_LABEL: Record<RiskLevel, string> = {
  high: '高風險',
  confirm: '必須人工確認',
  caution: '注意事項',
  info: '一般提醒',
}
export const RISK_ORDER: RiskLevel[] = ['high', 'confirm', 'caution', 'info']

export interface Finding {
  /** 穩定 ID（規則 + 對象），用來排序與比較 */
  id: string
  level: RiskLevel
  /** 發現什麼問題 */
  title: string
  /** 為什麼需要注意 */
  why: string
  /** 依據哪個產品規格或場勘規則（含數值與規則版本） */
  basis: string
  /** 建議補充什麼資料／如何處理 */
  suggestion: string
  /** 相關對象（畫面可用來捲動到對應位置） */
  areaId?: string
  field?: string
  model?: string
}

export interface CheckResult {
  rulesId: string
  rulesVersion: number
  findings: Finding[]
  /** 完成度：必要項目中已填寫／已拍攝的比例 */
  score: { done: number; total: number; percent: number }
  counts: Record<RiskLevel, number>
}

export function sortFindings(f: Finding[]): Finding[] {
  return [...f].sort((a, b) => RISK_ORDER.indexOf(a.level) - RISK_ORDER.indexOf(b.level))
}
export function countLevels(f: Finding[]): Record<RiskLevel, number> {
  const c = { high: 0, confirm: 0, caution: 0, info: 0 }
  for (const x of f) c[x.level]++
  return c
}
