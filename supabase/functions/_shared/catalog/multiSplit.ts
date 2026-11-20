/**
 * 「一對多報價」解析：只取型號搭配規則與必要備註，價格一律去除
 *
 * 室外機欄：「一對二;一對三室外機LM3U90(8.8KW)」
 * 室內機欄：「LSN22DDHST極淨2.2KW $11900」（$ 之後為價格，不保留）
 * 備註欄：  「一對二搭配室內機2.2~7.2(相加總合不得超過11.3;相加總合不得低於8.7);一對三…」
 */
import { toHalfWidth } from './installText.ts'
import { cleanText, normalizeModelCode, stripPrices } from './normalize.ts'

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const cnToNum = (s: string) => CN_NUM[s] ?? (Number(s) || null)

export interface IndoorUnit {
  model_code: string
  series: string | null
  capacity_kw: number | null
  position: number
  /** 原文（已去除價格） */
  source_text: string
}
export interface CapacityRule {
  /** 適用的搭配方式（室內機台數）；null = 適用全部 */
  indoor_count: number | null
  unit_min_kw: number | null
  unit_max_kw: number | null
  total_max_kw: number | null
  total_min_kw: number | null
  source_text: string
}
export interface MultiSplitSystem {
  model_code: string
  outdoor_text: string
  capacity_kw: number | null
  /** 可搭配的室內機台數，例如 [2, 3] 代表一對二、一對三 */
  indoor_counts: number[]
  indoor_units: IndoorUnit[]
  notes: string | null
  rules: CapacityRule[]
  issues: string[]
}

function parseIndoor(raw: string, position: number): IndoorUnit | null {
  const { text } = stripPrices(toHalfWidth(raw))
  const t = text.trim()
  if (!t) return null
  const m = t.match(/^([A-Z0-9-]{4,})\s*(.*)$/i)
  if (!m) return null
  const rest = m[2]
  const cap = rest.match(/(\d+(?:\.\d+)?)\s*KW/i)
  const series = rest.replace(/(\d+(?:\.\d+)?)\s*KW/i, '').trim() || null
  return { model_code: normalizeModelCode(m[1]), series, capacity_kw: cap ? Number(cap[1]) : null, position, source_text: t }
}

export function parseCapacityRules(notes: string): CapacityRule[] {
  const rules: CapacityRule[] = []
  const re = /(?:一對([一二三四五六七八九\d]))?\s*搭配室內機\s*(\d+(?:\.\d+)?)\s*[~～-]\s*(\d+(?:\.\d+)?)\s*(?:KW)?\s*\(([^)]*)\)/gi
  for (const m of toHalfWidth(notes).matchAll(re)) {
    const inner = m[4]
    const max = inner.match(/不得超過\s*(\d+(?:\.\d+)?)/)
    const min = inner.match(/不得低於\s*(\d+(?:\.\d+)?)/)
    rules.push({
      indoor_count: m[1] ? cnToNum(m[1]) : null,
      unit_min_kw: Number(m[2]),
      unit_max_kw: Number(m[3]),
      total_max_kw: max ? Number(max[1]) : null,
      total_min_kw: min ? Number(min[1]) : null,
      source_text: m[0].trim(),
    })
  }
  return rules
}

export function parseMultiSplitRow(values: Record<string, string | null | undefined>): MultiSplitSystem | null {
  const outdoorRaw = toHalfWidth(values['室外機型號'] ?? '').trim()
  if (!outdoorRaw) return null
  const issues: string[] = []
  // 型號：含英文與數字、長度 ≥ 4 的片段（排除容量「5.2KW」）
  const model = outdoorRaw.replace(/\([^)]*\)/g, ' ').match(/[A-Z][A-Z0-9-]*\d[A-Z0-9-]*/i)
  if (!model) return null
  const cap = outdoorRaw.match(/\(\s*(\d+(?:\.\d+)?)\s*KW\s*\)/i)
  const counts = [...outdoorRaw.matchAll(/一對([一二三四五六七八九\d])/g)].map((m) => cnToNum(m[1])).filter((n): n is number => !!n)
  if (!counts.length) issues.push('室外機欄未標示搭配方式（一對幾）')

  const indoor: IndoorUnit[] = []
  for (let i = 1; i <= 12; i++) {
    const cell = values[`室內機${i}`]
    if (!cell) continue
    const u = parseIndoor(cell, i)
    if (u) indoor.push(u)
    else issues.push(`室內機${i}「${stripPrices(cell).text}」無法辨識型號`)
  }

  const notesRaw = cleanText(values['備註'])
  const notes = notesRaw ? stripPrices(notesRaw).text : null
  const rules = notes ? parseCapacityRules(notes) : []
  if (notes && !rules.length) issues.push('備註中的容量規則無法解析（原文保留）')

  return {
    model_code: normalizeModelCode(model[0]),
    outdoor_text: stripPrices(outdoorRaw).text,
    capacity_kw: cap ? Number(cap[1]) : null,
    indoor_counts: [...new Set(counts)].sort(),
    indoor_units: indoor,
    notes,
    rules,
    issues,
  }
}
