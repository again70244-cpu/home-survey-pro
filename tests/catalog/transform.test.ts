import { describe, expect, it } from 'vitest'
import { displayNameFrom, extractUrls, splitModelCell, stripPrices } from '../../supabase/functions/_shared/catalog/normalize.ts'
import { parseMultiSplitRow } from '../../supabase/functions/_shared/catalog/multiSplit.ts'
import { ForbiddenColumnError, transformProducts, transformSnapshot, transformSystems } from '../../supabase/functions/_shared/catalog/transform.ts'

const row = (n: number, values: Record<string, string | null>) => ({ row: n, values })

describe('型號正規化', () => {
  it('型號 + 大量空白 + 描述', () => {
    expect(splitModelCell('WD-S2220B                         AI智控洗乾衣機/22洗20乾/尊爵黑')).toEqual({
      modelCode: 'WD-S2220B',
      modelToken: 'WD-S2220B',
      description: 'AI智控洗乾衣機/22洗20乾/尊爵黑',
    })
  })
  it('冷氣室外機/室內機成對，視為一個型號', () => {
    expect(splitModelCell('LSU72DHST/LSN72IDHST  極適(新) 7.2KW')?.modelCode).toBe('LSU72DHST/LSN72IDHST')
    expect(splitModelCell('LSU93DHP / LSN93DHP 旗艦9.3KW')?.modelCode).toBe('LSU93DHP/LSN93DHP')
  })
  it('大小寫、全形、空白都正規化成同一個鍵', () => {
    expect(splitModelCell('  wd-s2220b  黑')?.modelCode).toBe('WD-S2220B')
    expect(splitModelCell('ＷＤ－Ｓ２２２０Ｂ 黑')?.modelCode).toBe('WD-S2220B')
  })
  it('標題列、空白列不視為產品', () => {
    expect(splitModelCell('')).toBeNull()
    expect(splitModelCell('產品型號')).toBeNull()
  })
  it('顯示名稱去除通路字樣與 C/ 前綴，原始描述另存', () => {
    expect(displayNameFrom('C/AI智控洗乾衣機/18洗18乾/鈦空銀/網購+集盛禁售')).toBe('AI智控洗乾衣機/18洗18乾/鈦空銀')
    expect(displayNameFrom('AI智控洗乾衣機/22洗20乾/珍珠灰/網購禁售')).toBe('AI智控洗乾衣機/22洗20乾/珍珠灰')
  })
  it('網址：全形逗號、前置空白、重複', () => {
    expect(
      extractUrls('https://i.ibb.co/a.png，https://i.ibb.co/b.png', ' https://i.ibb.co/b.png', '', 'not a url'),
    ).toEqual(['https://i.ibb.co/a.png', 'https://i.ibb.co/b.png'])
  })
  it('去除金額', () => {
    expect(stripPrices('LSN22DDHST極淨2.2KW $11900')).toEqual({ text: 'LSN22DDHST極淨2.2KW', removed: true })
    expect(stripPrices('加價購 NT$2,250 或 1200元').text).toBe('加價購 或')
  })
})

describe('產品轉換', () => {
  it('只接受白名單欄位：出現價格欄位就拒絕整批', async () => {
    await expect(transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', 產品原價: '114900' })])).rejects.toBeInstanceOf(ForbiddenColumnError)
    await expect(transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', '促銷/備註': 'x' })])).rejects.toBeInstanceOf(ForbiddenColumnError)
  })

  it('完整轉換一筆洗衣機', async () => {
    const { products } = await transformProducts([
      row(28, {
        產品型號: 'WD-S2220B                         AI智控洗乾衣機/22洗20乾/尊爵黑',
        分類: '洗衣機',
        圖片網址: 'https://i.ibb.co/xtshnSJk/LG-AI-WD-S2220-B.png，https://i.ibb.co/QjTKM5jg/image.png',
        圖片網址2: 'https://i.ibb.co/QjTKM5jg/image.png',
        安裝尺寸: '寬70;高189;深83\n門開90度總深146\n電源線長度120\n進排水管長度100\n外箱尺寸寬75;高200;深86',
        連結: null,
        影片網址: '',
        保養說明: null,
      }),
    ])
    const p = products[0]
    expect(p.source_key).toBe('報價:WD-S2220B')
    expect(p.image_urls).toHaveLength(2)
    expect(p.specs.width_cm).toBe(70)
    expect(p.data_quality).toBe('complete')
    expect(p.install_text_raw).toContain('外箱尺寸寬75')
    expect(p.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('冷氣沒有安裝尺寸 → missing', async () => {
    const { products } = await transformProducts([row(2, { 產品型號: 'LSU93DHP/LSN93DHP 旗艦9.3KW', 分類: '冷氣/空調', 安裝尺寸: '' })])
    expect(products[0].data_quality).toBe('missing')
    expect(products[0].specs.width_cm).toBeNull()
  })

  it('重複型號：只保留第一筆並標記待確認', async () => {
    const { products, warnings } = await transformProducts([
      row(5, { 產品型號: 'WD-S2220B 黑', 安裝尺寸: '寬70;高189;深83' }),
      row(9, { 產品型號: 'wd-s2220b  重複', 安裝尺寸: '寬71;高189;深83' }),
    ])
    expect(products).toHaveLength(1)
    expect(products[0].specs.width_cm).toBe(70)
    expect(products[0].data_quality).toBe('needs_review')
    expect(warnings[0]).toContain('第 5 列與第 9 列')
  })

  it('相同資料 → 相同雜湊（冪等）；尺寸改變 → spec_hash 改變', async () => {
    const a = await transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', 分類: '洗衣機', 安裝尺寸: '寬70;高189;深83' })])
    const b = await transformProducts([row(7, { 產品型號: 'WD-S2220B 黑', 分類: '洗衣機', 安裝尺寸: '寬70;高189;深83' })])
    const c = await transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', 分類: '洗衣機', 安裝尺寸: '寬71;高189;深83' })])
    const d = await transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', 分類: '洗衣機/乾衣機', 安裝尺寸: '寬70;高189;深83' })])
    expect(a.products[0].content_hash).toBe(b.products[0].content_hash) // 列號不同不算變更
    expect(c.products[0].spec_hash).not.toBe(a.products[0].spec_hash)
    expect(d.products[0].spec_hash).toBe(a.products[0].spec_hash) // 只改分類 → 規格未變
    expect(d.products[0].content_hash).not.toBe(a.products[0].content_hash)
  })
})

describe('規格雜湊穩定性', () => {
  it('新增欄位（值為 null）不影響雜湊：日後擴充欄位不會讓所有產品被誤判為規格變更', async () => {
    const { products } = await transformProducts([row(2, { 產品型號: 'WD-S2220B 黑', 安裝尺寸: '寬70;高189;深83' })])
    const p = products[0]
    const filled = Object.fromEntries(Object.entries(p.specs).filter(([, v]) => v !== null))
    const { sha256 } = await import('../../supabase/functions/_shared/catalog/transform.ts')
    const withExtraNullField = await sha256({ specs: { ...filled }, extra: p.install_extra, raw: p.install_text_raw })
    expect(p.spec_hash).toBe(withExtraNullField)
    expect(Object.keys(p.specs)).toContain('door_removed_depth_cm') // 欄位存在但為 null
  })
})

describe('一對多搭配', () => {
  const r3 = {
    室外機型號: '一對二;一對三室外機LM3U90(8.8KW)',
    室內機1: 'LSN22DDHST極淨2.2KW $11900',
    室內機2: 'LSN28DDHST極淨2.8KW $12500',
    室內機3: 'LSN36DDHST極淨3.6KW $12900',
    室內機4: 'LSN41DDHST極淨4.1KW $14900',
    室內機5: 'LSN50DDHST極淨5.0KW $17000',
    室內機6: 'LSN63DDHST極淨6.3KW $18500',
    室內機7: 'LSN72DDHST極淨7.2KW $21500',
    備註: '一對二搭配室內機2.2~7.2(相加總合不得超過11.3;相加總合不得低於8.7);一對三搭配室內機2.2~6.3(相加總合不得超過11.5;相加總合不得低於9.5)',
  }
  it('解析室外機、室內機（每台一筆）與容量規則', () => {
    const s = parseMultiSplitRow(r3)!
    expect(s.model_code).toBe('LM3U90')
    expect(s.capacity_kw).toBe(8.8)
    expect(s.indoor_counts).toEqual([2, 3])
    expect(s.indoor_units).toHaveLength(7)
    expect(s.indoor_units[0]).toEqual({ model_code: 'LSN22DDHST', series: '極淨', capacity_kw: 2.2, position: 1, source_text: 'LSN22DDHST極淨2.2KW' })
    expect(s.rules).toEqual([
      { indoor_count: 2, unit_min_kw: 2.2, unit_max_kw: 7.2, total_max_kw: 11.3, total_min_kw: 8.7, source_text: expect.any(String) },
      { indoor_count: 3, unit_min_kw: 2.2, unit_max_kw: 6.3, total_max_kw: 11.5, total_min_kw: 9.5, source_text: expect.any(String) },
    ])
  })
  it('任何輸出都不含價格', () => {
    const s = parseMultiSplitRow(r3)!
    expect(JSON.stringify(s)).not.toMatch(/\$|11900|21500/)
  })
  it('沒有標示一對幾的規則套用全部', () => {
    const s = parseMultiSplitRow({ 室外機型號: '一對二 室外機 LM2U50(5.2KW)', 室內機1: 'LSN22DDHST極淨2.2KW $11900', 備註: '搭配室內機2.2~4.1(相加總合不得超過6.3;相加總合不得低於4.2)' })!
    expect(s.model_code).toBe('LM2U50')
    expect(s.rules[0]).toMatchObject({ indoor_count: null, unit_max_kw: 4.1, total_max_kw: 6.3, total_min_kw: 4.2 })
  })
  it('室外機價格欄位不允許送入', async () => {
    await expect(transformSystems([row(2, { ...r3, 室外機原價: '77,900' })])).rejects.toBeInstanceOf(ForbiddenColumnError)
  })
  it('完整快照', async () => {
    const t = await transformSnapshot({ products: [row(2, { 產品型號: 'WD-S2220B 黑' })], multiSplit: [row(2, r3)] })
    expect(t.products).toHaveLength(1)
    expect(t.systems[0].source_key).toBe('一對多報價:LM3U90')
  })
})
