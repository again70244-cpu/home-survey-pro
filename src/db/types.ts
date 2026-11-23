/** 本機同步欄位（以底線開頭，不送到雲端） */
export interface LocalSyncFields {
  /** 1 = 有尚未推送到雲端的修改（Dexie 無法索引 boolean，因此用數字） */
  _dirty: 0 | 1
  /** 最後一次與雲端一致時的 revision；0 = 從未上傳過 */
  _baseRevision: number
  /** 最近一次同步失敗的錯誤訊息 */
  _syncError?: string | null
}

export interface BaseRow extends LocalSyncFields {
  id: string
  user_id: string
  revision: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Survey extends BaseRow {
  customer_name: string
  customer_phone: string | null
  survey_date: string | null // YYYY-MM-DD
  customer_address: string | null
  product: string | null
  product_model: string | null
  notes: string | null
}

export type AreaKind = 'balcony' | 'elevator' | 'stairs' | 'other'

export interface SurveyArea extends BaseRow {
  survey_id: string
  kind: AreaKind
  name: string
  /** null = 尚未測量（絕不用 0 代替） */
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  notes: string | null
  sort_order: number
}

export interface SurveyPhoto extends BaseRow {
  survey_id: string
  area_id: string
  storage_path: string
  caption: string | null
  sort_order: number
  width: number | null
  height: number | null
  size_bytes: number | null
  mime_type: string
  /** 拍攝清單項目（模板定義的 key）；null = 一般照片 */
  shot_key?: string | null
  /** 'pending' = 檔案只在本機；'uploaded' = Storage 已確認 */
  _blobState: 'pending' | 'uploaded' | 'remote-only'
}

/** 照片本體（本機）。雲端上傳成功前絕不刪除 */
export interface PhotoBlob {
  id: string // = photo id
  blob: Blob
}

/** 場勘選擇的產品；spec_snapshot 為選擇當下的規格快照，建立後不再改變 */
export interface SurveyProduct extends BaseRow {
  survey_id: string
  catalog_product_id: string | null
  model_code: string
  display_name: string | null
  category: string | null
  spec_snapshot: ProductSpecSnapshot
  snapshot_at: string
  catalog_spec_hash: string | null
  catalog_spec_updated_at: string | null
  sort_order: number
}

/** 規格快照內容（保存選擇當下產品知識庫的資料） */
export interface ProductSpecSnapshot {
  snapshot_version: 1
  model_code: string
  model_raw: string
  display_name: string | null
  description: string | null
  category: string | null
  image_urls: string[]
  install_text_raw: string | null
  install_extra: Record<string, unknown>
  parse_issues: { code: string; message: string; line?: string; field?: string }[]
  data_quality: 'complete' | 'missing' | 'invalid' | 'needs_review'
  source_key: string
  source_row: number | null
  catalog_spec_updated_at: string
  catalog_synced_at: string
  [spec: string]: unknown
}

/** 場勘模板欄位值（每筆場勘、每種模板一筆；id 由 survey_id + template_id 決定） */
export interface SurveyTemplate extends BaseRow {
  survey_id: string
  template_id: string
  template_version: number
  install_area_id: string | null
  values: Record<string, string | number | null>
}

export type TableName = 'surveys' | 'survey_areas' | 'survey_products' | 'survey_templates' | 'survey_photos'

export interface OutboxItem {
  key: string // `${table}:${rowId}`
  table: TableName
  rowId: string
  userId: string
  createdAt: number
  attempts: number
  lastError?: string | null
}

export interface ConflictItem {
  key: string // `${table}:${rowId}`
  table: TableName
  rowId: string
  userId: string
  local: Record<string, unknown>
  remote: Record<string, unknown>
  detectedAt: number
}

export interface MetaItem {
  key: string
  value: unknown
}

export const AREA_KIND_LABEL: Record<AreaKind, string> = {
  balcony: '陽台',
  elevator: '電梯',
  stairs: '樓梯',
  other: '其他',
}
