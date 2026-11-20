/** 確認要貼到 Supabase 的單檔版：與原始碼一致，而且實際執行時驗證、白名單、寫入流程都正常 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { hmacHex } from '../../supabase/functions/product-sync/handler.ts'
// @ts-expect-error JS 模組
import { bundle } from '../../scripts/bundle-sync.mjs'

const FILE = 'supabase/functions/product-sync/dist/product-sync.bundle.ts'
const SECRET = 'bundle-secret-0123456789abcdef0123456789abcdef'

describe('Edge Function 單檔版', () => {
  it('與目前原始碼一致（不是舊版）', async () => {
    expect(readFileSync(FILE, 'utf8')).toBe(await bundle(false))
  })

  it('在模擬的 Deno 環境實際執行', async () => {
    let served: ((r: Request) => Promise<Response>) | null = null
    const env: Record<string, string> = { PRODUCT_SYNC_SECRET: SECRET, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }
    ;(globalThis as any).Deno = { serve: (h: any) => (served = h), env: { get: (k: string) => env[k] } }
    const sent: any[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ status: 'success', counts: {}, diff: {} }), { status: 200 })
    }) as any
    try {
      await import(/* @vite-ignore */ `../../${FILE}?t=${Date.now()}`)
      expect(served).toBeTypeOf('function')
      const body = JSON.stringify({ dataset: 'staging', mode: 'preview', trigger: 'test', products: { rows: [{ row: 2, values: { 產品型號: 'WD-S2220B 黑', 安裝尺寸: '寬70;高189;深83' } }] } })
      const ts = String(Date.now()), rid = 'bundle-test-0123456789'
      const ok = await served!(new Request('https://x', { method: 'POST', body, headers: { 'x-sync-timestamp': ts, 'x-sync-request-id': rid, 'x-sync-signature': await hmacHex(SECRET, `${ts}.${rid}.${body}`) } }))
      expect(ok.status).toBe(200)
      expect(sent[0].p.products[0].specs.width_cm).toBe(70)
      const bad = await served!(new Request('https://x', { method: 'POST', body, headers: { 'x-sync-timestamp': ts, 'x-sync-request-id': rid, 'x-sync-signature': '0'.repeat(64) } }))
      expect(bad.status).toBe(401)
    } finally {
      globalThis.fetch = realFetch
      delete (globalThis as any).Deno
    }
  })
})
