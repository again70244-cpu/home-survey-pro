import { describe, expect, it } from 'vitest'
import { customerItem, customerItems } from '../../src/report/customerText'
import { checkWasher } from '../../src/rules/washer'
import { checkFridge } from '../../src/rules/fridge'
import type { SurveyArea, SurveyProduct } from '../../src/db/types'
import type { Finding } from '../../src/rules/types'

const base = { user_id: 'u', revision: 1, created_at: '', updated_at: '', deleted_at: null, _dirty: 0 as const, _baseRevision: 1 }
const area = (id: string, name: string, kind: SurveyArea['kind'], w: number | null, d: number | null, h: number | null): SurveyArea => ({ ...base, id, survey_id: 's', kind, name, width_cm: w, depth_cm: d, height_cm: h, notes: null, sort_order: 0 })
const product = (model: string, category: string, spec: Record<string, number>): SurveyProduct => ({
  ...base, id: model, survey_id: 's', catalog_product_id: null, model_code: model, display_name: null, category,
  spec_snapshot: { snapshot_version: 1, model_code: model, category, ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [`${k}_cm`, v])) } as never,
  snapshot_at: '', catalog_spec_hash: null, catalog_spec_updated_at: null, sort_order: 0,
})
const WM = product('WM', '洗衣機', { width: 60, depth: 65, height: 85, door_open_90_depth: 110, full_open_depth: 120, power_cable: 100, water_inlet_hose: 50, drain_hose: 50, package_width: 66, package_depth: 72 })
const FR = product('FR', '冰箱', { width: 91, depth: 80, height: 179, door_open_90_depth: 126, door_open_90_width: 144, door_removed_depth: 68, drawer_open_depth: 140, power_cable: 100, water_inlet_hose: 50, package_width: 98, package_depth: 85 })

// 各種「什麼都不對」的情境，盡量觸發每一條高風險與注意事項
const routes = (w: number) => [area('d', '大門', 'other', w, null, 150), area('e', '電梯', 'elevator', w, 50, 150)]
const scenarios = (kind: 'washer' | 'fridge') => {
  const out: Finding[] = []
  const run = kind === 'washer' ? checkWasher : checkFridge
  const p = kind === 'washer' ? WM : FR
  const install = area('i', kind === 'washer' ? '陽台' : '冰箱安裝位置', kind === 'washer' ? 'balcony' : 'other', 0, 0, 0)
  for (const [w, d, h] of [[50, 50, 80], [p.spec_snapshot.width_cm as number + 1, (p.spec_snapshot.depth_cm as number) + 1, (p.spec_snapshot.height_cm as number) + 1]])
    for (const rw of [40, 64, 70, 90, 96])
      for (const values of [
        { faucet: 'no', drain_type: 'none', outlet: 'no', floor_level: 'no', door_obstacle: 'yes', side_walls: 'both', heat_source: 'yes', water_line: 'yes' },
        { faucet: 'yes', faucet_distance_cm: 500, drain_type: 'floor', drain_distance_cm: 500, outlet: 'yes', outlet_distance_cm: 500, outlet_grounded: 'no', dedicated_circuit: 'no', front_clearance_cm: 10, water_line: 'yes', water_source_distance_cm: 500, side_walls: 'one' },
        { front_clearance_cm: 55, outlet: 'yes', outlet_distance_cm: 10 },
      ])
        out.push(...run({ values, installAreaId: 'i', areas: [{ ...install, width_cm: w, depth_cm: d, height_cm: h }, ...routes(rw)], products: [p], shotsTaken: new Set() }).findings)
  return out
}

describe('客戶版文字', () => {
  for (const kind of ['washer', 'fridge'] as const) {
    it(`${kind}：每一條高風險與注意事項都有客戶版說明（單位防呆除外）`, () => {
      const all = scenarios(kind)
      const ids = new Set(all.map((f) => `${f.level}|${f.id}`))
      expect(ids.size).toBeGreaterThan(15) // 情境確實觸發了大量規則
      const missing = all.filter((f) => (f.level === 'high' || f.level === 'caution') && !f.id.startsWith('unit:') && !customerItem(kind, f, []))
      expect([...new Set(missing.map((f) => `${f.level}|${f.id}`))]).toEqual([])
    })
    it(`${kind}：「必須人工確認」不會出現在客戶版`, () => {
      expect(scenarios(kind).filter((f) => f.level === 'confirm' && customerItem(kind, f, []))).toEqual([])
    })
  }

  it('區域名稱帶入、相同文字只列一次、需要調整排前面', () => {
    const areas = [area('d', '大門', 'other', 50, null, null)]
    const fs: Finding[] = [
      { id: 'floor', level: 'caution', title: '', why: '', basis: '', suggestion: '' },
      { id: 'route:d:A:body', level: 'high', title: '', why: '', basis: '', suggestion: '', areaId: 'd' },
      { id: 'route:d:B:body', level: 'high', title: '', why: '', basis: '', suggestion: '', areaId: 'd' },
    ]
    const r = customerItems('washer', fs, areas)
    expect(r.map((x) => x.text)).toEqual(['大門寬度不夠，機器無法搬進去', '地面不太平整'])
    expect(r[0].kind).toBe('adjust')
  })

  it('洗衣機與冰箱用詞不同', () => {
    const f = (id: string): Finding => ({ id, level: 'caution', title: '', why: '', basis: '', suggestion: '' })
    expect(customerItem('washer', f('install:width'), [])?.action).toContain('洗衣機')
    expect(customerItem('fridge', f('install:width:FR'), [])?.text).toContain('散熱')
  })
})
