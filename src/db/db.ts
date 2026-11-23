import Dexie, { type EntityTable } from 'dexie'
import type {
  ConflictItem,
  SurveyProduct,
  MetaItem,
  OutboxItem,
  PhotoBlob,
  Survey,
  SurveyArea,
  SurveyPhoto,
} from './types'
import type { CatalogProduct, CatalogSystem } from '../catalog/types'

export class SurveyDB extends Dexie {
  surveys!: EntityTable<Survey, 'id'>
  survey_areas!: EntityTable<SurveyArea, 'id'>
  survey_photos!: EntityTable<SurveyPhoto, 'id'>
  survey_products!: EntityTable<SurveyProduct, 'id'>
  photoBlobs!: EntityTable<PhotoBlob, 'id'>
  outbox!: EntityTable<OutboxItem, 'key'>
  conflicts!: EntityTable<ConflictItem, 'key'>
  meta!: EntityTable<MetaItem, 'key'>
  /** 產品知識庫快取（唯讀；離線時使用最後一次下載的資料） */
  catalog_products!: EntityTable<CatalogProduct, 'id'>
  catalog_systems!: EntityTable<CatalogSystem, 'id'>

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
    // v2：只新增產品知識庫快取表，既有資料表與資料完全不變
    this.version(2).stores({
      catalog_products: 'id, model_code, category, is_active',
      catalog_systems: 'id, model_code',
    })
    // v3：新增場勘選擇的產品（規格快照）；既有資料表不變
    this.version(3).stores({
      survey_products: 'id, survey_id, user_id, _dirty',
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
