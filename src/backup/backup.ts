/**
 * 完整備份與還原（與 PNG 報告是不同功能）
 *
 * 備份檔：ZIP
 *   backup.json        全部場勘、區域、照片中繼資料（含版本號）
 *   photos/{id}.jpg    原始照片（壓縮後上傳的那一份）
 *
 * 還原：以 UUID 比對，已存在的資料一律略過，不會重複建立。
 * 新資料寫入本機並排入同步佇列；若雲端已有相同 ID，同步引擎會比對內容（相同即視為已同步，不同則列為衝突）。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db } from '../db/db'
import type { Survey, SurveyArea, SurveyPhoto, SurveyProduct } from '../db/types'
import { ensurePhotoBlob } from '../sync/engine'

export const BACKUP_FORMAT = 'home-survey-pro-backup'
/** v2：新增 products（場勘選擇的產品與規格快照）；仍可還原 v1 */
export const BACKUP_VERSION = 2

type Strip<T> = Omit<T, '_dirty' | '_baseRevision' | '_syncError' | '_blobState'>
export interface BackupJson {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  app: string
  account: { user_id: string; email: string | null }
  counts: { surveys: number; areas: number; photos: number; photoFiles: number; products?: number }
  missingPhotoFiles: string[]
  surveys: Strip<Survey>[]
  areas: Strip<SurveyArea>[]
  photos: Strip<SurveyPhoto>[]
  /** v2 起才有 */
  products?: Strip<SurveyProduct>[]
}

function strip<T extends object>(row: T): Strip<T & { _dirty: 0; _baseRevision: 0 }> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) out[k] = v
  return out as never
}

async function collect(userId: string) {
  const surveys = (await db.surveys.where('user_id').equals(userId).toArray()).filter((s) => !s.deleted_at)
  const ids = new Set(surveys.map((s) => s.id))
  const areas = (await db.survey_areas.where('user_id').equals(userId).toArray()).filter((a) => !a.deleted_at && ids.has(a.survey_id))
  const areaIds = new Set(areas.map((a) => a.id))
  const photos = (await db.survey_photos.where('user_id').equals(userId).toArray()).filter((p) => !p.deleted_at && areaIds.has(p.area_id))
  const products = (await db.survey_products.where('user_id').equals(userId).toArray()).filter((p) => !p.deleted_at && ids.has(p.survey_id))
  return { surveys, areas, photos, products }
}

export async function buildBackupJson(userId: string, email: string | null, photoFiles: number, missing: string[]): Promise<BackupJson> {
  const { surveys, areas, photos, products } = await collect(userId)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: '家電場勘助手 Pro',
    account: { user_id: userId, email },
    counts: { surveys: surveys.length, areas: areas.length, photos: photos.length, photoFiles, products: products.length },
    missingPhotoFiles: missing,
    surveys: surveys.map(strip),
    areas: areas.map(strip),
    photos: photos.map(strip),
    products: products.map(strip),
  }
}

/** 只匯出 JSON（不含照片檔） */
export async function exportJson(userId: string, email: string | null): Promise<Blob> {
  const json = await buildBackupJson(userId, email, 0, [])
  return new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
}

/** 完整備份 ZIP（含原始照片）；尚未下載到本機的照片會先從雲端下載 */
export async function exportZip(userId: string, email: string | null, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; json: BackupJson }> {
  const { photos } = await collect(userId)
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {}
  const missing: string[] = []
  for (let i = 0; i < photos.length; i++) {
    onProgress?.(i, photos.length)
    const b = await ensurePhotoBlob(photos[i].id)
    if (!b) missing.push(photos[i].id)
    else files[`photos/${photos[i].id}.jpg`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }] // JPEG 已壓縮
  }
  onProgress?.(photos.length, photos.length)
  const json = await buildBackupJson(userId, email, photos.length - missing.length, missing)
  files['backup.json'] = [strToU8(JSON.stringify(json, null, 2)), { level: 6 }]
  files['README.txt'] = [strToU8('家電場勘助手 Pro 完整備份\n請在 App「設定 → 從備份還原」選擇此 ZIP 檔。\n已存在的資料不會重複匯入。\n'), { level: 6 }]
  return { blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), json }
}

// ---------------------------------------------------------------------------
// 還原
// ---------------------------------------------------------------------------
export interface RestorePlan {
  json: BackupJson
  photoFiles: Map<string, Uint8Array>
  newSurveys: Strip<Survey>[]
  newAreas: Strip<SurveyArea>[]
  newPhotos: Strip<SurveyPhoto>[]
  newProducts: Strip<SurveyProduct>[]
  skipped: { surveys: number; areas: number; photos: number; products: number }
  photosWithoutFile: number
  otherAccount: boolean
  /** 備份內 ID → 寫入本機的 ID（同帳號相同；不同帳號換成新 UUID，並記住對應避免重複匯入） */
  idMap: Map<string, string>
}

export async function readBackup(file: File, userId: string): Promise<RestorePlan> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let json: BackupJson
  const photoFiles = new Map<string, Uint8Array>()
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b
  if (isZip) {
    const entries = unzipSync(buf)
    if (!entries['backup.json']) throw new Error('這個 ZIP 不是場勘備份檔（找不到 backup.json）')
    json = JSON.parse(strFromU8(entries['backup.json']))
    for (const [name, data] of Object.entries(entries)) {
      const m = name.match(/^photos\/([0-9a-f-]{36})\.jpg$/i)
      if (m) photoFiles.set(m[1], data)
    }
  } else {
    try {
      json = JSON.parse(strFromU8(buf))
    } catch {
      throw new Error('無法讀取檔案：請選擇 .zip 或 .json 備份檔')
    }
  }
  if (json?.format !== BACKUP_FORMAT) throw new Error('這不是家電場勘助手的備份檔')
  if (json.version > BACKUP_VERSION) throw new Error('備份檔版本較新，請先更新 App')

  const otherAccount = json.account?.user_id !== userId
  // 不同帳號：雲端已有同 ID 的資料屬於原帳號，因此改用新 UUID，並記住對應關係
  const idMap = new Map<string, string>()
  const jsonProducts = json.products ?? [] // v1 備份沒有 products
  const all = [...json.surveys, ...json.areas, ...json.photos, ...jsonProducts]
  if (otherAccount) {
    const keys = all.map((r) => `restored:${userId}:${r.id}`)
    const prev = await db.meta.bulkGet(keys)
    all.forEach((r, i) => idMap.set(r.id, (prev[i]?.value as string | undefined) ?? crypto.randomUUID()))
  } else all.forEach((r) => idMap.set(r.id, r.id))

  // 以 UUID 比對本機既有資料（含已刪除的，避免把刪除的資料救回來）
  const has = async (t: 'surveys' | 'survey_areas' | 'survey_photos' | 'survey_products', ids: string[]) =>
    new Set((await (db.table(t) as import('dexie').Table<{ id: string }, string>).bulkGet(ids.map((i) => idMap.get(i)!))).filter(Boolean).map((r) => r!.id))
  const sHas = await has('surveys', json.surveys.map((s) => s.id))
  const aHas = await has('survey_areas', json.areas.map((a) => a.id))
  const pHas = await has('survey_photos', json.photos.map((p) => p.id))
  const prHas = await has('survey_products', jsonProducts.map((p) => p.id))
  const exists = (set: Set<string>, id: string) => set.has(idMap.get(id)!)
  const newPhotosAll = json.photos.filter((p) => !exists(pHas, p.id))
  const newPhotos = newPhotosAll.filter((p) => photoFiles.has(p.id))
  return {
    json,
    photoFiles,
    newSurveys: json.surveys.filter((s) => !exists(sHas, s.id)),
    newAreas: json.areas.filter((a) => !exists(aHas, a.id)),
    newPhotos,
    newProducts: jsonProducts.filter((p) => !exists(prHas, p.id)),
    skipped: { surveys: sHas.size, areas: aHas.size, photos: pHas.size, products: prHas.size },
    photosWithoutFile: newPhotosAll.length - newPhotos.length,
    otherAccount,
    idMap,
  }
}

/** 執行還原：全部在一個 transaction，要嘛全部成功、要嘛完全不變 */
export async function applyRestore(plan: RestorePlan, userId: string): Promise<{ surveys: number; areas: number; photos: number; products: number }> {
  const now = new Date().toISOString()
  const local = { _dirty: 1 as const, _baseRevision: 0, _syncError: null, revision: 0 }
  const m = (id: string) => plan.idMap.get(id) ?? id
  await db.transaction('rw', [db.surveys, db.survey_areas, db.survey_photos, db.survey_products, db.photoBlobs, db.outbox, db.meta], async () => {
    const enqueue = (table: 'surveys' | 'survey_areas' | 'survey_photos' | 'survey_products', id: string) =>
      db.outbox.put({ key: `${table}:${id}`, table, rowId: id, userId, createdAt: Date.now(), attempts: 0, lastError: null })
    const remember = (oldId: string) => (plan.otherAccount ? db.meta.put({ key: `restored:${userId}:${oldId}`, value: m(oldId) }) : undefined)
    for (const s of plan.newSurveys) {
      await db.surveys.add({ ...(s as Survey), ...local, id: m(s.id), user_id: userId, team_id: null, updated_at: now } as Survey)
      await enqueue('surveys', m(s.id))
      await remember(s.id)
    }
    for (const a of plan.newAreas) {
      await db.survey_areas.add({ ...(a as SurveyArea), ...local, id: m(a.id), survey_id: m(a.survey_id), user_id: userId, updated_at: now })
      await enqueue('survey_areas', m(a.id))
      await remember(a.id)
    }
    for (const sp of plan.newProducts) {
      // 規格快照原封不動還原（不會改用目前產品知識庫的規格）
      await db.survey_products.add({ ...(sp as SurveyProduct), ...local, id: m(sp.id), survey_id: m(sp.survey_id), user_id: userId, updated_at: now })
      await enqueue('survey_products', m(sp.id))
      await remember(sp.id)
    }
    for (const p of plan.newPhotos) {
      const data = plan.photoFiles.get(p.id)!
      const id = m(p.id)
      await db.photoBlobs.put({ id, blob: new Blob([data as BlobPart], { type: 'image/jpeg' }) })
      await db.survey_photos.add({
        ...(p as SurveyPhoto),
        ...local,
        id,
        survey_id: m(p.survey_id),
        area_id: m(p.area_id),
        user_id: userId,
        storage_path: `${userId}/${m(p.survey_id)}/${id}.jpg`,
        updated_at: now,
        _blobState: 'pending',
      })
      await enqueue('survey_photos', id)
      await remember(p.id)
    }
  })
  return { surveys: plan.newSurveys.length, areas: plan.newAreas.length, photos: plan.newPhotos.length, products: plan.newProducts.length }
}
