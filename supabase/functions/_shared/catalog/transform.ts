/**
 * 試算表列 → 產品知識庫紀錄
 *
 * 欄位白名單：只有下列欄位會被讀取。價格、促銷、LINE、業績等欄位即使被送進來也會被拒絕。
 */
import { parseInstallText, SPEC_FIELDS, type InstallParseResult, type InstallSpecs, type DataQuality } from './installText.ts'
import { cleanText, displayNameFrom, extractUrls, splitModelCell, stripPrices } from './normalize.ts'
import { parseMultiSplitRow, type MultiSplitSystem } from './multiSplit.ts'

export const PRODUCT_SHEET = '報價'
export const MULTI_SPLIT_SHEET = '一對多報價'

/** 報價工作表：允許同步的欄位（不含產品原價、周年慶低售、促銷/備註） */
export const PRODUCT_COLUMNS = ['產品型號', '分類', '圖片網址', '圖片網址2', '圖片網址3', '圖片網址4', '安裝尺寸', '連結', '影片網址', '保養說明'] as const
/** 一對多報價工作表：允許同步的欄位（不含室外機原價、室外機低售） */
export const MULTI_SPLIT_COLUMNS = ['室外機型號', '室內機1', '室內機2', '室內機3', '室內機4', '室內機5', '室內機6', '室內機7', '備註'] as const

/** 明確禁止的欄位（出現即拒絕整個請求，防止來源端程式被改壞時誤傳） */
export const FORBIDDEN_COLUMN_PATTERNS = [/價/, /低售/, /促銷/, /LINE/i, /user\s*id/i, /業績/, /目標/, /姓名/, /累積/]

export interface SheetRow {
  row: number
  values: Record<string, string | null>
}

export interface ProductRecord {
  source_key: string
  model_code: string
  model_raw: string
  description: string | null
  display_name: string | null
  category_raw: string | null
  category: string | null
  image_urls: string[]
  link_urls: string[]
  video_urls: string[]
  maintenance_notes: string | null
  install_text_raw: string | null
  specs: InstallSpecs
  install_extra: { conditions: InstallParseResult['conditions']; unparsed: string[]; notes: string[]; unit_assumed: boolean }
  parse_issues: { code: string; message: string; line?: string; field?: string }[]
  data_quality: DataQuality
  source_row: number
  content_hash: string
  spec_hash: string
}

export interface SystemRecord extends MultiSplitSystem {
  source_key: string
  source_row: number
  content_hash: string
}

export interface TransformResult {
  products: ProductRecord[]
  systems: SystemRecord[]
  warnings: string[]
  /** 被忽略的列（空白列、標題列、不像型號） */
  skippedRows: number[]
}

export class ForbiddenColumnError extends Error {}

export function assertAllowedColumns(sheet: string, columns: string[]) {
  const allowed: readonly string[] = sheet === PRODUCT_SHEET ? PRODUCT_COLUMNS : MULTI_SPLIT_COLUMNS
  for (const c of columns) {
    if (!allowed.includes(c)) throw new ForbiddenColumnError(`「${sheet}」含有不允許同步的欄位「${c}」，已拒絕整個請求`)
    if (FORBIDDEN_COLUMN_PATTERNS.some((re) => re.test(c)) && c !== '備註') throw new ForbiddenColumnError(`欄位「${c}」屬於禁止同步的資料`)
  }
}

// --- 雜湊（Web Crypto：Deno 與瀏覽器、Node 18+ 皆可用） ---
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}
export async function sha256(v: unknown): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof v === 'string' ? v : canonical(v)))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function transformProducts(rows: SheetRow[]): Promise<{ products: ProductRecord[]; warnings: string[]; skippedRows: number[] }> {
  const products: ProductRecord[] = []
  const warnings: string[] = []
  const skippedRows: number[] = []
  const seen = new Map<string, ProductRecord>()

  for (const r of rows) {
    assertAllowedColumns(PRODUCT_SHEET, Object.keys(r.values))
    const v = r.values
    const cell = splitModelCell(v['產品型號'])
    if (!cell) {
      if (Object.values(v).some((x) => (x ?? '').trim())) skippedRows.push(r.row)
      continue
    }
    const install = parseInstallText(v['安裝尺寸'])
    const description = cleanText(cell.description)
    // 描述中萬一出現金額，一律去除
    const desc = description ? stripPrices(description).text || null : null
    const rec: ProductRecord = {
      source_key: `${PRODUCT_SHEET}:${cell.modelCode}`,
      model_code: cell.modelCode,
      model_raw: stripPrices((v['產品型號'] ?? '').trim()).text, // 原文中萬一含金額也去除
      description: desc,
      display_name: desc ? displayNameFrom(desc) || null : null,
      category_raw: v['分類'] ?? null,
      category: cleanText(v['分類']),
      image_urls: extractUrls(v['圖片網址'], v['圖片網址2'], v['圖片網址3'], v['圖片網址4']),
      link_urls: extractUrls(v['連結']),
      video_urls: extractUrls(v['影片網址']),
      maintenance_notes: (() => { const m = cleanText(v['保養說明']); return m ? stripPrices(m).text || null : null })(),
      install_text_raw: cleanText(v['安裝尺寸']),
      specs: install.specs,
      install_extra: { conditions: install.conditions, unparsed: install.unparsed, notes: install.notes, unit_assumed: install.unitAssumed },
      parse_issues: install.issues.map((i) => ({ code: i.code, message: i.message, line: i.line || undefined, field: i.field })),
      data_quality: install.quality,
      source_row: r.row,
      content_hash: '',
      spec_hash: '',
    }
    const dup = seen.get(rec.source_key)
    if (dup) {
      // 同一型號重複出現：保留第一筆，標記待人工確認
      warnings.push(`型號 ${rec.model_code} 重複出現（第 ${dup.source_row} 列與第 ${r.row} 列），保留第 ${dup.source_row} 列`)
      dup.data_quality = 'needs_review'
      if (!dup.parse_issues.some((i) => i.code === 'duplicate'))
        dup.parse_issues.push({ code: 'duplicate', message: `試算表中有重複型號（第 ${r.row} 列），需人工確認` })
      continue
    }
    seen.set(rec.source_key, rec)
    products.push(rec)
  }

  for (const p of products) {
    // 只用「有值」的規格欄位計算雜湊：日後新增欄位時，沒有用到新欄位的產品不會被誤判為規格變更
    const filled = Object.fromEntries(Object.entries(p.specs).filter(([, v]) => v !== null))
    p.spec_hash = await sha256({ specs: filled, extra: p.install_extra, raw: p.install_text_raw })
    const { content_hash: _c, spec_hash: _s, source_row: _r, specs: _sp, ...rest } = p
    p.content_hash = await sha256({ ...rest, specs: filled })
  }
  return { products, warnings, skippedRows }
}

export async function transformSystems(rows: SheetRow[]): Promise<{ systems: SystemRecord[]; warnings: string[] }> {
  const systems: SystemRecord[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    assertAllowedColumns(MULTI_SPLIT_SHEET, Object.keys(r.values))
    const s = parseMultiSplitRow(r.values)
    if (!s) continue
    const key = `${MULTI_SPLIT_SHEET}:${s.model_code}`
    if (seen.has(key)) {
      warnings.push(`室外機 ${s.model_code} 重複出現（第 ${r.row} 列已略過）`)
      continue
    }
    seen.add(key)
    for (const i of s.issues) warnings.push(`室外機 ${s.model_code}：${i}`)
    systems.push({ ...s, source_key: key, source_row: r.row, content_hash: await sha256(s) })
  }
  return { systems, warnings }
}

export async function transformSnapshot(input: { products: SheetRow[]; multiSplit: SheetRow[] }): Promise<TransformResult> {
  const p = await transformProducts(input.products)
  const s = await transformSystems(input.multiSplit)
  return { products: p.products, systems: s.systems, warnings: [...p.warnings, ...s.warnings], skippedRows: p.skippedRows }
}

export { SPEC_FIELDS }
