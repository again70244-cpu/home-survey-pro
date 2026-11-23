/**
 * 資料庫 RPC 測試（需要本機 PostgreSQL；未設定 CATALOG_TEST_PG 時自動略過）
 *   CATALOG_TEST_PG="postgres://postgres@/t?host=/var/tmp/hsp-pg&port=54329" npx vitest run tests/catalog/db.test.ts
 * 資料庫需先依序執行：supabase/tests/supabase_stub.sql、init migration、patch、product_catalog、catalog_more_specs migration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { transformSnapshot, type SheetRow } from '../../supabase/functions/_shared/catalog/transform.ts'

const url = process.env.CATALOG_TEST_PG
const d = url ? describe : describe.skip

const P = (n: number, model: string, cat: string, install = '') => ({ row: n, values: { 產品型號: model, 分類: cat, 安裝尺寸: install } as Record<string, string | null> })
const BASE: SheetRow[] = [
  P(2, 'LSU93DHP/LSN93DHP 旗艦9.3KW', '冷氣/空調'),
  P(3, 'WD-S2220B   AI智控洗乾衣機/22洗20乾/尊爵黑', '洗衣機', '寬70;高189;深83\n門開90度總深146\n電源線長度120\n進排水管長度100\n外箱尺寸寬75;高200;深86'),
  P(4, 'WD-S13VDW  滾筒/蒸洗脫烘/WIFI/13KG冰磁白', '洗衣機', '寬60;高85;深61.5\n門開90度總深113.5'),
  P(5, 'WT-SD250HB  MINI洗衣機', '洗衣機', '寬68.9;高36.5;深77\n全開總深125(搭S22FHDB)'),
  P(6, 'LWP-25N24 抽屜櫃', '洗衣機', '???'),
]
const MS: SheetRow[] = [
  { row: 2, values: { 室外機型號: '一對二 室外機 LM2U50(5.2KW)', 室內機1: 'LSN22DDHST極淨2.2KW $11900', 室內機2: 'LSN28DDHST極淨2.8KW $12500', 備註: '搭配室內機2.2~4.1(相加總合不得超過6.3;相加總合不得低於4.2)' } },
]

let client: pg.Client
let seq = 0
async function apply(rows: SheetRow[], opts: { mode?: string; force?: boolean; dataset?: string; ms?: SheetRow[]; request_id?: string; hack?: (p: any) => void } = {}) {
  const t = await transformSnapshot({ products: rows, multiSplit: opts.ms ?? MS })
  const p: any = {
    request_id: opts.request_id ?? `test-${Date.now()}-${seq++}`,
    dataset: opts.dataset ?? 'production',
    mode: opts.mode ?? 'sync',
    trigger: 'manual',
    force: opts.force ?? false,
    source_hash: JSON.stringify(t.products.map((x) => x.content_hash).concat(t.systems.map((s) => s.content_hash))),
    products: t.products,
    systems: t.systems,
    warnings: t.warnings,
  }
  opts.hack?.(p)
  const r = await client.query('select public.catalog_apply_snapshot($1::jsonb) as r', [JSON.stringify(p)])
  return r.rows[0].r
}
const q = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows

d('catalog_apply_snapshot', () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: url })
    await client.connect()
    await client.query('set role service_role')
    await client.query("delete from catalog_products where dataset='production'")
    await client.query("delete from catalog_multi_split_systems where dataset='production'")
    await client.query("delete from catalog_sync_runs where dataset='production'")
    await client.query("delete from catalog_products where dataset='staging' and model_code like 'ZZ-%'")
    await client.query("delete from catalog_sync_nonces where request_id like 'replay-%'")
  })
  afterAll(async () => client?.end())

  it('第一次同步：全部新增', async () => {
    const r = await apply(BASE)
    expect(r.status).toBe('success')
    expect(r.diff.products.added).toHaveLength(5)
    expect(r.counts).toMatchObject({ products: 5, missing: 1, complete: 3, needs_review: 0, invalid: 1, systems: 1 })
    const [w] = await q("select width_cm, inlet_drain_hose_cm, water_inlet_hose_cm, drain_hose_cm, data_quality from catalog_products where dataset='production' and model_code='WD-S2220B'")
    expect(w).toMatchObject({ width_cm: '70.0', inlet_drain_hose_cm: '100.0', water_inlet_hose_cm: null, drain_hose_cm: null, data_quality: 'complete' })
    const [ac] = await q("select width_cm, data_quality from catalog_products where dataset='production' and model_code='LSU93DHP/LSN93DHP'")
    expect(ac).toEqual({ width_cm: null, data_quality: 'missing' }) // 缺少尺寸不補 0
    const indoor = await q("select u.model_code, u.capacity_kw, u.source_text from catalog_multi_split_indoor_units u join catalog_multi_split_systems s on s.id=u.system_id where s.dataset='production' order by u.position")
    expect(indoor.map((i) => i.model_code)).toEqual(['LSN22DDHST', 'LSN28DDHST'])
    expect(JSON.stringify(indoor)).not.toContain('$')
  })

  it('相同資料再同步：unchanged，不產生重複資料', async () => {
    const r = await apply(BASE)
    expect(r.status).toBe('unchanged')
    expect((await q("select count(*)::int n from catalog_products where dataset='production'"))[0].n).toBe(5)
    const f = await apply(BASE, { mode: 'full' }) // 完整重新同步：重新套用，但仍不重複
    expect(f.status).toBe('success')
    expect(f.diff.products.updated).toEqual([])
    expect((await q("select count(*)::int n, max(revision) r from catalog_products where dataset='production'"))[0]).toEqual({ n: 5, r: 1 })
  })

  it('修改尺寸：spec_updated_at 更新、revision +1；只改分類：規格時間不變', async () => {
    const [before] = await q("select spec_updated_at, last_changed_at from catalog_products where dataset='production' and model_code='WD-S13VDW'")
    const rows = BASE.map((r) => (r.row === 4 ? P(4, 'WD-S13VDW  滾筒', '洗衣機', '寬61;高85;深61.5\n門開90度總深113.5') : r.row === 2 ? P(2, 'LSU93DHP/LSN93DHP 旗艦9.3KW', '冷氣') : r))
    const r = await apply(rows)
    expect(r.diff.products.spec_changed).toEqual(['報價:WD-S13VDW'])
    expect(r.diff.products.updated.sort()).toEqual(['報價:LSU93DHP/LSN93DHP', '報價:WD-S13VDW'])
    const [after] = await q("select width_cm, spec_updated_at, revision from catalog_products where dataset='production' and model_code='WD-S13VDW'")
    expect(after.width_cm).toBe('61.0')
    expect(after.revision).toBe(2)
    expect(after.spec_updated_at > before.spec_updated_at).toBe(true)
    const [ac] = await q("select category, spec_updated_at, last_changed_at from catalog_products where dataset='production' and model_code='LSU93DHP/LSN93DHP'")
    expect(ac.category).toBe('冷氣')
    expect(+ac.last_changed_at).toBeGreaterThan(+ac.spec_updated_at) // 只改分類，規格更新時間不動
    BASE.splice(0, BASE.length, ...rows)
  })

  it('刪除一筆：停用（軟刪除），資料保留；重新出現時恢復啟用', async () => {
    const r = await apply(BASE.filter((x) => x.row !== 6))
    expect(r.diff.products.deactivated).toEqual(['報價:LWP-25N24'])
    expect((await q("select is_active, deactivated_at is not null d from catalog_products where dataset='production' and model_code='LWP-25N24'"))[0]).toEqual({ is_active: false, d: true })
    expect((await q("select count(*)::int n from catalog_products where dataset='production'"))[0].n).toBe(5) // 沒有真的刪掉
    const back = await apply(BASE)
    expect(back.diff.products.reactivated).toEqual(['報價:LWP-25N24'])
    expect((await q("select is_active from catalog_products where dataset='production' and model_code='LWP-25N24'"))[0].is_active).toBe(true)
  })

  it('異常保護：空快照或減少超過 30% → rejected，既有資料不變；force 才套用', async () => {
    const empty = await apply([])
    expect(empty.status).toBe('rejected')
    const half = await apply(BASE.slice(0, 2))
    expect(half.status).toBe('rejected')
    expect((await q("select count(*)::int n from catalog_products where dataset='production' and is_active"))[0].n).toBe(5)
    const [run] = await q("select error from catalog_sync_runs where status='rejected' order by finished_at desc limit 1")
    expect(run.error).toContain('少超過 30%')
    const forced = await apply(BASE.slice(0, 2), { force: true })
    expect(forced.status).toBe('success')
    expect((await q("select count(*)::int n from catalog_products where dataset='production' and is_active"))[0].n).toBe(2)
    await apply(BASE, { force: true })
  })

  it('預覽（差異檢查）：只回報、不寫入', async () => {
    const r = await apply([...BASE, P(9, 'WD-NEW1 新產品', '洗衣機', '寬1;高2;深3')], { mode: 'preview' })
    expect(r.status).toBe('preview')
    expect(r.diff.products.added).toEqual(['報價:WD-NEW1'])
    expect((await q("select count(*)::int n from catalog_products where dataset='production' and model_code='WD-NEW1'"))[0].n).toBe(0)
  })

  it('中途錯誤（資料違反約束）：整批回復，原有資料完整保留', async () => {
    const before = await q("select source_key, content_hash, is_active from catalog_products where dataset='production' order by source_key")
    await expect(
      apply([...BASE.slice(0, 2), P(9, 'WD-NEW2 x', '洗衣機', '寬1;高2;深3')], {
        force: true,
        hack: (p) => (p.products[p.products.length - 1].specs.width_cm = -5), // 違反 check (width_cm >= 0)
      }),
    ).rejects.toThrow(/check constraint/)
    await client.query('rollback').catch(() => {})
    expect(await q("select source_key, content_hash, is_active from catalog_products where dataset='production' order by source_key")).toEqual(before)
    expect((await q("select count(*)::int n from catalog_products where dataset='production' and model_code='WD-NEW2'"))[0].n).toBe(0)
  })

  it('重試：失敗後以相同資料重新同步成功', async () => {
    const r = await apply([...BASE, P(9, 'WD-NEW2 x', '洗衣機', '寬1;高2;深3')])
    expect(r.status).toBe('success')
    expect(r.diff.products.added).toEqual(['報價:WD-NEW2'])
  })

  it('防重放：同一個 request_id 第二次被拒絕', async () => {
    await apply(BASE, { request_id: 'replay-1', mode: 'preview' })
    await expect(apply(BASE, { request_id: 'replay-1', mode: 'preview' })).rejects.toThrow(/duplicate key/)
  })

  it('staging 與 production 分開：測試資料不影響正式資料', async () => {
    const r = await apply([P(2, 'ZZ-TEST1 測試', '洗衣機')], { dataset: 'staging', force: true })
    expect(r.status).toBe('success')
    expect((await q("select dataset from catalog_products where model_code='ZZ-TEST1'"))[0].dataset).toBe('staging')
    expect((await q("select count(*)::int n from catalog_products where dataset='production' and is_active"))[0].n).toBe(6)
  })

  it('冰箱新欄位：門開90度總寬、拆門總深、抽屜全開總深都寫入資料庫', async () => {
    const fridge = P(20, 'GR-AQC82BS 冰箱', '冰箱', '寬91.2;高179;深73.5\n門開90度總深126 總寬144.2\n抽屜全開總深140.6\n拆門總深76.4\n電源線長度160(插頭+總線長)')
    const r = await apply([...BASE, fridge])
    expect(r.status).toBe('success')
    const [f] = await q("select door_open_90_depth_cm, door_open_90_width_cm, door_removed_depth_cm, drawer_open_depth_cm, full_open_depth_cm, power_cable_cm, data_quality, install_extra->'conditions' c from catalog_products where dataset='production' and model_code='GR-AQC82BS'")
    expect(f).toMatchObject({ door_open_90_depth_cm: '126.0', door_open_90_width_cm: '144.2', door_removed_depth_cm: '76.4', drawer_open_depth_cm: '140.6', full_open_depth_cm: null, power_cable_cm: '160.0', data_quality: 'complete' })
    expect(f.c[0].condition).toBe('插頭+總線長')
    BASE.push(fridge)
  })

  it('權限：登入使用者只能讀 production；不能寫、不能呼叫同步；匿名完全不能讀', async () => {
    await client.query('reset role')
    await client.query('set role authenticated')
    const rows = await q('select model_code from catalog_products')
    expect(rows.some((r) => r.model_code === 'ZZ-TEST1')).toBe(false)
    expect(rows.length).toBe(7)
    await expect(client.query("insert into catalog_products (source_key, model_code, model_raw, content_hash, spec_hash) values ('x','x','x','x','x')")).rejects.toThrow(/permission denied/)
    await expect(client.query("update catalog_products set category='hacked'")).rejects.toThrow(/permission denied/)
    await expect(client.query("select public.catalog_apply_snapshot('{}'::jsonb)")).rejects.toThrow(/permission denied/)
    await expect(client.query('select * from catalog_sync_nonces')).rejects.toThrow(/permission denied/)
    await client.query('reset role')
    await client.query('set role anon')
    await expect(client.query('select * from catalog_products')).rejects.toThrow(/permission denied/)
    await client.query('reset role')
    await client.query('set role service_role')
  })
})
