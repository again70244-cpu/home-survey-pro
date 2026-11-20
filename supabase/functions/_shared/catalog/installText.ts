/**
 * 安裝尺寸文字解析器
 *
 * 原則
 * 1. 只填原文「明確寫出」的數值；沒寫的一律 null，絕不補 0、不推測。
 * 2. 原文完整保留（由呼叫端存 install_text_raw）；無法辨識的行放進 unparsed，不丟棄。
 * 3. 單位統一為 cm：原文沒寫單位時視為 cm（unitAssumed=true）；明確寫 mm／m 時換算。
 * 4. 含義不明確的項目（例如「進排水管長度」）存在獨立欄位，不拆成兩個確定數值。
 *
 * 純函式、無外部相依：Supabase Edge Function（Deno）與前端（瀏覽器）共用。
 */

export const SPEC_FIELDS = [
  'width_cm',
  'height_cm',
  'depth_cm',
  'door_open_90_depth_cm',
  'full_open_depth_cm',
  'full_open_height_cm',
  'door_clearance_cm',
  'power_cable_cm',
  'water_inlet_hose_cm',
  'drain_hose_cm',
  'inlet_drain_hose_cm',
  'package_width_cm',
  'package_height_cm',
  'package_depth_cm',
] as const
export type SpecField = (typeof SPEC_FIELDS)[number]
export type InstallSpecs = Record<SpecField, number | null>

export const SPEC_LABELS: Record<SpecField, string> = {
  width_cm: '寬',
  height_cm: '高',
  depth_cm: '深',
  door_open_90_depth_cm: '門開 90 度總深',
  full_open_depth_cm: '全開總深',
  full_open_height_cm: '全開總高',
  door_clearance_cm: '開門所需空間',
  power_cable_cm: '電源線長度',
  water_inlet_hose_cm: '進水管長度',
  drain_hose_cm: '排水管長度',
  inlet_drain_hose_cm: '進排水管長度（原文未區分進水／排水）',
  package_width_cm: '外箱寬',
  package_height_cm: '外箱高',
  package_depth_cm: '外箱深',
}

export type IssueCode = 'unrecognized' | 'conflict' | 'bad_number' | 'missing_body_dims'
export interface ParseIssue {
  code: IssueCode
  line: string
  message: string
  field?: SpecField
}
export interface ExtraItem {
  field: SpecField
  value_cm: number
  /** 附帶條件，例如「搭S22FHDB」 */
  condition: string
  source: string
}
export type DataQuality = 'complete' | 'missing' | 'invalid' | 'needs_review'

export interface InstallParseResult {
  specs: InstallSpecs
  /** 有附帶條件的數值（同時也會填入對應欄位） */
  conditions: ExtraItem[]
  /** 無法辨識的原文行，完整保留 */
  unparsed: string[]
  issues: ParseIssue[]
  /** 說明性備註（不影響品質分級），例如含義不明確的項目 */
  notes: string[]
  /** 是否有數值因原文未寫單位而依預設 cm 解讀 */
  unitAssumed: boolean
  quality: DataQuality
}

export function emptySpecs(): InstallSpecs {
  return Object.fromEntries(SPEC_FIELDS.map((f) => [f, null])) as InstallSpecs
}

/** 全形轉半形、統一分隔符號 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/\r\n?/g, '\n')
}

const NUM = String.raw`(\d+(?:\.\d+)?)`
const UNIT = String.raw`\s*(cm|mm|m|公分|公釐|毫米|釐米|厘米|米)?`

/** 依單位換算成 cm；回傳 [數值, 是否依預設 cm] */
function toCm(num: string, unit: string | undefined): [number, boolean] | null {
  const v = Number(num)
  if (!Number.isFinite(v) || v < 0) return null
  const u = (unit ?? '').toLowerCase()
  if (u === '' ) return [round(v), true]
  if (u === 'cm' || u === '公分' || u === '釐米' || u === '厘米') return [round(v), false]
  if (u === 'mm' || u === '公釐' || u === '毫米') return [round(v / 10), false]
  if (u === 'm' || u === '米') return [round(v * 100), false]
  return null
}
const round = (v: number) => Math.round(v * 10) / 10

/** 單行規則：關鍵字 → 欄位 */
interface LineRule {
  field: SpecField
  re: RegExp
  /** 是否允許附帶括號條件 */
  condition?: boolean
  note?: string
}
const LINE_RULES: LineRule[] = [
  { field: 'door_open_90_depth_cm', re: new RegExp(String.raw`^門開\s*90\s*度?\s*(?:總深|總深度|深度)\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: 'full_open_depth_cm', re: new RegExp(String.raw`^全開\s*(?:總深|總深度)\s*[:：]?\s*${NUM}${UNIT}\s*(?:\(([^)]*)\))?$`), condition: true },
  { field: 'full_open_height_cm', re: new RegExp(String.raw`^全開\s*(?:總高|總高度)\s*[:：]?\s*${NUM}${UNIT}\s*(?:\(([^)]*)\))?$`), condition: true },
  { field: 'door_clearance_cm', re: new RegExp(String.raw`^開門\s*(?:所需)?\s*空間\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: 'power_cable_cm', re: new RegExp(String.raw`^電源線\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) },
  {
    field: 'inlet_drain_hose_cm',
    re: new RegExp(String.raw`^進排水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`),
    note: '「進排水管長度」原文未區分進水管或排水管，未拆分為兩個數值',
  },
  { field: 'water_inlet_hose_cm', re: new RegExp(String.raw`^進水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) },
  { field: 'drain_hose_cm', re: new RegExp(String.raw`^排水管\s*(?:長度|長)?\s*[:：]?\s*${NUM}${UNIT}$`) },
]

/** 「寬70;高189;深83」形式；prefix 用於外箱尺寸 */
const DIM_KEY: Record<string, 'w' | 'h' | 'd'> = { 寬: 'w', 寬度: 'w', 高: 'h', 高度: 'h', 深: 'd', 深度: 'd' }
function parseDimTriple(text: string): { w?: [number, boolean]; h?: [number, boolean]; d?: [number, boolean] } | null {
  const parts = text.split(/[;,、/*×\s]+/).filter(Boolean)
  if (!parts.length) return null
  const out: { w?: [number, boolean]; h?: [number, boolean]; d?: [number, boolean] } = {}
  for (const p of parts) {
    const m = p.match(new RegExp(String.raw`^(寬度|高度|深度|寬|高|深)\s*[:：]?\s*${NUM}${UNIT}$`))
    if (!m) return null // 整行必須都是尺寸片段，否則交給「無法辨識」
    const k = DIM_KEY[m[1]]
    const v = toCm(m[2], m[3])
    if (!v || out[k]) return null // 重複或不合理
    out[k] = v
  }
  return out
}

export function parseInstallText(raw: string | null | undefined): InstallParseResult {
  const specs = emptySpecs()
  const res: InstallParseResult = { specs, conditions: [], unparsed: [], issues: [], notes: [], unitAssumed: false, quality: 'missing' }
  const text = toHalfWidth(raw ?? '').trim()
  if (!text) return res

  let parsedCount = 0
  const set = (field: SpecField, v: [number, boolean], line: string) => {
    if (v[1]) res.unitAssumed = true
    if (specs[field] !== null && specs[field] !== v[0]) {
      res.issues.push({ code: 'conflict', field, line, message: `${SPEC_LABELS[field]}出現兩個不同數值（${specs[field]}、${v[0]}），需人工確認` })
      specs[field] = null
      return
    }
    specs[field] = v[0]
    parsedCount++
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    const compact = line.replace(/\s+/g, ' ')

    // 外箱尺寸
    const pkg = compact.match(/^外箱\s*(?:尺寸)?\s*[:：]?\s*(.+)$/)
    if (pkg) {
      const t = parseDimTriple(pkg[1])
      if (t && (t.w || t.h || t.d)) {
        if (t.w) set('package_width_cm', t.w, line)
        if (t.h) set('package_height_cm', t.h, line)
        if (t.d) set('package_depth_cm', t.d, line)
        continue
      }
    }

    // 本體寬高深
    const body = parseDimTriple(compact)
    if (body && (body.w || body.h || body.d)) {
      if (body.w) set('width_cm', body.w, line)
      if (body.h) set('height_cm', body.h, line)
      if (body.d) set('depth_cm', body.d, line)
      continue
    }

    // 其他單項
    let hit = false
    for (const rule of LINE_RULES) {
      const m = compact.match(rule.re)
      if (!m) continue
      const v = toCm(m[1], m[2])
      if (!v) {
        res.issues.push({ code: 'bad_number', field: rule.field, line, message: `${SPEC_LABELS[rule.field]}數值無法辨識` })
      } else {
        set(rule.field, v, line)
        if (rule.condition && m[3]?.trim()) {
          res.conditions.push({ field: rule.field, value_cm: v[0], condition: m[3].trim(), source: line })
        }
        if (rule.note && !res.notes.includes(rule.note)) res.notes.push(rule.note)
      }
      hit = true
      break
    }
    if (hit) continue

    res.unparsed.push(line)
    res.issues.push({ code: 'unrecognized', line, message: '無法辨識的內容（原文保留，需人工確認）' })
  }

  const hasBody = specs.width_cm !== null && specs.height_cm !== null && specs.depth_cm !== null
  if (parsedCount === 0) res.quality = 'invalid'
  else {
    if (!hasBody) res.issues.push({ code: 'missing_body_dims', line: '', message: '缺少完整的本體寬、高、深' })
    res.quality = res.issues.length ? 'needs_review' : 'complete'
  }
  if (res.unitAssumed) res.notes.push('原文未標示單位，依預設以 cm 解讀')
  return res
}
