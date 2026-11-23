/** 各模板規則共用的小工具（純函式） */
import type { SurveyArea, SurveyProduct } from '../db/types'
import type { Finding, RiskLevel } from './types'

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

/** 讀取規格快照中的數值（產品知識庫欄位名稱一律以 _cm 結尾；缺少或 ≤ 0 視為沒有資料） */
export function specOf(p: SurveyProduct): Spec {
  const s = p.spec_snapshot as Record<string, unknown>
  return {
    model: p.model_code,
    get: (f) => {
      const v = s?.[`${f}_cm`]
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
    },
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
