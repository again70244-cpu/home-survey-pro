/** 場勘模板登錄表：新增模板只需在這裡加一筆，畫面、報告、同步、備份都會自動支援 */
import type { SurveyArea, SurveyProduct } from '../db/types'
import type { CheckResult } from '../rules/types'
import type { RuleInput, TemplateValues } from '../rules/common'
import { productTemplate } from '../rules/common'
import { checkWasher, pickInstallArea } from '../rules/washer'
import { checkFridge, pickFridgeArea } from '../rules/fridge'
import { WASHER_SECTIONS, WASHER_SHOTS, WASHER_TEMPLATE_ID, WASHER_TEMPLATE_VERSION, isWasherCategory, type ShotItem, type TemplateSection } from './washer'
import { FRIDGE_SECTIONS, FRIDGE_SHOTS, FRIDGE_TEMPLATE_ID, FRIDGE_TEMPLATE_VERSION, isFridgeCategory } from './fridge'

export interface TemplateDef {
  id: string
  version: number
  /** 區塊標題（也是畫面上的 region 名稱） */
  title: string
  enableLabel: string
  noProductHint: string
  /** 結果下方的說明（預留標準等） */
  note: string
  sections: TemplateSection[]
  shots: ShotItem[]
  /** 欄位顯示條件（不符合時隱藏，也不算必填） */
  showIf: Record<string, (v: TemplateValues) => boolean>
  isCategory: (category: string | null | undefined) => boolean
  pickArea: (areas: SurveyArea[], installAreaId: string | null) => SurveyArea | null
  check: (input: RuleInput) => CheckResult
  /** 找不到安裝位置時，提供一鍵新增的區域名稱 */
  installAreaName?: string
  /** 拍攝項目要存到哪個區域 */
  shotArea: (shot: ShotItem, areas: SurveyArea[], install: SurveyArea | null) => SurveyArea | null
}

const firstRouteArea = (areas: SurveyArea[], install: SurveyArea | null) => areas.find((a) => a.id !== install?.id && a.kind === 'other') ?? install
const elevatorOrStairs = (areas: SurveyArea[], install: SurveyArea | null) => areas.find((a) => a.kind === 'elevator') ?? areas.find((a) => a.kind === 'stairs') ?? install

export const WASHER: TemplateDef = {
  id: WASHER_TEMPLATE_ID,
  version: WASHER_TEMPLATE_VERSION,
  title: '洗衣機現場檢查',
  enableLabel: '啟用洗衣機／洗衣塔現場檢查',
  noProductHint: '尚未選擇洗衣機產品，選擇後會自動比對規格。',
  note: `規則版本 washer v1・預留標準：左右各 2 cm、後方 10 cm`,
  sections: WASHER_SECTIONS,
  shots: WASHER_SHOTS,
  showIf: {
    faucet_distance_cm: (v) => v.faucet === 'yes',
    drain_distance_cm: (v) => v.drain_type === 'floor' || v.drain_type === 'wall',
    outlet_distance_cm: (v) => v.outlet === 'yes',
    outlet_grounded: (v) => v.outlet === 'yes',
    dedicated_circuit: (v) => v.outlet === 'yes',
  },
  isCategory: isWasherCategory,
  pickArea: pickInstallArea,
  check: checkWasher,
  shotArea: (s, areas, install) => (s.key === 'elevator_stairs' ? elevatorOrStairs(areas, install) : s.key === 'route' ? firstRouteArea(areas, install) : install),
}

export const FRIDGE: TemplateDef = {
  id: FRIDGE_TEMPLATE_ID,
  version: FRIDGE_TEMPLATE_VERSION,
  title: '冰箱現場檢查',
  enableLabel: '啟用冰箱現場檢查',
  installAreaName: '冰箱安裝位置',
  noProductHint: '尚未選擇冰箱產品，選擇後會自動比對規格。',
  note: `規則版本 fridge v1・預留標準：左右各 5 cm、上方 5 cm、後方 5 cm`,
  sections: FRIDGE_SECTIONS,
  shots: FRIDGE_SHOTS,
  showIf: {
    outlet_distance_cm: (v) => v.outlet === 'yes',
    outlet_grounded: (v) => v.outlet === 'yes',
    dedicated_circuit: (v) => v.outlet === 'yes',
    water_source_distance_cm: (v) => v.water_line === 'yes',
  },
  isCategory: isFridgeCategory,
  pickArea: pickFridgeArea,
  check: checkFridge,
  shotArea: (s, areas, install) =>
    s.key === 'fridge_elevator_stairs'
      ? elevatorOrStairs(areas, install)
      : s.key === 'fridge_entrance'
        ? areas.find((a) => a.name.includes('大門')) ?? firstRouteArea(areas, install)
        : s.key === 'fridge_route'
          ? firstRouteArea(areas, install)
          : install,
}

export const TEMPLATES: TemplateDef[] = [WASHER, FRIDGE]

export function matchingProducts(def: TemplateDef, products: SurveyProduct[]) {
  return products.filter((p) => !p.deleted_at && productTemplate(p) === def.id)
}
