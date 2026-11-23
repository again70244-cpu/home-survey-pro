import { describe, expect, it } from 'vitest'
import { checkFridge, pickFridgeArea } from '../../src/rules/fridge'
import type { RuleInput } from '../../src/rules/common'
import type { SurveyArea, SurveyProduct } from '../../src/db/types'
import { FRIDGE_SHOTS } from '../../src/templates/fridge'

const base = { user_id: 'u', revision: 1, created_at: '', updated_at: '', deleted_at: null, _dirty: 0 as const, _baseRevision: 1 }
let n = 0
const area = (name: string, kind: SurveyArea['kind'], w: number | null, d: number | null, h: number | null): SurveyArea => ({ ...base, id: `a${++n}`, survey_id: 's', kind, name, width_cm: w, depth_cm: d, height_cm: h, notes: null, sort_order: n })
const product = (model: string, spec: Record<string, number | null>, category = '冰箱'): SurveyProduct => ({
  ...base, id: `p-${model}`, survey_id: 's', catalog_product_id: null, model_code: model, display_name: null, category,
  // 與正式規格快照相同：欄位名稱以 _cm 結尾
  spec_snapshot: { snapshot_version: 1, model_code: model, category, ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [`${k}_cm`, v])) } as never,
  snapshot_at: '', catalog_spec_hash: null, catalog_spec_updated_at: null, sort_order: 0,
})
// GR-AQC82BS（產品知識庫實際數值）＋ 電源線、外箱
const FR = { width: 91.2, depth: 73.5, height: 179, door_open_90_depth: 126, door_open_90_width: 144.2, door_removed_depth: 76.4, drawer_open_depth: 140.6, power_cable: 160, package_width: 98, package_depth: 80 }
const good = { side_walls: 'open', front_clearance_cm: 100, door_obstacle: 'no', outlet: 'yes', outlet_distance_cm: 80, outlet_grounded: 'yes', dedicated_circuit: 'yes', water_line: 'no', floor_level: 'yes', heat_source: 'no' }
const shots = new Set(FRIDGE_SHOTS.map((s) => s.key))
const input = (over: Partial<RuleInput> = {}): RuleInput => ({
  values: { ...good },
  installAreaId: null,
  areas: [area('冰箱安裝位置', 'other', 110, 90, 200), area('大門', 'other', 95, null, 200), area('電梯', 'elevator', 100, 150, 220)],
  products: [product('GR-AQC82BS', FR)],
  shotsTaken: shots,
  ...over,
})
const lv = (r: ReturnType<typeof checkFridge>, id: string) => r.findings.find((f) => f.id === id)?.level
const M = 'GR-AQC82BS'

describe('冰箱規則', () => {
  it('條件都符合時沒有任何提醒，完成度 100%', () => {
    const r = checkFridge(input())
    expect(r.findings.map((f) => f.id)).toEqual([])
    expect(r.score.percent).toBe(100)
  })

  it('寬：< 機身 → 高風險；< 機身 + 左右各 5 → 注意', () => {
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 90, 90, 200)] })), `install:width:${M}`)).toBe('high')
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 101, 90, 200)] })), `install:width:${M}`)).toBe('caution')
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 101.2, 90, 200)] })), `install:width:${M}`)).toBeUndefined()
  })

  it('深：後方 5；高：上方 5', () => {
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 78, 200)] })), `install:depth:${M}`)).toBe('caution')
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 175)] })), `install:height:${M}`)).toBe('high')
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 182)] })), `install:height:${M}`)).toBe('caution')
  })

  it('高度一定要量：未量 → 必須人工確認', () => {
    expect(lv(checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, null)] })), 'install:dims')).toBe('confirm')
  })

  it('門開 90 度凸出 52.5、前方只有 50 → 高風險；抽屜凸出 67.1 → 注意', () => {
    const r = checkFridge(input({ values: { ...good, front_clearance_cm: 50 } }))
    expect(lv(r, `door:${M}:door_open_90_depth`)).toBe('high')
    expect(lv(r, `door:${M}:drawer_open_depth`)).toBe('caution')
    const r2 = checkFridge(input({ values: { ...good, front_clearance_cm: 60 } }))
    expect(lv(r2, `door:${M}:door_open_90_depth`)).toBeUndefined()
    expect(lv(r2, `door:${M}:drawer_open_depth`)).toBe('caution')
  })

  it('嵌入空間寬 110 < 門開 90 度總寬 144.2 → 注意；兩側空曠不提醒', () => {
    expect(lv(checkFridge(input({ values: { ...good, side_walls: 'both' } })), `door:width:${M}`)).toBe('caution')
    expect(lv(checkFridge(input({ values: { ...good, side_walls: 'open' } })), `door:width:${M}`)).toBeUndefined()
    expect(lv(checkFridge(input({ values: { ...good, side_walls: 'one' }, areas: [area('冰箱安裝位置', 'other', 150, 90, 200)] })), `door:width:${M}`)).toBeUndefined()
  })

  it('大門 72 < 機身最窄面 73.5，此機型拆門後更深 → 高風險（不建議拆門）', () => {
    // 機身最窄面 = min(91.2, 73.5) = 73.5；拆門後 = min(91.2, 76.4) = 76.4（拆門反而較深，不適用）
    const r = checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 200), area('大門', 'other', 72, null, 200)] }))
    expect(r.findings.find((f) => f.id.endsWith(':body'))?.level).toBe('high')
    expect(r.findings.some((f) => f.id.endsWith(':nodoor'))).toBe(false)
  })

  it('拆門後較窄的機型：通道介於兩者之間 → 注意（需拆門）', () => {
    const p = product('DOOR', { ...FR, width: 91, depth: 80, door_removed_depth: 68 })
    const r = checkFridge(input({ products: [p], areas: [area('冰箱安裝位置', 'other', 110, 95, 200), area('大門', 'other', 72, null, 200)] }))
    expect(r.findings.find((f) => f.id.endsWith(':nodoor'))?.level).toBe('caution')
    expect(r.findings.some((f) => f.id.endsWith(':body'))).toBe(false)
  })

  it('外箱過不去 → 注意（門口拆箱）', () => {
    const r = checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 200), area('大門', 'other', 78, null, 200)] }))
    expect(r.findings.find((f) => f.id.endsWith(':pkg'))?.level).toBe('caution')
  })

  it('電梯高度不足 → 高風險（冰箱不可平放）；門框高度不足 → 注意（小角度傾斜）', () => {
    const r = checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 200), area('電梯', 'elevator', 100, 150, 170), area('大門', 'other', 95, null, 175)] }))
    const hs = r.findings.filter((f) => f.id.endsWith(':h'))
    expect(hs.map((f) => f.level).sort()).toEqual(['caution', 'high'])
  })

  it('電梯未量高度 → 必須人工確認', () => {
    const r = checkFridge(input({ areas: [area('冰箱安裝位置', 'other', 110, 90, 200), area('電梯', 'elevator', 100, 150, null)] }))
    expect(r.findings.some((f) => f.id.endsWith(':dims') && f.level === 'confirm')).toBe(true)
  })

  it('電源線不足 → 高風險；沒有插座 → 高風險', () => {
    expect(lv(checkFridge(input({ values: { ...good, outlet_distance_cm: 170 } })), `outlet:len:${M}`)).toBe('high')
    expect(lv(checkFridge(input({ values: { ...good, outlet: 'no' } })), 'outlet:none')).toBe('high')
  })

  it('進水管：需要但沒有長度資料 → 必須人工確認；需要時才要求水源距離與照片', () => {
    const r = checkFridge(input({ values: { ...good, water_line: 'yes', water_source_distance_cm: 150 } }))
    expect(lv(r, `water:nospec:${M}`)).toBe('confirm')
    const r2 = checkFridge(input({ values: { ...good, water_line: 'yes' }, shotsTaken: new Set([...shots].filter((k) => k !== 'fridge_water')) }))
    expect(r2.findings.find((f) => f.id === 'fields:missing')?.suggestion).toContain('水源')
    expect(r2.findings.find((f) => f.id === 'shots:missing')?.suggestion).toContain('進水水源')
    const r3 = checkFridge(input({ shotsTaken: new Set([...shots].filter((k) => k !== 'fridge_water')) }))
    expect(lv(r3, 'shots:missing')).toBeUndefined() // 不需要進水管時不要求拍水源
  })

  it('熱源、地面不平 → 注意', () => {
    const r = checkFridge(input({ values: { ...good, heat_source: 'yes', floor_level: 'no' } }))
    expect(lv(r, 'heat')).toBe('caution')
    expect(lv(r, 'floor')).toBe('caution')
  })

  it('沒有冰箱產品（只選洗衣機） → 必須人工確認', () => {
    expect(lv(checkFridge(input({ products: [product('WD', FR, '洗衣機')] })), 'product:none')).toBe('confirm')
  })

  it('安裝位置：不預設陽台；名稱含冰箱或廚房才自動選', () => {
    expect(pickFridgeArea([area('陽台', 'balcony', 1, 1, 1)], null)).toBeNull()
    expect(pickFridgeArea([area('陽台', 'balcony', 1, 1, 1), area('廚房', 'other', 1, 1, 1)], null)?.name).toBe('廚房')
    expect(lv(checkFridge(input({ areas: [area('陽台', 'balcony', 110, 90, 200)] })), 'install:none')).toBe('confirm')
  })

  it('相同輸入結果完全相同（確定性）', () => {
    const i = input({ values: { ...good, front_clearance_cm: 10, side_walls: 'both' } })
    expect(JSON.stringify(checkFridge(i))).toBe(JSON.stringify(checkFridge(i)))
  })
})
