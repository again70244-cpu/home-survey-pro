/** survey_products：快照不可變、帳號隔離、無法硬刪除（需要本機 PostgreSQL，見 db.test.ts） */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

const url = process.env.CATALOG_TEST_PG
const d = url ? describe : describe.skip
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const SID = 'aaaaaaaa-0000-4000-8000-00000000c001'
const PID = 'aaaaaaaa-0000-4000-8000-00000000c0f1'
let c: pg.Client
const as = async (uid: string) => {
  await c.query('reset role')
  await c.query('set role authenticated')
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
}

d('survey_products', () => {
  beforeAll(async () => {
    c = new pg.Client({ connectionString: url })
    await c.connect()
    await c.query(`insert into auth.users values ($1,'a@t'),($2,'b@t') on conflict do nothing`, [A, B])
    await c.query(`delete from survey_products where id=$1`, [PID])
    await c.query(`delete from surveys where id=$1`, [SID])
    await as(A)
    await c.query(`insert into surveys (id, customer_name) values ($1, '快照測試')`, [SID])
  })
  afterAll(async () => c?.end())

  it('建立快照', async () => {
    await c.query(
      `insert into survey_products (id, survey_id, model_code, spec_snapshot, snapshot_at, catalog_spec_hash) values ($1,$2,'WD-S2220B',$3,now(),'h1')`,
      [PID, SID, JSON.stringify({ width_cm: 70, height_cm: 189 })],
    )
    const r = await c.query(`select spec_snapshot->>'width_cm' w, revision from survey_products where id=$1`, [PID])
    expect(r.rows[0]).toEqual({ w: '70', revision: 1 })
  })

  it('快照不可變：嘗試改寫規格，資料庫保留原值；其他欄位（排序、刪除標記）仍可更新', async () => {
    await c.query(`update survey_products set spec_snapshot='{"width_cm":71}', model_code='HACK', catalog_spec_hash='h2', sort_order=5 where id=$1`, [PID])
    const r = await c.query(`select spec_snapshot->>'width_cm' w, model_code, catalog_spec_hash, sort_order, revision from survey_products where id=$1`, [PID])
    expect(r.rows[0]).toEqual({ w: '70', model_code: 'WD-S2220B', catalog_spec_hash: 'h1', sort_order: 5, revision: 2 })
  })

  it('其他帳號看不到、改不了、也無法塞資料到別人的場勘', async () => {
    await as(B)
    expect((await c.query(`select * from survey_products`)).rows).toHaveLength(0)
    expect((await c.query(`update survey_products set sort_order=9 where id=$1 returning id`, [PID])).rows).toHaveLength(0)
    await expect(
      c.query(`insert into survey_products (id, survey_id, model_code, spec_snapshot, snapshot_at) values (gen_random_uuid(),$1,'X','{}',now())`, [SID]),
    ).rejects.toThrow(/row-level security/)
  })

  it('不能硬刪除（只能軟刪除）', async () => {
    await as(A)
    await expect(c.query(`delete from survey_products where id=$1`, [PID])).rejects.toThrow(/permission denied/)
    await c.query(`update survey_products set deleted_at=now() where id=$1`, [PID])
    expect((await c.query(`select deleted_at is not null d, spec_snapshot->>'width_cm' w from survey_products where id=$1`, [PID])).rows[0]).toEqual({ d: true, w: '70' })
    await c.query('reset role')
  })
})
