/**
 * 安裝尺寸文字解析器
 *
 * 原則
 * 1. 只填原文「明確寫出」的數值；沒寫的一律 null，絕不補 0、不推測。
 * 2. 原文完整保留（由呼叫端存 install_text_raw）；無法辨識的行放進 unparsed，不丟棄。
 * 3. 單位統一為 cm：原文沒寫單位時視為 cm（unitAssumed=true）；明確寫 mm／m 時換算。
 * 4. 含義不明確的項目（例如「進排水管長度」）存在獨立欄位，不拆成兩個確定數值。
 * 5. 一行要「整行」都看得懂才採用；只要有一段看不懂，整行列為無法辨識（避免只取一半造成誤解）。
 * 6. 數值後的括號（例如「(含底座)」「(搭S22FHDB)」「(插頭+總線長)」）保留為附註。
 *
 * 純函式、無外部相依：Supabase Edge Function（Deno）與前端（瀏覽器）共用。
 */

export const SPEC_FIELDS = [
  'width_cm',
  'height_cm',
  'depth_cm',
  'door_open_90_depth_cm',
  'door_open_90_width_cm',
  'door_removed_depth_cm',
  'full_open_depth_cm',
  'drawer_open_depth_cm',
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
  door_open_90_width_cm: '門開 90 度總寬',
  door_removed_depth_cm: '拆門總深',
  full_open_depth_cm: '全開總深',
  drawer_open_depth_cm: '抽屜全開總深',
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
  /** 括號附註，例如「搭S22FHDB」「含底座」「插頭+總線長」 */
  condition: string
  source: string
}
export type DataQuality = 'complete' | 'missing' | 'invalid' | 'needs_review'

export interface InstallParseResult {
  specs: InstallSpecs
  /** 有括號附註的數值（同時也會填入對應欄位） */
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

const round = (v: number) => Math.round(v * 10) / 10
/** 依單位換算成 cm；回傳 [數值, 是否依預設 cm] */
function toCm(num: string, unit: string | undefined): [number, boolean] | null {
  const v = Number(num)
  if (!Number.isFinite(v) || v < 0) return null
  const u = (unit ?? '').toLowerCase()
  if (u === '') return [round(v), true]
  if (u === 'cm' || u === '公分' || u === '釐米' || u === '厘米') return [round(v), false]
  if (u === 'mm' || u === '公釐' || u === '毫米') return [round(v / 10), false]
  if (u === 'm' || u === '米') return [round(v * 100), false]
  return null
}

/**
 * 標籤 → 欄位。依序比對（較長、較具體的放前面）。
 * ctx：這個標籤會設定的行內情境，例如「門開90度」之後的「總寬」= 門開 90 度總寬。
 * needsCtx：只有在指定情境下才有意義的標籤（單獨出現的「總寬」含義不明 → 不採用）。
 */
interface Label {
  re: RegExp
  field: SpecField | ((ctx: string | null) => SpecField | null)
  ctx?: string
  note?: string
}
const LABELS: Label[] = [
  { re: /門開\s*90\s*度?\s*(?:總深度|總深|深度)/y, field: 'door_open_90_depth_cm', ctx: 'door90' },
  { re: /門開\s*90\s*度?\s*(?:總寬度|總寬|寬度)/y, field: 'door_open_90_width_cm', ctx: 'door90' },
  { re: /拆門\s*(?:後)?\s*(?:總深度|總深|深度|深)/y, field: 'door_removed_depth_cm' },
  { re: /抽屜\s*全開\s*(?:總深度|總深)/y, field: 'drawer_open_depth_cm' },
  { re: /全開\s*(?:總深度|總深)/y, field: 'full_open_depth_cm' },
  { re: /全開\s*(?:總高度|總高)/y, field: 'full_open_height_cm' },
  { re: /開門\s*(?:所需)?\s*空間/y, field: 'door_clearance_cm' },
  { re: /電源線\s*(?:長度|長)?/y, field: 'power_cable_cm' },
  { re: /進排水管\s*(?:長度|長)?/y, field: 'inlet_drain_hose_cm', note: '「進排水管長度」原文未區分進水管或排水管，未拆分為兩個數值' },
  { re: /進水管\s*(?:長度|長)?/y, field: 'water_inlet_hose_cm' },
  { re: /排水管\s*(?:長度|長)?/y, field: 'drain_hose_cm' },
  // 只在「門開90度」之後才有明確意義
  { re: /(?:總寬度|總寬)/y, field: (ctx) => (ctx === 'door90' ? 'door_open_90_width_cm' : null) },
  { re: /(?:總深度|總深)/y, field: (ctx) => (ctx === 'door90' ? 'door_open_90_depth_cm' : null) },
]
const DIM_LABELS: Record<string, 'w' | 'h' | 'd'> = { 寬度: 'w', 寬: 'w', 高度: 'h', 高: 'h', 深度: 'd', 深: 'd' }
const VALUE = /\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|公分|公釐|毫米|釐米|厘米|米)?\s*(?:\(([^()]*)\))?/y
const SEP = /[\s;,、/*×]+/y

interface Token {
  field: SpecField
  value: [number, boolean]
  qualifier: string | null
  note?: string
}

/** 把一行切成「標籤 + 數值 (+ 括號附註)」；整行都能辨識才回傳，否則 null */
function tokenizeLine(line: string, dimFields: { w: SpecField; h: SpecField; d: SpecField } | null): Token[] | null {
  const out: Token[] = []
  let pos = 0
  let ctx: string | null = null
  const at = (re: RegExp) => {
    re.lastIndex = pos
    const m = re.exec(line)
    if (m) pos = re.lastIndex
    return m
  }
  while (pos < line.length) {
    if (at(SEP)) continue
    let field: SpecField | null = null
    let note: string | undefined
    if (dimFields) {
      const m = at(/(寬度|高度|深度|寬|高|深)/y)
      if (m) field = dimFields[DIM_LABELS[m[1]]]
    } else {
      for (const l of LABELS) {
        if (!at(l.re)) continue
        field = typeof l.field === 'function' ? l.field(ctx) : l.field
        if (l.ctx) ctx = l.ctx
        note = l.note
        break
      }
    }
    if (!field) return null
    const v = at(VALUE)
    if (!v) return null
    const value = toCm(v[1], v[2])
    if (!value) return null
    out.push({ field, value, qualifier: v[3]?.trim() || null, note })
  }
  return out.length ? out : null
}

const BODY = { w: 'width_cm', h: 'height_cm', d: 'depth_cm' } as const
const PACKAGE = { w: 'package_width_cm', h: 'package_height_cm', d: 'package_depth_cm' } as const

export function parseInstallText(raw: string | null | undefined): InstallParseResult {
  const specs = emptySpecs()
  const res: InstallParseResult = { specs, conditions: [], unparsed: [], issues: [], notes: [], unitAssumed: false, quality: 'missing' }
  const text = toHalfWidth(raw ?? '').trim()
  if (!text) return res

  let parsedCount = 0
  const set = (t: Token, line: string) => {
    const { field, value } = t
    if (value[1]) res.unitAssumed = true
    if (specs[field] !== null && specs[field] !== value[0]) {
      res.issues.push({ code: 'conflict', field, line, message: `${SPEC_LABELS[field]}出現兩個不同數值（${specs[field]}、${value[0]}），需人工確認` })
      specs[field] = null
      return
    }
    specs[field] = value[0]
    parsedCount++
    if (t.qualifier) res.conditions.push({ field, value_cm: value[0], condition: t.qualifier, source: line })
    if (t.note && !res.notes.includes(t.note)) res.notes.push(t.note)
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const compact = line.replace(/\s+/g, ' ')
    const pkg = compact.match(/^外箱\s*(?:尺寸)?\s*[:：]?\s*(.+)$/)
    const tokens = pkg ? tokenizeLine(pkg[1], PACKAGE) : tokenizeLine(compact, BODY) ?? tokenizeLine(compact, null)
    if (tokens) {
      tokens.forEach((t) => set(t, line))
      continue
    }
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
