/**
 * 同步引擎：IndexedDB ⇄ Supabase
 *
 * Push：依 outbox 逐筆送出，使用 revision 樂觀鎖
 *   - 新資料：INSERT … ON CONFLICT DO NOTHING
 *   - 既有資料：UPDATE … WHERE id = ? AND revision = base
 *   - 0 筆 → 讀取雲端版本；內容相同視為已同步，不同則記錄衝突（不覆蓋任何一邊）
 * Pull：依 server_updated_at 增量下載（往回重疊 2 分鐘，避免交易提交順序漏抓）
 */
import { db } from '../db/db'
import { onLocalChange } from '../db/repo'
import type { BaseRow, ConflictItem, OutboxItem, TableName } from '../db/types'
import { supabase } from '../lib/supabase'

/** 各資料表要送到雲端的欄位（其他欄位由伺服器維護或只存在本機） */
export const COLUMNS: Record<TableName, string[]> = {
  surveys: ['id', 'user_id', 'customer_name', 'customer_phone', 'survey_date', 'customer_address', 'product', 'product_model', 'notes', 'deleted_at'],
  survey_areas: ['id', 'survey_id', 'user_id', 'kind', 'name', 'width_cm', 'depth_cm', 'height_cm', 'notes', 'sort_order', 'deleted_at'],
  survey_photos: ['id', 'survey_id', 'area_id', 'user_id', 'storage_path', 'caption', 'sort_order', 'width', 'height', 'size_bytes', 'mime_type', 'shot_key', 'deleted_at'],
  survey_products: ['id', 'survey_id', 'user_id', 'catalog_product_id', 'model_code', 'display_name', 'category', 'spec_snapshot', 'snapshot_at', 'catalog_spec_hash', 'catalog_spec_updated_at', 'sort_order', 'spec_overrides', 'template_type', 'deleted_at'],
  survey_templates: ['id', 'survey_id', 'user_id', 'template_id', 'template_version', 'install_area_id', 'values', 'deleted_at'],
}
/** 比對內容是否相同時忽略的欄位 */
const COMPARE_IGNORE = new Set(['id', 'user_id'])
const TABLE_ORDER: TableName[] = ['surveys', 'survey_areas', 'survey_products', 'survey_templates', 'survey_photos']
const PULL_OVERLAP_MS = 2 * 60 * 1000
const PAGE = 500
export const BUCKET = 'survey-photos'
/** 最近幾天內更新過的場勘，照片會在背景下載到本機（離線可看） */
const PREFETCH_DAYS = 14

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncState {
  phase: SyncPhase
  pending: number
  conflicts: number
  lastSyncedAt: number | null
  lastError: string | null
}

// ---------------------------------------------------------------------------
// 狀態（供 React 以 useSyncExternalStore 訂閱）
// ---------------------------------------------------------------------------
let state: SyncState = { phase: 'idle', pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null }
const subs = new Set<() => void>()
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
export const syncStore = {
  get: () => state,
  subscribe: (f: () => void) => {
    subs.add(f)
    return () => subs.delete(f)
  },
}

function pick(row: Record<string, unknown>, table: TableName) {
  const out: Record<string, unknown> = {}
  for (const c of COLUMNS[table]) out[c] = row[c] ?? null
  return out
}

function norm(v: unknown): unknown {
  if (v === undefined || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).getTime() // 時間格式差異
  if (v !== null && typeof v === 'object') return canonicalJson(v) // 物件（例如規格快照）以內容比較；資料庫 jsonb 會重排鍵的順序
  return v
}
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

export function sameContent(table: TableName, a: Record<string, unknown>, b: Record<string, unknown>) {
  return COLUMNS[table].every((c) => COMPARE_IGNORE.has(c) || norm(a[c]) === norm(b[c]))
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  return /failed to fetch|network|load failed|fetch failed|timeout/i.test(msg)
}

function errText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

class NetworkDown extends Error {}

const tableOf = (t: TableName) => db.table(t) as unknown as import('dexie').Table<BaseRow & Record<string, unknown>, string>

/** 遠端資料寫入本機（標記為已同步） */
function fromRemote(table: TableName, r: Record<string, unknown>, local?: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...r, _dirty: 0, _baseRevision: r.revision as number, _syncError: null }
  if (table === 'survey_photos') row._blobState = local?._blobState === 'uploaded' || local?._blobState === 'pending' ? 'uploaded' : 'remote-only'
  return row
}

async function recordConflict(item: OutboxItem | { table: TableName; rowId: string; userId: string }, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const c: ConflictItem = {
    key: `${item.table}:${item.rowId}`,
    table: item.table,
    rowId: item.rowId,
    userId: item.userId,
    local,
    remote,
    detectedAt: Date.now(),
  }
  await db.conflicts.put(c)
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------
async function pushOne(item: OutboxItem): Promise<void> {
  const sb = supabase!
  const t = tableOf(item.table)
  const local = await t.get(item.rowId)
  if (!local) {
    await db.outbox.delete(item.key)
    return
  }
  if (await db.conflicts.get(item.key)) return // 等待使用者處理衝突

  if (item.table === 'survey_photos') {
    // 從未上傳就被刪除：雲端沒有這筆，不需要送出
    if (local.deleted_at && local._baseRevision === 0) {
      await db.outbox.delete(item.key)
      await t.update(item.rowId, { _dirty: 0, _syncError: null })
      return
    }
    // 先上傳照片檔案，成功後才送出資料列；本機檔案保留不刪除
    if (!local.deleted_at && local._blobState === 'pending') {
      await uploadBlob(local)
      local._blobState = 'uploaded'
    }
  }

  const snapshotUpdatedAt = local.updated_at
  const payload = pick(local, item.table)
  let remote: Record<string, unknown> | null = null

  if (local._baseRevision === 0) {
    const { data, error } = await sb.from(item.table).upsert(payload, { onConflict: 'id', ignoreDuplicates: true }).select()
    if (error) throw error
    remote = data?.[0] ?? null
  } else {
    const { data, error } = await sb.from(item.table).update(payload).eq('id', item.rowId).eq('revision', local._baseRevision).select()
    if (error) throw error
    remote = data?.[0] ?? null
  }

  if (!remote) {
    // 沒寫進去：可能已存在（上次回應遺失）或被其他裝置改過
    const { data, error } = await sb.from(item.table).select('*').eq('id', item.rowId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('雲端找不到這筆資料，或沒有權限寫入')
    if (sameContent(item.table, local, data)) {
      remote = data
    } else {
      await recordConflict(item, local, data)
      await t.update(item.rowId, { _syncError: null })
      return
    }
  }

  // 照片已確認刪除：移除雲端檔案（失敗不影響，下次可再清）
  if (item.table === 'survey_photos' && remote!.deleted_at) {
    await sb.storage.from(BUCKET).remove([remote!.storage_path as string]).catch(() => {})
  }

  await markPushed(item, snapshotUpdatedAt, remote!)
}

/** 推送成功：若送出期間本機又被修改，保留 dirty 讓下一輪再送 */
async function markPushed(item: OutboxItem, snapshotUpdatedAt: string, remote: Record<string, unknown>) {
  const t = tableOf(item.table)
  await db.transaction('rw', t, db.outbox, async () => {
    const cur = await t.get(item.rowId)
    if (!cur) return
    if (cur.updated_at === snapshotUpdatedAt) {
      await t.put(fromRemote(item.table, remote, cur) as never)
      await db.outbox.delete(item.key)
    } else {
      await t.update(item.rowId, { _baseRevision: remote.revision as number, revision: remote.revision as number, _syncError: null })
    }
  })
}

async function uploadBlob(local: Record<string, unknown>) {
  const id = local.id as string
  const b = await db.photoBlobs.get(id)
  if (!b) throw new Error('本機找不到這張照片的檔案')
  const { error } = await supabase!.storage.from(BUCKET).upload(local.storage_path as string, b.blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw error
  await tableOf('survey_photos').update(id, { _blobState: 'uploaded' })
}

/** 有限並行 */
async function parallel<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

/**
 * 批次新增：從未上傳過的資料一次送出（每批 200 筆），大幅縮短大量離線資料或還原後的同步時間。
 * 回傳需要逐筆處理的項目（更新、刪除、已存在或批次失敗）。
 */
async function pushNewInBatch(table: TableName, items: OutboxItem[], onError: (it: OutboxItem, err: unknown) => Promise<void>): Promise<OutboxItem[]> {
  const t = tableOf(table)
  const rows = await t.bulkGet(items.map((i) => i.rowId))
  const conflicted = new Set((await db.conflicts.bulkGet(items.map((i) => i.key))).filter(Boolean).map((c) => c!.key))
  const rest: OutboxItem[] = []
  let cand: [OutboxItem, BaseRow & Record<string, unknown>][] = []
  items.forEach((it, k) => {
    const r = rows[k]
    if (r && r._baseRevision === 0 && !r.deleted_at && !conflicted.has(it.key)) cand.push([it, r])
    else rest.push(it)
  })
  if (table === 'survey_photos') {
    // 照片檔案 4 張並行上傳；失敗的留給逐筆流程顯示錯誤
    const ok: typeof cand = []
    await parallel(cand, 4, async ([it, r]) => {
      try {
        if (r._blobState === 'pending') {
          await uploadBlob(r)
          r._blobState = 'uploaded'
        }
        ok.push([it, r])
      } catch (err) {
        if (isNetworkError(err)) throw new NetworkDown(errText(err))
        await onError(it, err)
      }
    })
    cand = ok
  }
  for (let k = 0; k < cand.length; k += 200) {
    const chunk = cand.slice(k, k + 200)
    const { data, error } = await supabase!.from(table).upsert(chunk.map(([, r]) => pick(r, table)), { onConflict: 'id', ignoreDuplicates: true }).select()
    if (error) {
      if (isNetworkError(error)) throw new NetworkDown(errText(error))
      rest.push(...chunk.map(([it]) => it)) // 例如其中一筆違反權限：改為逐筆找出是哪一筆
      continue
    }
    const got = new Map((data ?? []).map((d) => [d.id as string, d]))
    const existing: [OutboxItem, BaseRow & Record<string, unknown>][] = []
    for (const [it, r] of chunk) {
      const remote = got.get(it.rowId)
      if (remote) await markPushed(it, r.updated_at, remote)
      else existing.push([it, r])
    }
    // 雲端已有同 ID（例如回應遺失後重送、從備份還原）：一次讀回比對內容
    if (existing.length) {
      const { data: found, error: e2 } = await supabase!.from(table).select('*').in('id', existing.map(([it]) => it.rowId))
      if (e2) {
        if (isNetworkError(e2)) throw new NetworkDown(errText(e2))
        rest.push(...existing.map(([it]) => it))
        continue
      }
      const byId = new Map((found ?? []).map((d) => [d.id as string, d]))
      for (const [it, r] of existing) {
        const remote = byId.get(it.rowId)
        if (!remote) rest.push(it)
        else if (sameContent(table, r, remote)) await markPushed(it, r.updated_at, remote)
        else await recordConflict(it, r, remote)
      }
    }
  }
  return rest
}

async function push(userId: string) {
  const items = await db.outbox.where('userId').equals(userId).toArray()
  let failures = 0
  const onError = async (item: OutboxItem, err: unknown) => {
    failures++
    const msg = errText(err)
    await db.outbox.update(item.key, { attempts: item.attempts + 1, lastError: msg })
    await tableOf(item.table).update(item.rowId, { _syncError: msg })
    setState({ lastError: msg })
  }
  for (const table of TABLE_ORDER) {
    const mine = items.filter((i) => i.table === table).sort((a, b) => a.createdAt - b.createdAt)
    if (!mine.length) continue
    const rest = await pushNewInBatch(table, mine, onError)
    for (const item of rest) {
      try {
        await pushOne(item)
      } catch (err) {
        if (err instanceof NetworkDown || isNetworkError(err)) throw new NetworkDown(errText(err))
        await onError(item, err)
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
async function mergeRemote(table: TableName, userId: string, r: Record<string, unknown>) {
  const t = tableOf(table)
  const local = await t.get(r.id as string)
  if (!local) {
    await t.put(fromRemote(table, r) as never)
    return
  }
  const remoteRev = r.revision as number
  if (remoteRev <= local._baseRevision) return // 本機已經是這個版本或更新
  if (!local._dirty) {
    await t.put(fromRemote(table, r, local) as never)
    return
  }
  // 本機有未送出的修改，雲端也被改過
  if (sameContent(table, local, r)) {
    await t.update(local.id, { _baseRevision: remoteRev, revision: remoteRev })
    return
  }
  if (!(await db.conflicts.get(`${table}:${local.id}`))) await recordConflict({ table, rowId: local.id, userId }, local, r)
}

async function pull(userId: string) {
  const sb = supabase!
  for (const table of TABLE_ORDER) {
    const cursorKey = `cursor:${userId}:${table}`
    const cursor = (await db.meta.get(cursorKey))?.value as string | undefined
    let since = cursor ? new Date(new Date(cursor).getTime() - PULL_OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z'
    let maxSeen = cursor ?? null
    for (;;) {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .gt('server_updated_at', since)
        .order('server_updated_at', { ascending: true })
        .limit(PAGE)
      if (error) throw error
      if (!data?.length) break
      await db.transaction('rw', tableOf(table), db.conflicts, async () => {
        for (const r of data) await mergeRemote(table, userId, r)
      })
      const last = data[data.length - 1].server_updated_at as string
      if (!maxSeen || last > maxSeen) maxSeen = last
      if (data.length < PAGE) break
      since = last
    }
    if (maxSeen) await db.meta.put({ key: cursorKey, value: maxSeen })
  }
}

// ---------------------------------------------------------------------------
// 照片下載（雲端 → 本機快取）
// ---------------------------------------------------------------------------
const downloading = new Map<string, Promise<Blob | null>>()

/** 取得照片檔案：本機有就用本機，沒有就從雲端下載並快取 */
export function ensurePhotoBlob(photoId: string): Promise<Blob | null> {
  const existing = downloading.get(photoId)
  if (existing) return existing
  const job = (async () => {
    const local = await db.photoBlobs.get(photoId)
    if (local) return local.blob
    const p = await db.survey_photos.get(photoId)
    if (!p || !supabase || !navigator.onLine) return null
    const { data, error } = await supabase.storage.from(BUCKET).download(p.storage_path)
    if (error || !data) return null
    await db.transaction('rw', db.photoBlobs, db.survey_photos, async () => {
      await db.photoBlobs.put({ id: photoId, blob: data })
      const cur = await db.survey_photos.get(photoId)
      if (cur && cur._blobState === 'remote-only') await db.survey_photos.update(photoId, { _blobState: 'uploaded' })
    })
    return data
  })().finally(() => downloading.delete(photoId))
  downloading.set(photoId, job)
  return job
}

async function prefetchPhotos(userId: string) {
  const since = new Date(Date.now() - PREFETCH_DAYS * 86400000).toISOString()
  const recent = new Set((await db.surveys.where('user_id').equals(userId).toArray()).filter((s) => !s.deleted_at && s.updated_at >= since).map((s) => s.id))
  const todo = (await db.survey_photos.where('_blobState').equals('remote-only').toArray()).filter((p) => p.user_id === userId && !p.deleted_at && recent.has(p.survey_id))
  await parallel(todo, 3, async (p) => {
    if (!navigator.onLine || currentUser !== userId) return
    await ensurePhotoBlob(p.id)
  })
}

// ---------------------------------------------------------------------------
// 排程
// ---------------------------------------------------------------------------
let currentUser: string | null = null
let running = false
let again = false
let debounceTimer: number | undefined

async function refreshCounts() {
  if (!currentUser) return
  const [pending, conflicts] = await Promise.all([
    db.outbox.where('userId').equals(currentUser).count(),
    db.conflicts.where('userId').equals(currentUser).count(),
  ])
  setState({ pending, conflicts })
}

export async function syncNow(): Promise<void> {
  if (!currentUser || !supabase) return
  if (running) {
    again = true
    return
  }
  running = true
  const userId = currentUser
  try {
    do {
      again = false
      await refreshCounts()
      if (!navigator.onLine) {
        setState({ phase: 'offline' })
        return
      }
      setState({ phase: 'syncing' })
      try {
        const failures = await push(userId)
        await pull(userId)
        // pull 可能解除了衝突前提，再送一次剩下的
        await refreshCounts()
        setState({ phase: failures ? 'error' : 'idle', lastSyncedAt: Date.now(), ...(failures ? {} : { lastError: null }) })
        void prefetchPhotos(userId)
      } catch (err) {
        if (err instanceof NetworkDown || isNetworkError(err)) setState({ phase: 'offline', lastError: null })
        else setState({ phase: 'error', lastError: errText(err) })
      }
    } while (again && currentUser === userId)
  } finally {
    running = false
    await refreshCounts()
  }
}

function schedule(delay = 1500) {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => void syncNow(), delay)
}

/** 登入後啟動；回傳停止函式 */
export function startSync(userId: string): () => void {
  currentUser = userId
  setState({ phase: 'idle', lastError: null })
  const onOnline = () => schedule(300)
  const onOffline = () => setState({ phase: 'offline' })
  const onVisible = () => document.visibilityState === 'visible' && schedule(300)
  const unsubLocal = onLocalChange(() => {
    void refreshCounts()
    schedule()
  })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const interval = window.setInterval(() => void syncNow(), 60_000)
  void syncNow()
  return () => {
    currentUser = null
    unsubLocal()
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(interval)
    window.clearTimeout(debounceTimer)
  }
}

/** 手動重試：清除錯誤標記後立即同步 */
export async function retrySync() {
  if (!currentUser) return
  const items = await db.outbox.where('userId').equals(currentUser).toArray()
  for (const i of items) if (i.lastError) await tableOf(i.table).update(i.rowId, { _syncError: null })
  await syncNow()
}

// ---------------------------------------------------------------------------
// 衝突處理
// ---------------------------------------------------------------------------
export async function resolveConflict(key: string, choice: 'local' | 'remote') {
  const c = await db.conflicts.get(key)
  if (!c) return
  const t = tableOf(c.table)
  const remoteRev = c.remote.revision as number
  await db.transaction('rw', t, db.conflicts, db.outbox, async () => {
    const cur = await t.get(c.rowId)
    if (choice === 'remote' || !cur) {
      await t.put(fromRemote(c.table, c.remote, cur) as never)
      await db.outbox.delete(key)
    } else {
      // 採用此裝置版本：以雲端最新 revision 為基準重新送出
      await t.put({ ...cur, _baseRevision: remoteRev, _dirty: 1, _syncError: null })
      await db.outbox.put({ key, table: c.table, rowId: c.rowId, userId: c.userId, createdAt: Date.now(), attempts: 0, lastError: null })
    }
    await db.conflicts.delete(key)
  })
  await refreshCounts()
  schedule(100)
}
