/**
 * product-sync：接收 Google Apps Script 送來的產品資料快照
 *
 * 安全
 * - 不接受一般使用者 JWT；只接受 HMAC-SHA256 簽章的請求：
 *     X-Sync-Timestamp: 毫秒時間戳（±5 分鐘內有效）
 *     X-Sync-Request-Id: 每次請求唯一（資料庫防重放）
 *     X-Sync-Signature: hex(HMAC_SHA256(PRODUCT_SYNC_SECRET, `${timestamp}.${requestId}.${body}`))
 * - 只接受白名單欄位；出現價格、促銷、LINE、業績等欄位 → 整批拒絕
 * - 寫入透過 service role 呼叫單一交易 RPC；失敗不會改動既有資料
 *
 * 只用 Web 標準 API（fetch、crypto.subtle），可在 Deno（Edge Function）與 Node（測試）執行。
 */
import { ForbiddenColumnError, sha256, transformSnapshot, type SheetRow } from '../_shared/catalog/transform.ts'

export interface Env {
  PRODUCT_SYNC_SECRET?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

const MAX_BODY = 2_000_000
const MAX_SKEW_MS = 5 * 60 * 1000
const TOP_KEYS = new Set(['dataset', 'mode', 'trigger', 'force', 'spreadsheet_id', 'sent_at', 'products', 'multi_split'])
const MODES = new Set(['sync', 'full', 'preview'])
const TRIGGERS = new Set(['edit', 'schedule', 'manual', 'full', 'preview', 'test'])

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function readRows(section: unknown, name: string): SheetRow[] {
  if (section === undefined) return []
  const s = section as { rows?: unknown }
  if (!s || typeof s !== 'object' || !Array.isArray(s.rows)) throw new BadRequest(`${name}.rows 必須是陣列`)
  return s.rows.map((r, i) => {
    const row = r as { row?: unknown; values?: unknown }
    if (!row || typeof row.row !== 'number' || !row.values || typeof row.values !== 'object') throw new BadRequest(`${name}.rows[${i}] 格式錯誤`)
    const values: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(row.values as Record<string, unknown>)) {
      if (v !== null && typeof v !== 'string' && typeof v !== 'number') throw new BadRequest(`${name}.rows[${i}].${k} 必須是文字`)
      values[k] = v === null ? null : String(v)
    }
    return { row: row.row, values }
  })
}
class BadRequest extends Error {}

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const secret = env.PRODUCT_SYNC_SECRET
  if (!secret || secret.length < 32 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: '伺服器尚未設定同步密鑰' })

  // --- 驗證來源 ---
  const ts = req.headers.get('x-sync-timestamp') ?? ''
  const requestId = req.headers.get('x-sync-request-id') ?? ''
  const signature = (req.headers.get('x-sync-signature') ?? '').toLowerCase()
  if (!/^\d{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId) || !/^[0-9a-f]{64}$/.test(signature)) return json(401, { error: 'unauthorized' })
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return json(401, { error: 'request expired' })
  const body = await req.text()
  if (body.length > MAX_BODY) return json(413, { error: 'payload too large' })
  const expected = await hmacHex(secret, `${ts}.${requestId}.${body}`)
  if (!safeEqual(expected, signature)) return json(401, { error: 'unauthorized' })

  // --- 解析與白名單 ---
  let payload: Record<string, unknown>
  let meta: Record<string, unknown> = {}
  try {
    payload = JSON.parse(body)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BadRequest('本文必須是 JSON 物件')
    for (const k of Object.keys(payload)) if (!TOP_KEYS.has(k)) throw new BadRequest(`不允許的欄位：${k}`)
    const dataset = String(payload.dataset ?? 'production')
    const mode = String(payload.mode ?? 'sync')
    const trigger = String(payload.trigger ?? 'manual')
    if (!['production', 'staging'].includes(dataset)) throw new BadRequest('dataset 錯誤')
    if (!MODES.has(mode)) throw new BadRequest('mode 錯誤')
    if (!TRIGGERS.has(trigger)) throw new BadRequest('trigger 錯誤')
    meta = { request_id: requestId, dataset, mode, trigger, spreadsheet_id: typeof payload.spreadsheet_id === 'string' ? payload.spreadsheet_id.slice(0, 100) : null, started_at: new Date(now).toISOString() }
    const t = await transformSnapshot({ products: readRows(payload.products, 'products'), multiSplit: readRows(payload.multi_split, 'multi_split') })
    const sourceHash = await sha256({ p: t.products.map((p) => p.content_hash).sort(), s: t.systems.map((s) => s.content_hash).sort() })
    const rpcBody = {
      p: { ...meta, force: payload.force === true, source_hash: sourceHash, products: t.products, systems: t.systems, warnings: t.warnings },
    }

    // --- 寫入（單一交易） ---
    const res = await rpc(fetchImpl, env, 'catalog_apply_snapshot', rpcBody)
    if (!res.ok) {
      const err = await res.text()
      await rpc(fetchImpl, env, 'catalog_record_failed_run', { p: { ...meta, source_hash: sourceHash, warnings: t.warnings, error: err } }).catch(() => {})
      return json(502, { status: 'failed', error: '寫入資料庫失敗，既有資料未變更', detail: err.slice(0, 500) })
    }
    const result = await res.json()
    // 待確認／無法解析的明細（只回傳給呼叫端顯示，不另外儲存）
    const review = t.products
      .filter((p) => p.data_quality === 'needs_review' || p.data_quality === 'invalid')
      .map((p) => ({ row: p.source_row, model: p.model_code, quality: p.data_quality, issues: p.parse_issues.map((i) => (i.line ? `${i.message}：${i.line}` : i.message)) }))
    return json(200, { ...result, warnings: t.warnings, skipped_rows: t.skippedRows, review })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ForbiddenColumnError || e instanceof BadRequest || e instanceof SyntaxError) {
      if (meta.request_id) await rpc(fetchImpl, env, 'catalog_record_failed_run', { p: { ...meta, error: msg } }).catch(() => {})
      return json(400, { status: 'failed', error: msg })
    }
    if (meta.request_id) await rpc(fetchImpl, env, 'catalog_record_failed_run', { p: { ...meta, error: msg } }).catch(() => {})
    return json(500, { status: 'failed', error: '同步失敗，既有資料未變更', detail: msg.slice(0, 500) })
  }
}

function rpc(fetchImpl: typeof fetch, env: Env, fn: string, body: unknown) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' }
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}` // 舊版 JWT 型金鑰
  return fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

export { hmacHex }
