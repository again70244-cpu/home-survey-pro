import Dexie, { type EntityTable } from 'dexie'
import type {
  ConflictItem,
  MetaItem,
  OutboxItem,
  PhotoBlob,
  Survey,
  SurveyArea,
  SurveyPhoto,
} from './types'

export class SurveyDB extends Dexie {
  surveys!: EntityTable<Survey, 'id'>
  survey_areas!: EntityTable<SurveyArea, 'id'>
  survey_photos!: EntityTable<SurveyPhoto, 'id'>
  photoBlobs!: EntityTable<PhotoBlob, 'id'>
  outbox!: EntityTable<OutboxItem, 'key'>
  conflicts!: EntityTable<ConflictItem, 'key'>
  meta!: EntityTable<MetaItem, 'key'>

  constructor() {
    super('home-survey-pro')
    this.version(1).stores({
      surveys: 'id, user_id, [user_id+updated_at], _dirty',
      survey_areas: 'id, survey_id, user_id, _dirty',
      survey_photos: 'id, survey_id, area_id, user_id, _dirty, _blobState',
      photoBlobs: 'id',
      outbox: 'key, userId, table, createdAt',
      conflicts: 'key, userId',
      meta: 'key',
    })
  }
}

export const db = new SurveyDB()

/** 要求瀏覽器將資料標為持久保存，降低被系統清除的機率 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch {
    /* ignore */
  }
  return false
}
