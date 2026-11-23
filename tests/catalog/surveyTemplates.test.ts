/** survey_templates + survey_photos.shot_key：帳號隔離、唯一性、無法硬刪除（需要本機 PostgreSQL，見 db.test.ts） */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

const url = process.env.CATALOG_TEST_PG
const d = url ? describe : describe.skip
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const SID = 'aaaaaaaa-0000-4000-8000-00000000d001'
const TID = 'aaaaaaaa-0000-4000-8000-00000000d0f1'
let c: pg.Client
const as = async (uid: string) => {
  await c.query('reset role')
  await c.query('set role authenticated')
  await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
}

d('survey_templates', () => {
  beforeAll(async () => {
    c = new pg.Client({ connectionString: url })
    await c.connect()
    await c.query(`insert into auth.users values ($1,'a@t'),($2,'b@t') on conflict do nothing`, [A, B])
    await c.query(`delete from survey_templates where survey_id=$1`, [SID])
    await c.query(`delete from surveys where id=$1`, [SID])
    await as(A)
    await c.query(`insert into surveys (id, customer_name) values ($1, '模板測試')`, [SID])
  })
  afterAll(async () => c?.end())

  it('建立與更新（revision 遞增）', async () => {
    await c.query(`insert into survey_templates (id, survey_id, template_id, template_version, "values") values ($1,$2,'washer',1,$3)`, [TID, SID, JSON.stringify({ stacked: 'no', front_clearance_cm: 80 })])
    await c.query(`update survey_templates set "values" = "values" || '{"faucet":"yes"}' where id=$1`, [TID])
    const r = await c.query(`select "values"->>'faucet' f, revision from survey_templates where id=$1`, [TID])
    expect(r.rows[0]).toEqual({ f: 'yes', revision: 2 })
  })

  it('同一場勘同一模板只能一筆；欄位格式受檢查', async () => {
    await expect(c.query(`insert into survey_templates (id, survey_id, template_id, template_version) values (gen_random_uuid(),$1,'washer',1)`, [SID])).rejects.toThrow(/unique/)
    await expect(c.query(`insert into survey_templates (id, survey_id, template_id, template_version) values (gen_random_uuid(),$1,'Bad Id',1)`, [SID])).rejects.toThrow(/check/)
    await expect(c.query(`insert into survey_templates (id, survey_id, template_id, template_version, "values") values (gen_random_uuid(),$1,'x',1,'[1]')`, [SID])).rejects.toThrow(/check/)
  })

  it('其他帳號看不到、改不了、也無法塞資料到別人的場勘', async () => {
    await as(B)
    expect((await c.query(`select * from survey_templates`)).rows).toHaveLength(0)
    expect((await c.query(`update survey_templates set template_version=9 where id=$1 returning id`, [TID])).rows).toHaveLength(0)
    await expect(c.query(`insert into survey_templates (id, survey_id, template_id, template_version) values (gen_random_uuid(),$1,'fridge',1)`, [SID])).rejects.toThrow(/row-level security/)
  })

  it('不能硬刪除（只能軟刪除）', async () => {
    await as(A)
    await expect(c.query(`delete from survey_templates where id=$1`, [TID])).rejects.toThrow(/permission denied/)
    await c.query(`update survey_templates set deleted_at=now() where id=$1`, [TID])
    await c.query('reset role')
  })

  it('照片 shot_key：可為空、格式受檢查', async () => {
    const r = await c.query(`select column_name, is_nullable from information_schema.columns where table_name='survey_photos' and column_name='shot_key'`)
    expect(r.rows[0]).toEqual({ column_name: 'shot_key', is_nullable: 'YES' })
    const k = await c.query(`select pg_get_constraintdef(oid) def from pg_constraint where conname='survey_photos_shot_key_chk'`)
    expect(k.rows[0].def).toContain('shot_key')
  })
})
