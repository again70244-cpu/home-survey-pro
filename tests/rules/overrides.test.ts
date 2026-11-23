import { describe, expect, it } from 'vitest'
import { autoTemplate, productTemplate, specValueOf } from '../../src/rules/common'
import { checkFridge } from '../../src/rules/fridge'
import { checkWasher } from '../../src/rules/washer'
import type { SurveyArea, SurveyProduct } from '../../src/db/types'

const base = { user_id: 'u', revision: 1, created_at: '', updated_at: '', deleted_at: null, _dirty: 0 as const, _baseRevision: 1 }
const area = (name: string, w: number | null, d: number | null, h: number | null): SurveyArea => ({ ...base, id: name, survey_id: 's', kind: 'other', name, width_cm: w, depth_cm: d, height_cm: h, notes: null, sort_order: 0 })
const product = (category: string | null, snap: Record<string, number | null>, extra: Partial<SurveyProduct> = {}): SurveyProduct => ({
  ...base, id: 'p', survey_id: 's', catalog_product_id: null, model_code: 'M1', display_name: null, category,
  spec_snapshot: { snapshot_version: 1, model_code: 'M1', category, ...snap } as never,
  snapshot_at: '', catalog_spec_hash: null, catalog_spec_updated_at: null, sort_order: 0, ...extra,
})
const ov = (fields: Record<string, number>, note = '說明書') => ({ spec_overrides: { fields, note, updated_at: '2026-11-23T00:00:00Z' } })

describe('產品類型對應', () => {
  it('依分類自動判斷', () => {
    expect(autoTemplate('洗衣機')).toBe('washer')
    expect(autoTemplate('乾衣機')).toBe('washer')
    expect(autoTemplate('冰箱')).toBe('fridge')
    expect(autoTemplate('電子衣櫥')).toBeNull()
    expect(autoTemplate(null)).toBeNull()
  })
  it('手動指定優先；none = 不檢查', () => {
    expect(productTemplate(product('電子衣櫥', {}, { template_type: 'washer' }))).toBe('washer')
    expect(productTemplate(product('洗衣機', {}, { template_type: 'none' }))).toBeNull()
    expect(productTemplate(product(null, {}, { template_type: 'fridge' }))).toBe('fridge')
    expect(productTemplate(product('冰箱', {}, { template_type: null }))).toBe('fridge')
  })
  it('指定為冰箱的未分類產品會進入冰箱檢查；洗衣機設為不檢查則離開洗衣機檢查', () => {
    const r = checkFridge({ values: {}, installAreaId: null, areas: [], products: [product(null, { width_cm: 80 }, { template_type: 'fridge' })], shotsTaken: new Set() })
    expect(r.findings.some((f) => f.id === 'product:none')).toBe(false)
    const w = checkWasher({ values: {}, installAreaId: null, areas: [], products: [product('洗衣機', { width_cm: 60 }, { template_type: 'none' })], shotsTaken: new Set() })
    expect(w.findings.some((f) => f.id === 'product:none')).toBe(true)
  })
})

describe('手動修正規格', () => {
  it('修正值優先，保留原值；0 或空值不算修正', () => {
    const p = product('冰箱', { width_cm: 90, depth_cm: null }, ov({ width_cm: 91.5, depth_cm: 0 }))
    expect(specValueOf(p, 'width_cm')).toEqual({ value: 91.5, manual: true, original: 90 })
    expect(specValueOf(p, 'depth_cm')).toEqual({ value: null, manual: false, original: null })
  })
  it('缺少尺寸的冰箱：手動輸入後即可檢查，並以一般提醒標示來源', () => {
    const areas = [area('冰箱安裝位置', 85, 80, 200)]
    const missing = product('冰箱', { width_cm: null, depth_cm: null, height_cm: null })
    const r1 = checkFridge({ values: {}, installAreaId: null, areas, products: [missing], shotsTaken: new Set() })
    expect(r1.findings.find((f) => f.id === 'spec:M1')?.suggestion).toContain('修正規格')
    const fixed = { ...missing, ...ov({ width_cm: 83, depth_cm: 75, height_cm: 179 }, '現場實測') }
    const r2 = checkFridge({ values: {}, installAreaId: null, areas, products: [fixed], shotsTaken: new Set() })
    expect(r2.findings.some((f) => f.id === 'spec:M1')).toBe(false)
    expect(r2.findings.find((f) => f.id === 'install:width:M1')?.level).toBe('caution') // 85 < 83 + 10
    const m = r2.findings.find((f) => f.id === 'manual:M1')!
    expect(m.level).toBe('info')
    expect(m.why).toContain('寬 83 cm')
    expect(m.basis).toContain('現場實測')
  })
  it('修正後的值會改變結果（洗衣機寬度）', () => {
    const areas = [area('安裝位置', 66, 80, 200)]
    const wm = product('洗衣機', { width_cm: 60, depth_cm: 65, height_cm: 85 })
    const r1 = checkWasher({ values: {}, installAreaId: null, areas, products: [wm], shotsTaken: new Set() })
    expect(r1.findings.some((f) => f.id === 'install:width')).toBe(false)
    const r2 = checkWasher({ values: {}, installAreaId: null, areas, products: [{ ...wm, ...ov({ width_cm: 67 }) }], shotsTaken: new Set() })
    expect(r2.findings.find((f) => f.id === 'install:width')?.level).toBe('high')
    expect(r2.findings.find((f) => f.id === 'manual:M1')?.why).toContain('（原 60 cm）')
  })
})
