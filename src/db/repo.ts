import Dexie from 'dexie'
import { db } from './db'
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
  await db.transaction('rw', db.surveys, db.survey_areas, db.survey_photos, db.outbox, async () => {
    const s = await db.surveys.get(id)
    if (!s) return
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
