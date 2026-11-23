import Dexie from 'dexie'
import { db } from './db'
import type { CatalogProduct } from '../catalog/types'
import type { ProductSpecSnapshot, SurveyProduct, SurveyTemplate } from './types'
import { SPEC_FIELDS } from '../../supabase/functions/_shared/catalog/installText.ts'
import type { AreaKind, OutboxItem, Survey, SurveyArea, TableName } from './types'

const nowIso = () => new Date().toISOString()
export const uuid = () => crypto.randomUUID()

/** 把一筆修改放進同步佇列（同一筆資料只保留一個待送項目） */
async function enqueue(table: TableName, rowId: string, userId: string) {
  const key = `${table}:${rowId}`
  const existing = await db.outbox.get(key)
  const item: OutboxItem = existing
    ? { ...existing, attempts: 0, lastError: null }
    : { key, table, rowId, userId, createdAt: Date.now(), attempts: 0, lastError: null }
  await db.outbox.put(item)
  notifyChange()
}

/** 同步引擎訂閱此事件，資料寫入後自動排程同步 */
const listeners = new Set<() => void>()
export function onLocalChange(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notifyChange() {
  // 必須跳出目前的 Dexie transaction，否則監聽者讀其他資料表會出錯
  Dexie.ignoreTransaction(() => setTimeout(() => listeners.forEach((fn) => fn()), 0))
}

export type SurveyInput = Pick<
  Survey,
  'customer_name' | 'customer_phone' | 'survey_date' | 'customer_address' | 'product' | 'product_model' | 'notes'
>

export const DEFAULT_AREAS: { kind: AreaKind; name: string }[] = [
  { kind: 'balcony', name: '陽台' },
  { kind: 'elevator', name: '電梯' },
  { kind: 'stairs', name: '樓梯' },
]

function newArea(userId: string, surveyId: string, kind: AreaKind, name: string, sort: number): SurveyArea {
  const t = nowIso()
  return {
    id: uuid(),
    survey_id: surveyId,
    user_id: userId,
    kind,
    name,
    width_cm: null,
    depth_cm: null,
    height_cm: null,
    notes: null,
    sort_order: sort,
    revision: 0,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    _dirty: 1,
    _baseRevision: 0,
  }
}

/** 新增場勘（含預設區域）。回傳新 ID。資料寫入 IndexedDB 成功才 resolve */
export async function createSurvey(userId: string, input: SurveyInput): Promise<string> {
  const id = uuid()
  const t = nowIso()
  const survey: Survey = {
    id,
    user_id: userId,
    ...input,
    revision: 0,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    _dirty: 1,
    _baseRevision: 0,
  }
  const areas = DEFAULT_AREAS.map((a, i) => newArea(userId, id, a.kind, a.name, i))
  await db.transaction('rw', db.surveys, db.survey_areas, db.outbox, async () => {
    await db.surveys.add(survey)
    await enqueue('surveys', id, userId)
    for (const a of areas) {
      await db.survey_areas.add(a)
      await enqueue('survey_areas', a.id, userId)
    }
  })
  return id
}

export async function updateSurvey(id: string, patch: Partial<SurveyInput>): Promise<void> {
  await db.transaction('rw', db.surveys, db.outbox, async () => {
    const s = await db.surveys.get(id)
    if (!s) throw new Error('找不到這筆場勘')
    await db.surveys.put({ ...s, ...patch, updated_at: nowIso(), _dirty: 1 })
    await enqueue('surveys', id, s.user_id)
  })
}

/** 軟刪除場勘（含其區域與照片），同步到雲端後其他裝置也會隱藏 */
export async function deleteSurvey(id: string): Promise<void> {
  const t = nowIso()
  await db.transaction('rw', [db.surveys, db.survey_areas, db.survey_photos, db.survey_products, db.survey_templates, db.outbox], async () => {
    const s = await db.surveys.get(id)
    if (!s) return
    for (const st of await db.survey_templates.where('survey_id').equals(id).toArray()) {
      if (st.deleted_at) continue
      await db.survey_templates.put({ ...st, deleted_at: t, updated_at: t, _dirty: 1 })
      await enqueue('survey_templates', st.id, st.user_id)
    }
    for (const sp of await db.survey_products.where('survey_id').equals(id).toArray()) {
      if (sp.deleted_at) continue
      await db.survey_products.put({ ...sp, deleted_at: t, updated_at: t, _dirty: 1 })
      await enqueue('survey_products', sp.id, sp.user_id)
    }
    await db.surveys.put({ ...s, deleted_at: t, updated_at: t, _dirty: 1 })
    await enqueue('surveys', id, s.user_id)
    const areas = await db.survey_areas.where('survey_id').equals(id).toArray()
    for (const a of areas) {
      if (a.deleted_at) continue
      await db.survey_areas.put({ ...a, deleted_at: t, updated_at: t, _dirty: 1 })
      await enqueue('survey_areas', a.id, a.user_id)
    }
    const photos = await db.survey_photos.where('survey_id').equals(id).toArray()
    for (const p of photos) {
      if (p.deleted_at) continue
      await db.survey_photos.put({ ...p, deleted_at: t, updated_at: t, _dirty: 1 })
      await enqueue('survey_photos', p.id, p.user_id)
    }
  })
}

export function emptySurveyInput(): SurveyInput {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  return {
    customer_name: '',
    customer_phone: null,
    survey_date: local,
    customer_address: null,
    product: null,
    product_model: null,
    notes: null,
  }
}

// ---------------------------------------------------------------------------
// 區域管理
// ---------------------------------------------------------------------------
export type AreaPatch = Partial<Pick<SurveyArea, 'name' | 'width_cm' | 'depth_cm' | 'height_cm' | 'notes'>>

/** 「其他」區域的常用名稱 */
export const OTHER_AREA_PRESETS = ['大門', '玄關', '走廊', '轉角', '安裝位置']

async function liveAreas(surveyId: string) {
  return (await db.survey_areas.where('survey_id').equals(surveyId).toArray())
    .filter((a) => !a.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order)
}

export async function addArea(surveyId: string, kind: AreaKind, name: string): Promise<string> {
  let newId = ''
  await db.transaction('rw', db.surveys, db.survey_areas, db.outbox, async () => {
    const s = await db.surveys.get(surveyId)
    if (!s) throw new Error('找不到這筆場勘')
    const areas = await liveAreas(surveyId)
    const sort = areas.length ? areas[areas.length - 1].sort_order + 1 : 0
    const a = newArea(s.user_id, surveyId, kind, name.trim() || '自訂區域', sort)
    newId = a.id
    await db.survey_areas.add(a)
    await enqueue('survey_areas', a.id, s.user_id)
  })
  return newId
}

export async function updateArea(id: string, patch: AreaPatch): Promise<void> {
  await db.transaction('rw', db.survey_areas, db.outbox, async () => {
    const a = await db.survey_areas.get(id)
    if (!a) throw new Error('找不到這個區域')
    await db.survey_areas.put({ ...a, ...patch, updated_at: nowIso(), _dirty: 1 })
    await enqueue('survey_areas', id, a.user_id)
  })
}

/** 軟刪除區域與其照片 */
export async function deleteArea(id: string): Promise<void> {
  const t = nowIso()
  await db.transaction('rw', db.survey_areas, db.survey_photos, db.outbox, async () => {
    const a = await db.survey_areas.get(id)
    if (!a || a.deleted_at) return
    await db.survey_areas.put({ ...a, deleted_at: t, updated_at: t, _dirty: 1 })
    await enqueue('survey_areas', id, a.user_id)
    for (const p of await db.survey_photos.where('area_id').equals(id).toArray()) {
      if (p.deleted_at) continue
      await db.survey_photos.put({ ...p, deleted_at: t, updated_at: t, _dirty: 1 })
      await enqueue('survey_photos', p.id, p.user_id)
    }
  })
}

/** 上移 / 下移一格；重新編號並只同步有變動的區域 */
export async function moveArea(surveyId: string, id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.survey_areas, db.outbox, async () => {
    const areas = await liveAreas(surveyId)
    const i = areas.findIndex((a) => a.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= areas.length) return
    ;[areas[i], areas[j]] = [areas[j], areas[i]]
    const t = nowIso()
    for (let k = 0; k < areas.length; k++) {
      if (areas[k].sort_order === k) continue
      await db.survey_areas.put({ ...areas[k], sort_order: k, updated_at: t, _dirty: 1 })
      await enqueue('survey_areas', areas[k].id, areas[k].user_id)
    }
  })
}

// ---------------------------------------------------------------------------
// 照片
// ---------------------------------------------------------------------------
export async function addPhoto(areaId: string, img: { blob: Blob; width: number; height: number }, shotKey: string | null = null): Promise<string> {
  const id = uuid()
  await db.transaction('rw', db.survey_areas, db.survey_photos, db.photoBlobs, db.outbox, async () => {
    const a = await db.survey_areas.get(areaId)
    if (!a) throw new Error('找不到這個區域')
    const siblings = (await db.survey_photos.where('area_id').equals(areaId).toArray()).filter((p) => !p.deleted_at)
    const t = nowIso()
    // 先存照片本體，再存資料列：兩者在同一個 transaction，成功才算「已儲存」
    await db.photoBlobs.put({ id, blob: img.blob })
    await db.survey_photos.add({
      id,
      survey_id: a.survey_id,
      area_id: areaId,
      user_id: a.user_id,
      storage_path: `${a.user_id}/${a.survey_id}/${id}.jpg`,
      caption: null,
      sort_order: siblings.length ? Math.max(...siblings.map((p) => p.sort_order)) + 1 : 0,
      width: img.width,
      height: img.height,
      size_bytes: img.blob.size,
      mime_type: 'image/jpeg',
      shot_key: shotKey,
      revision: 0,
      created_at: t,
      updated_at: t,
      deleted_at: null,
      _dirty: 1,
      _baseRevision: 0,
      _blobState: 'pending',
    })
    await enqueue('survey_photos', id, a.user_id)
  })
  return id
}

/** 設定照片對應的拍攝清單項目（null = 取消） */
export async function setPhotoShot(id: string, shotKey: string | null): Promise<void> {
  await db.transaction('rw', db.survey_photos, db.outbox, async () => {
    const p = await db.survey_photos.get(id)
    if (!p || (p.shot_key ?? null) === shotKey) return
    await db.survey_photos.put({ ...p, shot_key: shotKey, updated_at: nowIso(), _dirty: 1 })
    await enqueue('survey_photos', id, p.user_id)
  })
}

export async function updatePhotoCaption(id: string, caption: string | null): Promise<void> {
  await db.transaction('rw', db.survey_photos, db.outbox, async () => {
    const p = await db.survey_photos.get(id)
    if (!p) return
    await db.survey_photos.put({ ...p, caption, updated_at: nowIso(), _dirty: 1 })
    await enqueue('survey_photos', id, p.user_id)
  })
}

export async function deletePhoto(id: string): Promise<void> {
  await db.transaction('rw', db.survey_photos, db.outbox, async () => {
    const p = await db.survey_photos.get(id)
    if (!p || p.deleted_at) return
    const t = nowIso()
    await db.survey_photos.put({ ...p, deleted_at: t, updated_at: t, _dirty: 1 })
    await enqueue('survey_photos', id, p.user_id)
  })
}

export async function movePhoto(areaId: string, id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.survey_photos, db.outbox, async () => {
    const list = (await db.survey_photos.where('area_id').equals(areaId).toArray())
      .filter((p) => !p.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    const i = list.findIndex((p) => p.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    const t = nowIso()
    for (let k = 0; k < list.length; k++) {
      if (list[k].sort_order === k) continue
      await db.survey_photos.put({ ...list[k], sort_order: k, updated_at: t, _dirty: 1 })
      await enqueue('survey_photos', list[k].id, list[k].user_id)
    }
  })
}

// ---------------------------------------------------------------------------
// 場勘選擇的產品（規格快照）
// ---------------------------------------------------------------------------

/** 把產品知識庫目前的資料複製成快照（之後產品資料更新也不會影響這份快照） */
export function makeSpecSnapshot(p: CatalogProduct): ProductSpecSnapshot {
  const snap: ProductSpecSnapshot = {
    snapshot_version: 1,
    model_code: p.model_code,
    model_raw: p.model_raw,
    display_name: p.display_name,
    description: p.description,
    category: p.category,
    image_urls: p.image_urls.slice(0, 4),
    install_text_raw: p.install_text_raw,
    install_extra: JSON.parse(JSON.stringify(p.install_extra ?? {})),
    parse_issues: JSON.parse(JSON.stringify(p.parse_issues ?? [])),
    data_quality: p.data_quality,
    source_key: p.source_key,
    source_row: p.source_row,
    catalog_spec_updated_at: p.spec_updated_at,
    catalog_synced_at: p.last_synced_at,
  }
  for (const f of SPEC_FIELDS) {
    const v = p[f]
    snap[f] = v === null || v === undefined ? null : Number(v)
  }
  return snap
}

/** 場勘產品型號文字（surveys.product_model）：加入一個型號（已存在就不重複） */
function addModelText(text: string | null, model: string): string {
  const parts = (text ?? '').split(/[、,，]\s*/).map((s) => s.trim()).filter(Boolean)
  if (!parts.some((x) => x.toUpperCase() === model.toUpperCase())) parts.push(model)
  return parts.join('、')
}
function removeModelText(text: string | null, model: string): string | null {
  const parts = (text ?? '').split(/[、,，]\s*/).map((s) => s.trim()).filter(Boolean)
  const kept = parts.filter((x) => x.toUpperCase() !== model.toUpperCase())
  return kept.length ? kept.join('、') : null
}

export async function addSurveyProduct(surveyId: string, product: CatalogProduct): Promise<string> {
  const id = uuid()
  await db.transaction('rw', db.surveys, db.survey_products, db.outbox, async () => {
    const s = await db.surveys.get(surveyId)
    if (!s) throw new Error('找不到這筆場勘')
    const existing = (await db.survey_products.where('survey_id').equals(surveyId).toArray()).filter((x) => !x.deleted_at)
    const t = nowIso()
    const row: SurveyProduct = {
      id,
      survey_id: surveyId,
      user_id: s.user_id,
      catalog_product_id: product.id,
      model_code: product.model_code,
      display_name: product.display_name,
      category: product.category,
      spec_snapshot: makeSpecSnapshot(product),
      snapshot_at: t,
      catalog_spec_hash: product.spec_hash,
      catalog_spec_updated_at: product.spec_updated_at,
      sort_order: existing.length ? Math.max(...existing.map((x) => x.sort_order)) + 1 : 0,
      revision: 0,
      created_at: t,
      updated_at: t,
      deleted_at: null,
      _dirty: 1,
      _baseRevision: 0,
    }
    await db.survey_products.add(row)
    await enqueue('survey_products', id, s.user_id)
    // 同步更新場勘的「產品型號」文字（首頁列表、搜尋、報告都會用到）
    const model = addModelText(s.product_model, product.model_code)
    if (model !== s.product_model) {
      await db.surveys.put({ ...s, product_model: model, updated_at: t, _dirty: 1 })
      await enqueue('surveys', s.id, s.user_id)
    }
  })
  return id
}

export async function removeSurveyProduct(id: string): Promise<void> {
  await db.transaction('rw', db.surveys, db.survey_products, db.outbox, async () => {
    const p = await db.survey_products.get(id)
    if (!p || p.deleted_at) return
    const t = nowIso()
    await db.survey_products.put({ ...p, deleted_at: t, updated_at: t, _dirty: 1 })
    await enqueue('survey_products', id, p.user_id)
    const s = await db.surveys.get(p.survey_id)
    const others = (await db.survey_products.where('survey_id').equals(p.survey_id).toArray()).filter((x) => !x.deleted_at && x.id !== id && x.model_code === p.model_code)
    if (s && !others.length) {
      const model = removeModelText(s.product_model, p.model_code)
      if (model !== s.product_model) {
        await db.surveys.put({ ...s, product_model: model, updated_at: t, _dirty: 1 })
        await enqueue('surveys', s.id, s.user_id)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// 場勘模板欄位值
// ---------------------------------------------------------------------------
/** 由 survey_id + template_id 決定性產生 UUID：兩台裝置離線各自建立也會是同一筆，不會重複 */
export async function templateRowId(surveyId: string, templateId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`survey-template:${surveyId}:${templateId}`)))
  h[6] = (h[6] & 0x0f) | 0x80 // version 8（自訂）
  h[8] = (h[8] & 0x3f) | 0x80
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** 寫入模板欄位（只合併有給的欄位）；不存在就建立 */
export async function saveTemplate(
  surveyId: string,
  templateId: string,
  version: number,
  patch: { values?: Record<string, string | number | null>; install_area_id?: string | null },
): Promise<void> {
  const id = await templateRowId(surveyId, templateId) // 在 transaction 外計算（crypto 非 Dexie promise）
  await db.transaction('rw', db.surveys, db.survey_templates, db.outbox, async () => {
    const s = await db.surveys.get(surveyId)
    if (!s) throw new Error('找不到這筆場勘')
    const t = nowIso()
    const cur = await db.survey_templates.get(id)
    const values = { ...(cur && !cur.deleted_at ? cur.values : {}), ...(patch.values ?? {}) }
    for (const k of Object.keys(values)) if (values[k] === null || values[k] === '') delete values[k]
    const row: SurveyTemplate = cur
      ? {
          ...cur,
          values,
          install_area_id: patch.install_area_id !== undefined ? patch.install_area_id : cur.install_area_id,
          template_version: Math.max(cur.template_version, version),
          deleted_at: null,
          updated_at: t,
          _dirty: 1,
        }
      : {
          id,
          survey_id: surveyId,
          user_id: s.user_id,
          template_id: templateId,
          template_version: version,
          install_area_id: patch.install_area_id ?? null,
          values,
          revision: 0,
          created_at: t,
          updated_at: t,
          deleted_at: null,
          _dirty: 1,
          _baseRevision: 0,
        }
    await db.survey_templates.put(row)
    await enqueue('survey_templates', id, s.user_id)
  })
}
