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
  /** 'pending' = 檔案只在本機；'uploaded' = Storage 已確認 */
  _blobState: 'pending' | 'uploaded' | 'remote-only'
}

/** 照片本體（本機）。雲端上傳成功前絕不刪除 */
export interface PhotoBlob {
  id: string // = photo id
  blob: Blob
}

export type TableName = 'surveys' | 'survey_areas' | 'survey_photos'

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
