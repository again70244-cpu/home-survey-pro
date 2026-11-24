import { describe, expect, it } from 'vitest'
import { FRIDGE, WASHER, type TemplateDef } from '../../src/templates'
import { resolveTarget, stepStatus, visibleFields, visibleShots, type FieldStep } from '../../src/templates/steps'
import type { SurveyArea } from '../../src/db/types'
import type { TemplateValues } from '../../src/rules/common'

const base = { user_id: 'u', revision: 1, created_at: '', updated_at: '', deleted_at: null, _dirty: 0 as const, _baseRevision: 1 }
const area = (id: string, name: string, kind: SurveyArea['kind'], w: number | null = null, d: number | null = null, h: number | null = null): SurveyArea => ({ ...base, id, survey_id: 's', kind, name, width_cm: w, depth_cm: d, height_cm: h, notes: null, sort_order: 0 })
const ctx = (def: TemplateDef, values: TemplateValues, shots: string[] = [], a: SurveyArea | null = null) => ({
  values,
  fieldsByKey: new Map(def.sections.flatMap((s) => s.fields).map((f) => [f.key, f])),
  showIf: def.showIf,
  shotsByKey: new Map(def.shots.map((s) => [s.key, s])),
  shotsTaken: new Set(shots),
  area: a,
})
const step = (def: TemplateDef, key: string) => def.steps.find((s) => s.key === key) as FieldStep

describe('現場拍攝步驟', () => {
  it('每個步驟引用的欄位與拍攝項目都存在於模板（避免打錯字）', () => {
    for (const def of [WASHER, FRIDGE]) {
      const fields = new Set(def.sections.flatMap((s) => s.fields.map((f) => f.key)))
      const shots = new Set(def.shots.map((s) => s.key))
      for (const s of def.steps) {
        for (const f of s.fields) expect(fields.has(f), `${def.id}.${s.key} 欄位 ${f}`).toBe(true)
        for (const k of s.shots) expect(shots.has(k), `${def.id}.${s.key} 拍攝 ${k}`).toBe(true)
      }
    }
  })

  it('每個必填欄位與拍攝項目都至少出現在一個步驟（不會漏）', () => {
    for (const def of [WASHER, FRIDGE]) {
      const inSteps = new Set(def.steps.flatMap((s) => s.fields))
      const shotsInSteps = new Set(def.steps.flatMap((s) => s.shots))
      for (const f of def.sections.flatMap((s) => s.fields)) expect(inSteps.has(f.key), `${def.id} 欄位 ${f.key}`).toBe(true)
      for (const s of def.shots) expect(shotsInSteps.has(s.key), `${def.id} 拍攝 ${s.key}`).toBe(true)
    }
  })

  it('安裝位置：寬深高與必填問題都完成才算完成；照片不強制但會提醒', () => {
    const s = step(WASHER, 'install')
    expect(stepStatus(s, ctx(WASHER, { stacked: 'no' }, [], area('a', '陽台', 'balcony', 70, 80, null))).done).toBe(false)
    const r = stepStatus(s, ctx(WASHER, { stacked: 'no' }, [], area('a', '陽台', 'balcony', 70, 80, 200)))
    expect(r).toMatchObject({ done: true, photoMissing: true, shotsDone: 0, shotsTotal: 1 })
    expect(stepStatus(s, ctx(WASHER, { stacked: 'no' }, ['space_front'], area('a', '陽台', 'balcony', 70, 80, 200))).photoMissing).toBe(false)
  })

  it('水龍頭：選「沒有」就不需要距離；選「有」要填距離', () => {
    const s = step(WASHER, 'faucet')
    expect(stepStatus(s, ctx(WASHER, { faucet: 'no' })).done).toBe(true)
    expect(stepStatus(s, ctx(WASHER, { faucet: 'yes' })).done).toBe(false)
    expect(stepStatus(s, ctx(WASHER, { faucet: 'yes', faucet_distance_cm: 50 })).done).toBe(true)
    expect(visibleFields(s, ctx(WASHER, { faucet: 'no' })).map((f) => f.key)).toEqual(['faucet'])
  })

  it('只有照片的步驟：拍了任一張就算完成，另一張提醒補拍', () => {
    const s = step(WASHER, 'sides')
    expect(stepStatus(s, ctx(WASHER, {})).done).toBe(false)
    expect(stepStatus(s, ctx(WASHER, {}, ['space_left']))).toMatchObject({ done: true, photoMissing: true })
  })

  it('冰箱進水管：不需要時不要求水源照片', () => {
    const s = step(FRIDGE, 'water')
    expect(visibleShots(s, ctx(FRIDGE, { water_line: 'no' }))).toHaveLength(0)
    expect(stepStatus(s, ctx(FRIDGE, { water_line: 'no' }))).toMatchObject({ done: true, photoMissing: false })
    expect(stepStatus(s, ctx(FRIDGE, { water_line: 'yes', water_source_distance_cm: 120 }))).toMatchObject({ done: true, photoMissing: true })
  })

  it('大門與電梯：只要求寬度；找對應的區域', () => {
    const areas = [area('b', '陽台', 'balcony'), area('d', '大門', 'other', 90), area('e', '電梯', 'elevator'), area('s', '樓梯', 'stairs', 100)]
    expect(resolveTarget('door', areas, null)?.id).toBe('d')
    expect(resolveTarget('passage', areas, null)?.id).toBe('e')
    expect(resolveTarget('passage', areas, null, 'stairs')?.id).toBe('s')
    expect(resolveTarget('passage', [areas[3]], null)?.id).toBe('s')
    expect(stepStatus(step(WASHER, 'door'), ctx(WASHER, {}, [], areas[1])).done).toBe(true)
    expect(stepStatus(step(WASHER, 'passage'), ctx(WASHER, {}, [], areas[2])).done).toBe(false)
  })
})
