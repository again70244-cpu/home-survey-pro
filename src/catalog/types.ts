/** 產品知識庫（唯讀，來源：Google Sheets → Supabase） */
import type { SpecField } from '../../supabase/functions/_shared/catalog/installText.ts'

export type DataQuality = 'complete' | 'missing' | 'invalid' | 'needs_review'

export interface CatalogProduct extends Partial<Record<SpecField, number | null>> {
  id: string
  source_key: string
  source_row: number | null
  model_code: string
  model_raw: string
  description: string | null
  display_name: string | null
  category: string | null
  category_raw: string | null
  image_urls: string[]
  link_urls: string[]
  video_urls: string[]
  maintenance_notes: string | null
  install_text_raw: string | null
  install_extra: {
    conditions?: { field: SpecField; value_cm: number; condition: string; source: string }[]
    unparsed?: string[]
    notes?: string[]
    unit_assumed?: boolean
  }
  parse_issues: { code: string; message: string; line?: string; field?: string }[]
  data_quality: DataQuality
  is_active: boolean
  deactivated_at: string | null
  spec_hash: string
  revision: number
  first_seen_at: string
  last_synced_at: string
  last_changed_at: string
  spec_updated_at: string
}

export interface CatalogIndoorUnit {
  position: number
  model_code: string
  series: string | null
  capacity_kw: number | null
  source_text: string
}

export interface CapacityRule {
  indoor_count: number | null
  unit_min_kw: number | null
  unit_max_kw: number | null
  total_max_kw: number | null
  total_min_kw: number | null
  source_text: string
}

export interface CatalogSystem {
  id: string
  model_code: string
  outdoor_text: string
  capacity_kw: number | null
  indoor_counts: number[]
  notes: string | null
  rules: CapacityRule[]
  issues: string[]
  is_active: boolean
  last_synced_at: string
  last_changed_at: string
  indoor_units: CatalogIndoorUnit[]
}

export interface CatalogRunInfo {
  id: string
  status: 'success' | 'unchanged' | 'rejected' | 'failed' | 'preview'
  trigger: string
  finished_at: string
  error: string | null
  counts: Record<string, number>
}

export interface CatalogMeta {
  /** 最後一次成功同步（伺服器端） */
  lastSuccess: CatalogRunInfo | null
  /** 最近一次同步嘗試（可能失敗） */
  lastAttempt: CatalogRunInfo | null
  /** 這台裝置最後一次下載產品資料的時間 */
  downloadedAt: string | null
  /** 下載時對應的伺服器成功同步 ID（相同就不重新下載） */
  downloadedRunId: string | null
}
