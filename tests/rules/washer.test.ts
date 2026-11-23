import { describe, expect, it } from 'vitest'
import { checkWasher, pickInstallArea, type WasherInput } from '../../src/rules/washer'
import type { SurveyArea, SurveyProduct } from '../../src/db/types'

const base = { user_id: 'u', revision: 1, created_at: '', updated_at: '', deleted_at: null, _dirty: 0 as const, _baseRevision: 1 }
let n = 0
function area(name: string, kind: SurveyArea['kind'], w: number | null, d: number | null, h: number | null): SurveyArea {
  return { ...base, id: `a${++n}`, survey_id: 's', kind, name, width_cm: w, depth_cm: d, height_cm: h, notes: null, sort_order: n }
}
function product(model: string, spec: Record<string, number | null>, category = '滾筒洗衣機'): SurveyProduct {
  return {
    ...base, id: `p-${model}`, survey_id: 's', catalog_product_id: null, model_code: model, display_name: null, category,
    spec_snapshot: { snapshot_version: 1, model_code: model, category, ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [`${k}_cm`, v])) } as never,
    snapshot_at: '', catalog_spec_hash: null, catalog_spec_updated_at: null, sort_order: 0,
  }
}
const WM = { width: 60, depth: 65, height: 85, door_open_90_depth: 110, power_cable: 150, water_inlet_hose: 120, drain_hose: 100, package_width: 66, package_depth: 72, package_height: 90 }
const goodValues = {
  stacked: 'no', front_clearance_cm: 80, door_obstacle: 'no', faucet: 'yes', faucet_distance_cm: 50,
  drain_type: 'floor', drain_distance_cm: 40, outlet: 'yes', outlet_distance_cm: 60, outlet_grounded: 'yes', dedicated_circuit: 'yes', floor_level: 'yes',
}
const allShots = new Set(['space_front', 'space_left', 'space_right', 'space_top', 'faucet', 'drain', 'outlet', 'route', 'elevator_stairs'])

function input(over: Partial<WasherInput> = {}): WasherInput {
  return {
    values: { ...goodValues },
    installAreaId: null,
    areas: [area('陽台', 'balcony', 70, 80, 200), area('大門', 'other', 90, null, 200), area('電梯', 'elevator', 90, 140, 210)],
    products: [product('WD-S15', WM)],
    shotsTaken: allShots,
    ...over,
  }
}
const ids = (r: ReturnType<typeof checkWasher>) => r.findings.map((f) => `${f.level}:${f.id}`)
const levelOf = (r: ReturnType<typeof checkWasher>, id: string) => r.findings.find((f) => f.id === id)?.level

describe('洗衣機規則', () => {
  it('條件都符合時沒有任何提醒，完成度 100%', () => {
    const r = checkWasher(input())
    expect(ids(r)).toEqual([])
    expect(r.score.percent).toBe(100)
  })

  it('安裝寬度：小於機身 → 高風險；小於機身 + 左右各 2 → 注意', () => {
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 59, 80, 200)] })), 'install:width')).toBe('high')
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 63, 80, 200)] })), 'install:width')).toBe('caution')
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 64, 80, 200)] })), 'install:width')).toBeUndefined()
  })

  it('安裝深度：後方預留 10 cm', () => {
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 70, 60, 200)] })), 'install:depth')).toBe('high')
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 70, 74, 200)] })), 'install:depth')).toBe('caution')
    expect(levelOf(checkWasher(input({ areas: [area('陽台', 'balcony', 70, 75, 200)] })), 'install:depth')).toBeUndefined()
  })

  it('疊放：高度相加後比對', () => {
    const dryer = product('DR-1', { ...WM, height: 90 }, '乾衣機')
    const r = checkWasher(input({ values: { ...goodValues, stacked: 'yes' }, products: [product('WD-S15', WM), dryer], areas: [area('陽台', 'balcony', 70, 80, 170)] }))
    const f = r.findings.find((x) => x.id === 'install:height')!
    expect(f.level).toBe('high')
    expect(f.why).toContain('175 cm')
    expect(f.basis).toContain('85 cm + 90 cm')
  })

  it('疊放但只選一台 → 必須人工確認', () => {
    expect(levelOf(checkWasher(input({ values: { ...goodValues, stacked: 'yes' } })), 'stack:one')).toBe('confirm')
  })

  it('門開 90 度凸出 45 cm，前方只有 40 → 高風險', () => {
    const r = checkWasher(input({ values: { ...goodValues, front_clearance_cm: 40 } }))
    expect(levelOf(r, 'door:WD-S15:door_open_90_depth')).toBe('high')
    expect(r.findings[0].level).toBe('high') // 排序：高風險在最前面
  })

  it('電源線不夠 → 高風險；水管不夠 → 注意', () => {
    const r = checkWasher(input({ values: { ...goodValues, outlet_distance_cm: 200, faucet_distance_cm: 130, drain_distance_cm: 101 } }))
    expect(levelOf(r, 'outlet:len:WD-S15')).toBe('high')
    expect(levelOf(r, 'faucet:len:WD-S15')).toBe('caution')
    expect(levelOf(r, 'drain:len:WD-S15')).toBe('caution')
  })

  it('只有「進排水管」長度時不猜測 → 必須人工確認', () => {
    const p = product('X', { ...WM, water_inlet_hose: null, drain_hose: null, inlet_drain_hose: 100 })
    const r = checkWasher(input({ products: [p], values: { ...goodValues, faucet_distance_cm: 110, drain_distance_cm: 50 } }))
    expect(levelOf(r, 'faucet:shared:X')).toBe('confirm')
    expect(levelOf(r, 'drain:shared:X')).toBeUndefined()
  })

  it('沒有水龍頭／排水／插座 → 高風險；不確定 → 必須人工確認', () => {
    const r = checkWasher(input({ values: { ...goodValues, faucet: 'no', drain_type: 'none', outlet: 'unsure' } }))
    expect(levelOf(r, 'faucet:none')).toBe('high')
    expect(levelOf(r, 'drain:none')).toBe('high')
    expect(levelOf(r, 'outlet:unsure')).toBe('confirm')
    // 沒有水龍頭時，不要求填距離
    expect(r.findings.find((f) => f.id === 'fields:missing')?.suggestion ?? '').not.toContain('水龍頭到機器位置的距離')
  })

  it('搬運：機身過不去 → 高風險；外箱過不去 → 注意（門口拆箱）', () => {
    const r1 = checkWasher(input({ areas: [area('陽台', 'balcony', 70, 80, 200), area('大門', 'other', 58, null, 200)] }))
    expect(r1.findings.find((f) => f.id.endsWith(':body'))?.level).toBe('high')
    const r2 = checkWasher(input({ areas: [area('陽台', 'balcony', 70, 80, 200), area('大門', 'other', 62, null, 200)] }))
    expect(r2.findings.find((f) => f.id.endsWith(':pkg'))?.level).toBe('caution')
    expect(r2.findings.some((f) => f.id.endsWith(':body'))).toBe(false)
  })

  it('電梯：寬不夠但深度夠可轉向；高度不夠但斜放可行 → 注意', () => {
    const r = checkWasher(input({ areas: [area('陽台', 'balcony', 70, 80, 200), area('大門', 'other', 90, null, 200), area('電梯', 'elevator', 55, 100, 80)] }))
    expect(r.findings.some((f) => f.id.endsWith(':body'))).toBe(false)
    expect(r.findings.find((f) => f.id.endsWith(':h'))?.level).toBe('caution')
  })

  it('電梯：斜放也放不下 → 高風險', () => {
    const r = checkWasher(input({ areas: [area('陽台', 'balcony', 70, 80, 200), area('電梯', 'elevator', 90, 40, 70)] }))
    expect(r.findings.find((f) => f.id.endsWith(':h'))?.level).toBe('high')
  })

  it('缺少產品或產品規格 → 必須人工確認', () => {
    expect(levelOf(checkWasher(input({ products: [] })), 'product:none')).toBe('confirm')
    expect(levelOf(checkWasher(input({ products: [product('Y', { ...WM, width: null })] })), 'spec:Y')).toBe('confirm')
    // 非洗衣類產品不納入
    expect(levelOf(checkWasher(input({ products: [product('TV', WM, '電視')] })), 'product:none')).toBe('confirm')
  })

  it('疑似單位錯誤（毫米、公尺）', () => {
    const r = checkWasher(input({ areas: [area('陽台', 'balcony', 700, 0.8, 200)] }))
    expect(r.findings.filter((f) => f.id.startsWith('unit:')).length).toBe(2)
  })

  it('未填欄位與未拍照片會降低完成度', () => {
    const r = checkWasher(input({ values: { stacked: 'no' }, shotsTaken: new Set() }))
    expect(levelOf(r, 'fields:missing')).toBe('confirm')
    expect(levelOf(r, 'shots:missing')).toBe('info')
    expect(r.score.percent).toBeLessThan(30)
  })

  it('地面不平 → 注意；未量搬運路線 → 必須人工確認', () => {
    const r = checkWasher(input({ values: { ...goodValues, floor_level: 'no' }, areas: [area('陽台', 'balcony', 70, 80, 200), area('樓梯', 'stairs', null, null, null)] }))
    expect(levelOf(r, 'floor')).toBe('caution')
    expect(levelOf(r, 'route:none')).toBe('confirm')
  })

  it('安裝位置選擇：指定 > 名稱含安裝位置 > 陽台', () => {
    const a = [area('陽台', 'balcony', 1, 1, 1), area('洗衣機安裝位置', 'other', 1, 1, 1), area('後陽台', 'other', 1, 1, 1)]
    expect(pickInstallArea(a, null)?.name).toBe('洗衣機安裝位置')
    expect(pickInstallArea(a, a[2].id)?.name).toBe('後陽台')
    expect(pickInstallArea([a[0]], 'gone')?.name).toBe('陽台')
  })

  it('相同輸入結果完全相同（確定性）', () => {
    const i = input({ values: { ...goodValues, front_clearance_cm: 10, outlet_distance_cm: 500 } })
    expect(JSON.stringify(checkWasher(i))).toBe(JSON.stringify(checkWasher(i)))
  })
})
