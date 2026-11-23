import { describe, expect, it } from 'vitest'
import { parseInstallText } from '../../supabase/functions/_shared/catalog/installText.ts'

describe('安裝尺寸解析', () => {
  it('WD-S2220B 標準格式（題目範例）', () => {
    const r = parseInstallText('寬70;高189;深83\n門開90度總深146\n電源線長度120\n進排水管長度100\n外箱尺寸寬75;高200;深86')
    expect(r.specs).toMatchObject({
      width_cm: 70,
      height_cm: 189,
      depth_cm: 83,
      door_open_90_depth_cm: 146,
      power_cable_cm: 120,
      package_width_cm: 75,
      package_height_cm: 200,
      package_depth_cm: 86,
    })
    // 「進排水管長度」含義不明：獨立欄位，不拆成進水、排水兩個確定數值
    expect(r.specs.inlet_drain_hose_cm).toBe(100)
    expect(r.specs.water_inlet_hose_cm).toBeNull()
    expect(r.specs.drain_hose_cm).toBeNull()
    expect(r.notes.join()).toContain('未區分進水管或排水管')
    expect(r.quality).toBe('complete')
    expect(r.unitAssumed).toBe(true)
    expect(r.unparsed).toEqual([])
  })

  it('小數尺寸', () => {
    const r = parseInstallText('寬60;高165.5;深66\n門開90度總深118\n外箱尺寸寬66.5;高171.5;深70.5')
    expect(r.specs.height_cm).toBe(165.5)
    expect(r.specs.package_depth_cm).toBe(70.5)
    expect(r.specs.door_open_90_depth_cm).toBe(118)
  })

  it('迷你洗衣機：全開總深附帶搭配條件', () => {
    const r = parseInstallText('寬68.9;高36.5;深77\n全開總深125(搭S22FHDB)\n電源線長度120\n外箱尺寸寬74.4;高47.7;深84.7')
    expect(r.specs.full_open_depth_cm).toBe(125)
    expect(r.conditions).toEqual([{ field: 'full_open_depth_cm', value_cm: 125, condition: '搭S22FHDB', source: '全開總深125(搭S22FHDB)' }])
    expect(r.specs.door_open_90_depth_cm).toBeNull()
    expect(r.specs.inlet_drain_hose_cm).toBeNull() // 原文沒寫就是 null
    expect(r.quality).toBe('complete')
  })

  it('直立式洗衣機：全開總高', () => {
    const r = parseInstallText('寬65.1;高106;深68\n全開總高138\n電源線長度120\n外箱尺寸寬69.6;高113.5;深75.9')
    expect(r.specs.full_open_height_cm).toBe(138)
    expect(r.specs.full_open_depth_cm).toBeNull()
  })

  it('空白 → 缺少安裝資料，所有欄位 null（不補 0）', () => {
    for (const t of ['', '   ', null, undefined]) {
      const r = parseInstallText(t)
      expect(r.quality).toBe('missing')
      expect(Object.values(r.specs).every((v) => v === null)).toBe(true)
    }
  })

  it('完全無法解析 → invalid，原文保留在 unparsed', () => {
    const r = parseInstallText('請洽業務確認尺寸')
    expect(r.quality).toBe('invalid')
    expect(r.unparsed).toEqual(['請洽業務確認尺寸'])
  })

  it('部分無法辨識 → needs_review，已辨識的仍保留，未辨識的不丟棄', () => {
    const r = parseInstallText('寬70;高189;深83\n底座需墊高5公分\n電源線長度120')
    expect(r.specs.width_cm).toBe(70)
    expect(r.specs.power_cable_cm).toBe(120)
    expect(r.unparsed).toEqual(['底座需墊高5公分'])
    expect(r.quality).toBe('needs_review')
  })

  it('缺少本體寬高深 → needs_review', () => {
    const r = parseInstallText('電源線長度120')
    expect(r.quality).toBe('needs_review')
    expect(r.issues.some((i) => i.code === 'missing_body_dims')).toBe(true)
  })

  it('明確單位：mm、m 換算為 cm，不視為預設', () => {
    const r = parseInstallText('寬700mm;高1.89m;深83cm\n電源線長度1200mm')
    expect(r.specs).toMatchObject({ width_cm: 70, height_cm: 189, depth_cm: 83, power_cable_cm: 120 })
    expect(r.unitAssumed).toBe(false)
  })

  it('全形數字與符號、多餘空白', () => {
    const r = parseInstallText('寬７０；高１８９；深８３\n 門開 90 度總深 146 \n電源線長度：120')
    expect(r.specs).toMatchObject({ width_cm: 70, height_cm: 189, depth_cm: 83, door_open_90_depth_cm: 146, power_cable_cm: 120 })
    expect(r.quality).toBe('complete')
  })

  it('同一欄位兩個不同數值 → 不採用任何一個，標記衝突', () => {
    const r = parseInstallText('寬70;高189;深83\n電源線長度120\n電源線長度150')
    expect(r.specs.power_cable_cm).toBeNull()
    expect(r.issues.some((i) => i.code === 'conflict' && i.field === 'power_cable_cm')).toBe(true)
    expect(r.quality).toBe('needs_review')
  })

  it('明確分開的進水管、排水管', () => {
    const r = parseInstallText('寬60;高85;深61.5\n進水管長度150\n排水管長度120')
    expect(r.specs.water_inlet_hose_cm).toBe(150)
    expect(r.specs.drain_hose_cm).toBe(120)
    expect(r.specs.inlet_drain_hose_cm).toBeNull()
  })

  it('Windows 換行與只有部分本體尺寸', () => {
    const r = parseInstallText('寬60;深61.5\r\n外箱尺寸寬65;高89;深70.5')
    expect(r.specs.width_cm).toBe(60)
    expect(r.specs.height_cm).toBeNull()
    expect(r.quality).toBe('needs_review')
  })

  // ---- 實際試算表中出現的格式（2026-11 同步預覽回報的 13 筆待確認） ----
  it('冰箱 R723MB：門開90度總深＋總寬、電源線附註', () => {
    const r = parseInstallText('寬83;高179;深75\n門開90度總深125 總寬85\n電源線長度160(插頭+總線長)')
    expect(r.specs).toMatchObject({ door_open_90_depth_cm: 125, door_open_90_width_cm: 85, power_cable_cm: 160 })
    expect(r.conditions).toContainEqual({ field: 'power_cable_cm', value_cm: 160, condition: '插頭+總線長', source: '電源線長度160(插頭+總線長)' })
    expect(r.unparsed).toEqual([])
    expect(r.quality).toBe('complete')
  })

  it('冰箱 GV-NB61BG：拆門總深', () => {
    const r = parseInstallText('寬91.3;高179;深73.5\n門開90度總深105.7 總寬129\n拆門總深63.5')
    expect(r.specs).toMatchObject({ door_open_90_depth_cm: 105.7, door_open_90_width_cm: 129, door_removed_depth_cm: 63.5 })
    expect(r.quality).toBe('complete')
  })

  it('冰箱 GR-AQC82BS：抽屜全開總深與「全開總深」分開', () => {
    const r = parseInstallText('寬91.2;高179;深73.5\n門開90度總深126 總寬144.2\n抽屜全開總深140.6\n拆門總深76.4')
    expect(r.specs.drawer_open_depth_cm).toBe(140.6)
    expect(r.specs.full_open_depth_cm).toBeNull()
    expect(r.specs.door_removed_depth_cm).toBe(76.4)
    expect(r.quality).toBe('complete')
  })

  it('電視 OLED42C6PTA：深度含底座 → 數值照填，保留附註', () => {
    const r = parseInstallText('寬93.2;高54;深17(含底座)')
    expect(r.specs).toMatchObject({ width_cm: 93.2, height_cm: 54, depth_cm: 17 })
    expect(r.conditions).toEqual([{ field: 'depth_cm', value_cm: 17, condition: '含底座', source: '寬93.2;高54;深17(含底座)' }])
    expect(r.quality).toBe('complete')
  })

  it('單獨出現的「總寬」含義不明 → 整行列為無法辨識，不猜', () => {
    const r = parseInstallText('寬83;高179;深75\n總寬85')
    expect(r.specs.door_open_90_width_cm).toBeNull()
    expect(r.unparsed).toEqual(['總寬85'])
    expect(r.quality).toBe('needs_review')
  })

  it('一行中只要有一段看不懂，整行不採用（避免只取一半）', () => {
    const r = parseInstallText('寬83;高179;深75\n門開90度總深125 約略寬度85')
    expect(r.specs.door_open_90_depth_cm).toBeNull()
    expect(r.unparsed).toEqual(['門開90度總深125 約略寬度85'])
  })

  it('乘號、斜線分隔的尺寸', () => {
    expect(parseInstallText('寬70*高189*深83').specs).toMatchObject({ width_cm: 70, height_cm: 189, depth_cm: 83 })
    expect(parseInstallText('寬70/高189/深83').specs).toMatchObject({ width_cm: 70, height_cm: 189, depth_cm: 83 })
  })

  it('缺少本體深度的電視 → 維持待確認，不推測', () => {
    const r = parseInstallText('寬186;高106.7')
    expect(r.specs.depth_cm).toBeNull()
    expect(r.quality).toBe('needs_review')
  })
})

