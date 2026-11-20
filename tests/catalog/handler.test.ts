import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { handle, hmacHex } from '../../supabase/functions/product-sync/handler.ts'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const env = { PRODUCT_SYNC_SECRET: SECRET, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }
let n = 0

async function signed(body: unknown, opts: { ts?: number; secret?: string; tamper?: boolean; rid?: string } = {}) {
  const ts = String(opts.ts ?? Date.now())
  const rid = opts.rid ?? `req-${Date.now()}-${n++}-abcdefgh`
  const text = JSON.stringify(body)
  const sig = await hmacHex(opts.secret ?? SECRET, `${ts}.${rid}.${text}`)
  return new Request('https://x/functions/v1/product-sync', {
    method: 'POST',
    headers: { 'x-sync-timestamp': ts, 'x-sync-request-id': rid, 'x-sync-signature': sig },
    body: opts.tamper ? text.replace('WD-S2220B', 'WD-S9999X') : text,
  })
}

const goodBody = (extra: Record<string, unknown> = {}) => ({
  dataset: 'staging',
  mode: 'sync',
  trigger: 'test',
  spreadsheet_id: 'sheet-1',
  products: {
    rows: [
      { row: 2, values: { 產品型號: 'WD-S2220B   AI智控洗乾衣機 $99999', 分類: '洗衣機', 安裝尺寸: '寬70;高189;深83\n進排水管長度100' } },
      { row: 3, values: { 產品型號: 'LSU93DHP/LSN93DHP 旗艦9.3KW', 分類: '冷氣/空調', 安裝尺寸: '' } },
    ],
  },
  multi_split: { rows: [{ row: 2, values: { 室外機型號: '一對二 室外機 LM2U50(5.2KW)', 室內機1: 'LSN22DDHST極淨2.2KW $11900', 備註: null } }] },
  ...extra,
})

/** 假的 PostgREST：記錄請求；若有本機 DB 則真的呼叫 RPC */
const calls: { fn: string; body: any }[] = []
let db: pg.Client | null = null
const fakeFetch = (async (url: string, init: RequestInit) => {
  const fn = String(url).split('/rpc/')[1]
  const body = JSON.parse(String(init.body))
  calls.push({ fn, body })
  if (fn === 'catalog_apply_snapshot' && body.p.products.some((p: any) => p.model_code === 'FAIL-ME1'))
    return new Response('{"message":"simulated database failure"}', { status: 500 })
  if (!db) return new Response(JSON.stringify(fn === 'catalog_record_failed_run' ? 'id' : { status: 'success', counts: {}, diff: {} }), { status: 200 })
  try {
    const r = await db.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(body.p)])
    return new Response(JSON.stringify(r.rows[0].r), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 })
  }
}) as unknown as typeof fetch

describe('product-sync Edge Function', () => {
  beforeAll(async () => {
    if (process.env.CATALOG_TEST_PG) {
      db = new pg.Client({ connectionString: process.env.CATALOG_TEST_PG })
      await db.connect()
      await db.query('set role service_role')
      await db.query("delete from catalog_products where dataset='staging'")
      await db.query("delete from catalog_multi_split_systems where dataset='staging'")
      await db.query("delete from catalog_sync_runs where dataset='staging'")
      await db.query("delete from catalog_sync_nonces where request_id like 'replay-%'")
    }
  })
  afterAll(async () => db?.end())

  it('只接受 POST', async () => {
    expect((await handle(new Request('https://x', { method: 'GET' }), env, fakeFetch)).status).toBe(405)
  })
  it('沒有簽章、錯誤密鑰、本文被竄改 → 401', async () => {
    expect((await handle(new Request('https://x', { method: 'POST', body: '{}' }), env, fakeFetch)).status).toBe(401)
    expect((await handle(await signed(goodBody(), { secret: 'wrong-secret-0123456789abcdef0123456789' }), env, fakeFetch)).status).toBe(401)
    expect((await handle(await signed(goodBody(), { tamper: true }), env, fakeFetch)).status).toBe(401)
  })
  it('一般使用者的 JWT 不被接受', async () => {
    const req = new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer eyJhbGciOi.user.jwt' }, body: '{}' })
    expect((await handle(req, env, fakeFetch)).status).toBe(401)
  })
  it('過期的請求（超過 5 分鐘）→ 401', async () => {
    expect((await handle(await signed(goodBody(), { ts: Date.now() - 6 * 60 * 1000 }), env, fakeFetch)).status).toBe(401)
  })
  it('伺服器沒有設定密鑰 → 500，不處理', async () => {
    expect((await handle(await signed(goodBody()), { ...env, PRODUCT_SYNC_SECRET: '' }, fakeFetch)).status).toBe(500)
  })
  it('含價格欄位 → 400 整批拒絕，不呼叫寫入', async () => {
    calls.length = 0
    const bad = goodBody()
    ;(bad.products.rows[0].values as any)['產品原價'] = '114900'
    const res = await handle(await signed(bad), env, fakeFetch)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('產品原價')
    expect(calls.some((c) => c.fn === 'catalog_apply_snapshot')).toBe(false)
  })
  it('不允許的頂層欄位（例如白名單、業績）→ 400', async () => {
    expect((await handle(await signed(goodBody({ whitelist: [{ name: 'x' }] })), env, fakeFetch)).status).toBe(400)
  })
  it('成功：送進資料庫的內容不含任何價格', async () => {
    calls.length = 0
    const res = await handle(await signed(goodBody()), env, fakeFetch)
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.status).toBe('success')
    const sent = JSON.stringify(calls.find((c) => c.fn === 'catalog_apply_snapshot')!.body)
    expect(sent).not.toMatch(/99999|11900|\$/)
    expect(sent).toContain('LSN22DDHST')
  })
  it('相同資料再送一次 → unchanged（冪等）', async () => {
    if (!db) return
    const res = await handle(await signed(goodBody()), env, fakeFetch)
    expect((await res.json()).status).toBe('unchanged')
  })
  it('同一個 request id 重送（重放攻擊）→ 拒絕', async () => {
    if (!db) return
    const rid = 'replay-test-0123456789'
    await handle(await signed(goodBody({ mode: 'preview' }), { rid }), env, fakeFetch)
    const res = await handle(await signed(goodBody({ mode: 'preview' }), { rid }), env, fakeFetch)
    expect(res.status).toBe(502)
  })
  it('資料庫寫入失敗 → 502，記錄失敗紀錄，回報既有資料未變更', async () => {
    calls.length = 0
    const b = goodBody()
    b.products.rows.push({ row: 9, values: { 產品型號: 'FAIL-ME1 x', 分類: 'x', 安裝尺寸: '' } })
    const res = await handle(await signed(b), env, fakeFetch)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('既有資料未變更')
    expect(calls.map((c) => c.fn)).toEqual(['catalog_apply_snapshot', 'catalog_record_failed_run'])
  })
})
