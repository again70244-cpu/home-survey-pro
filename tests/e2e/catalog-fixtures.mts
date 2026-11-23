import { transformSnapshot } from '../../supabase/functions/_shared/catalog/transform.ts'
import { writeFileSync } from 'node:fs'
const R = (row: number, m: string, c: string, i = '', img = '') => ({ row, values: { 產品型號: m, 分類: c, 安裝尺寸: i, 圖片網址: img } as Record<string, string | null> })
const W = '寬70;高189;深83\n門開90度總深146\n電源線長度120\n進排水管長度100\n外箱尺寸寬75;高200;深86'
const rows = [
  R(2, 'LSU22DHST/LSN22DDHST 極淨(新) 2.2KW', '冷氣/空調'),
  R(3, 'LSU28DHST/LSN28DDHST 極淨(新) 2.8KW', '冷氣/空調'),
  R(27, 'WD-S2220B                         AI智控洗乾衣機/22洗20乾/尊爵黑', '洗衣機', W, 'https://i.ibb.co/xtshnSJk/LG-AI-WD-S2220-B.png，https://i.ibb.co/QjTKM5jg/image.png'),
  R(28, 'WD-S2220CG                      AI智控洗乾衣機/22洗20乾/珍珠灰/網購禁售', '洗衣機', W),
  R(33, 'WD-S13VDW  滾筒/蒸洗脫烘/WIFI/13KG冰磁白', '洗衣機', '寬60;高85;深61.5\n門開90度總深113.5\n電源線長度120\n進排水管長度100\n外箱尺寸寬65;高89;深70.5'),
  R(42, 'WT-SD250HB  MINI洗衣機/2.5KG/尊爵黑/加熱', '洗衣機', '寬68.9;高36.5;深77\n全開總深125(搭S22FHDB)\n電源線長度120\n外箱尺寸寬74.4;高47.7;深84.7'),
  R(58, 'R723MB  冰箱', '冰箱', '寬83;高179;深75\n門開90度總深125 總寬85\n電源線長度160(插頭+總線長)'),
  R(64, 'GR-AQC82BS  對開冰箱', '冰箱', '寬91.2;高179;深73.5\n門開90度總深126 總寬144.2\n抽屜全開總深140.6\n拆門總深76.4'),
  R(110, 'OLED83G5PTA  83吋', '電視', '寬186;高106.7'),
  R(111, 'OLED42C6PTA  42吋', '電視', '寬93.2;高54;深17(含底座)'),
]
const ms = [{ row: 2, values: { 室外機型號: '一對二 室外機 LM2U50(5.2KW)', 室內機1: 'LSN22DDHST極淨2.2KW $11900', 室內機2: 'LSN28DDHST極淨2.8KW  $12500', 備註: '搭配室內機2.2~4.1(相加總合不得超過6.3;相加總合不得低於4.2)' } }]
const t = await transformSnapshot({ products: rows, multiSplit: ms })
const now = '2026-11-23T15:00:00.000Z'
let n = 0
const products = t.products.map((p) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, dataset: 'production', source_key: p.source_key, source_row: p.source_row, model_code: p.model_code, model_raw: p.model_raw,
  description: p.description, display_name: p.display_name, category: p.category, category_raw: p.category_raw, image_urls: p.image_urls, link_urls: p.link_urls, video_urls: p.video_urls,
  maintenance_notes: p.maintenance_notes, install_text_raw: p.install_text_raw, ...p.specs, install_extra: p.install_extra, parse_issues: p.parse_issues, data_quality: p.data_quality,
  is_active: true, deactivated_at: null, content_hash: p.content_hash, spec_hash: p.spec_hash, revision: 1, first_seen_at: now, last_synced_at: now, last_changed_at: now, spec_updated_at: now,
}))
products.push({ ...products[1], id: '00000000-0000-4000-8000-000000000099', source_key: '報價:WD-OLD1', model_code: 'WD-OLD1', is_active: false, deactivated_at: now })
const systems = t.systems.map((s, i) => ({ id: `10000000-0000-4000-8000-00000000000${i + 1}`, dataset: 'production', source_key: s.source_key, model_code: s.model_code, outdoor_text: s.outdoor_text, capacity_kw: s.capacity_kw, indoor_counts: s.indoor_counts, notes: s.notes, rules: s.rules, issues: s.issues, is_active: true, last_synced_at: now, last_changed_at: now, catalog_multi_split_indoor_units: s.indoor_units }))
const runs = [{ id: 'run-2', status: 'success', trigger: 'edit', finished_at: now, error: null, counts: {} }]
writeFileSync(process.argv[2], JSON.stringify({ products, systems, runs }))
console.log('products', products.length, 'systems', systems.length, products.map((p) => p.data_quality).join(','))
