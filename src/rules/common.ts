/** 各模板規則共用的小工具（純函式） */
import type { SurveyArea, SurveyProduct } from '../db/types'
import type { Finding, RiskLevel } from './types'
import { SPEC_LABELS } from '../../supabase/functions/_shared/catalog/installText.ts'
import { isWasherCategory } from '../templates/washer'
import { isFridgeCategory } from '../templates/fridge'

export type TemplateValues = Record<string, string | number | null | undefined>

/** 每個模板規則的輸入 */
export interface RuleInput {
  values: TemplateValues
  /** 使用者指定的安裝位置區域；null = 自動判斷 */
  installAreaId: string | null
  areas: SurveyArea[]
  products: SurveyProduct[]
  /** 已有照片的拍攝項目 key */
  shotsTaken: Set<string>
}

export type Spec = { model: string; get: (f: string) => number | null }

const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** 規格值：手動修正優先，否則用規格快照（欄位名稱如 width_cm；缺少或 ≤ 0 視為沒有資料） */
export function specValueOf(p: SurveyProduct, field: string): { value: number | null; manual: boolean; original: number | null } {
  const original = positive((p.spec_snapshot as Record<string, unknown>)?.[field])
  const o = positive(p.spec_overrides?.fields?.[field])
  return o !== null ? { value: o, manual: true, original } : { value: original, manual: false, original }
}

/** 讀取產品規格（f 不含 _cm，例如 'width'） */
export function specOf(p: SurveyProduct): Spec {
  return { model: p.model_code, get: (f) => specValueOf(p, `${f}_cm`).value }
}

/** 依分類自動判斷的模板 */
export function autoTemplate(category: string | null | undefined): string | null {
  if (isWasherCategory(category)) return 'washer'
  if (isFridgeCategory(category)) return 'fridge'
  return null
}

/** 產品實際套用的模板：手動指定優先（'none' = 不檢查），否則依分類 */
export function productTemplate(p: SurveyProduct): string | null {
  if (p.template_type === 'none') return null
  return p.template_type || autoTemplate(productCategory(p))
}

/** 有手動修正規格的產品：列為一般提醒，讓報告讀者知道哪些數值不是來自產品知識庫 */
export function manualSpecFindings(add: AddFinding, products: SurveyProduct[], RV: string) {
  for (const p of products) {
    const fields = Object.keys(p.spec_overrides?.fields ?? {}).filter((f) => specValueOf(p, f).manual)
    if (!fields.length) continue
    const list = fields.map((f) => {
      const x = specValueOf(p, f)
      return `${(SPEC_LABELS as Record<string, string>)[f] ?? f} ${fmt(x.value!)}${x.original !== null ? `（原 ${fmt(x.original)}）` : ''}`
    })
    add('info', `manual:${p.model_code}`, `${p.model_code} 部分規格為手動修正`, `檢查使用手動輸入的數值：${list.join('、')}`, `來源：${p.spec_overrides?.note || '未註明'}；${RV}`, '確認數值正確；永久修正請更新產品試算表', { model: p.model_code })
  }
}

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
export const fmt = (n: number) => `${Math.round(n * 10) / 10} cm`

export function productCategory(p: SurveyProduct): string | null {
  return p.category ?? ((p.spec_snapshot?.category as string | null | undefined) ?? null)
}

export type AddFinding = (level: RiskLevel, id: string, title: string, why: string, basis: string, suggestion: string, extra?: Partial<Finding>) => void

/** 區域尺寸與距離欄位的單位防呆（毫米、公尺誤植） */
export function unitChecks(add: AddFinding, areas: SurveyArea[], values: TemplateValues, distKeys: string[], label: (k: string) => string, RV: string) {
  for (const a of areas.filter((x) => !x.deleted_at)) {
    for (const [k, l] of [['width_cm', '寬'], ['depth_cm', '深'], ['height_cm', '高']] as const) {
      const n = a[k]
      if (n === null) continue
      if (n > 600) add('caution', `unit:${a.id}:${k}`, `${a.name} ${l} ${fmt(n)} 數值異常偏大`, '可能誤以毫米輸入（例如 650 mm 輸入成 650 cm）', `${RV}：區域尺寸超過 600 cm 視為異常`, '確認單位是否為公分', { areaId: a.id, field: k })
      else if (n < 20) add('caution', `unit:${a.id}:${k}`, `${a.name} ${l} ${fmt(n)} 數值異常偏小`, '可能誤以公尺輸入（例如 0.7 m 輸入成 0.7）', `${RV}：區域尺寸小於 20 cm 視為異常`, '確認單位是否為公分', { areaId: a.id, field: k })
    }
  }
  for (const f of distKeys) {
    const n = num(values[f])
    if (n !== null && n > 1000) add('caution', `unit:${f}`, `${label(f)} ${fmt(n)} 數值異常偏大`, '可能誤以毫米輸入', `${RV}：距離超過 1000 cm 視為異常`, '確認單位是否為公分', { field: f })
  }
}
