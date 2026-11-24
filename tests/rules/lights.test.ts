import { describe, expect, it } from 'vitest'
import { computeLights, verdict } from '../../src/rules/lights'
import { FRIDGE, WASHER } from '../../src/templates'
import { checkWasher } from '../../src/rules/washer'
import type { Finding } from '../../src/rules/types'

const f = (id: string, level: Finding['level']): Finding => ({ id, level, title: id, why: '', basis: '', suggestion: '' })
const done = (keys: string[], all = WASHER.steps.map((s) => s.key)) => new Map(all.map((k) => [k, keys.includes(k)]))

describe('燈號', () => {
  it('每格取最嚴重的等級；未歸類的放「資料」', () => {
    const L = computeLights(WASHER.lights, [f('install:width', 'caution'), f('outlet:none', 'high'), f('outlet:ground', 'caution'), f('something:new', 'confirm')], done(WASHER.steps.map((s) => s.key)))
    const s = Object.fromEntries(L.map((l) => [l.group.key, l.state]))
    expect(s).toMatchObject({ space: 'caution', power: 'high', water: 'ok', data: 'confirm' })
    expect(L.find((l) => l.group.key === 'power')!.findings.map((x) => x.id)).toEqual(['outlet:none', 'outlet:ground'])
  })
  it('步驟沒完成且沒有提醒 → 未填（不會沒填就亮綠燈）', () => {
    const L = computeLights(WASHER.lights, [], done(['install']))
    expect(L.find((l) => l.group.key === 'space')!.state).toBe('ok')
    expect(L.find((l) => l.group.key === 'water')!.state).toBe('todo')
    expect(verdict(L)).toEqual({ state: 'todo', text: `還有 ${L.filter((l) => l.state === 'todo').length} 類尚未填寫` })
  })
  it('結論', () => {
    const all = done(WASHER.steps.map((s) => s.key))
    expect(verdict(computeLights(WASHER.lights, [], all))).toEqual({ state: 'ok', text: '目前評估可以安裝' })
    expect(verdict(computeLights(WASHER.lights, [f('outlet:none', 'high')], all)).state).toBe('high')
    expect(verdict(computeLights(WASHER.lights, [f('floor', 'caution'), f('door:obstacle', 'confirm')], all)).text).toBe('1 類需注意・1 類待確認')
  })
  it('實際規則產生的每個結果都歸得到某一格（洗衣機、冰箱）', () => {
    const r = checkWasher({ values: { faucet: 'no', drain_type: 'none', outlet: 'no', floor_level: 'no', front_clearance_cm: 10, door_obstacle: 'yes' }, installAreaId: null, areas: [], products: [], shotsTaken: new Set() })
    const L = computeLights(WASHER.lights, r.findings, new Map())
    expect(L.reduce((n, l) => n + l.findings.length, 0)).toBe(r.findings.length)
    expect(FRIDGE.lights.at(-1)!.key).toBe('data')
    expect(WASHER.lights.at(-1)!.key).toBe('data')
  })
})
