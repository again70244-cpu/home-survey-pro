import { toHalfWidth, SPEC_LABELS, type SpecField } from '../../supabase/functions/_shared/catalog/installText.ts'
import type { CatalogProduct, CatalogSystem, DataQuality } from './types'

/** 搜尋用正規化：半形、小寫、去除空白與 - / 等符號（「wd s2220」可找到「WD-S2220B」） */
export function norm(s: string | null | undefined): string {
  return toHalfWidth(s ?? '').toLowerCase().replace(/[\s\-_/.()]+/g, '')
}

/** 模糊搜尋分數；0 = 不符合。多個關鍵字（空白分隔）必須全部符合 */
export function matchScore(p: CatalogProduct, query: string): number {
  const terms = toHalfWidth(query).trim().split(/\s+/).map(norm).filter(Boolean)
  if (!terms.length) return 1
  const model = norm(p.model_code)
  const text = norm(`${p.display_name ?? ''} ${p.description ?? ''} ${p.category ?? ''}`)
  let score = 0
  for (const t of terms) {
    if (model.startsWith(t)) score += 100
    else if (model.includes(t)) score += 60
    else if (isSubsequence(t, model) && t.length >= 3) score += 25 // 例如「s2220b」對「wds2220b」、少打字也找得到
    else if (text.includes(t)) score += 20
    else return 0
  }
  return score
}
function isSubsequence(a: string, b: string) {
  let i = 0
  for (const c of b) if (c === a[i]) i++
  return i === a.length
}

export function searchProducts(all: CatalogProduct[], q: { text: string; category: string | null; quality: 'all' | 'with' | 'missing'; includeInactive?: boolean }) {
  return all
    .filter((p) => (q.includeInactive || p.is_active) && (!q.category || p.category === q.category))
    .filter((p) => (q.quality === 'with' ? p.data_quality !== 'missing' : q.quality === 'missing' ? p.data_quality === 'missing' : true))
    .map((p) => ({ p, s: matchScore(p, q.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.p.source_row ?? 0) - (b.p.source_row ?? 0))
    .map((x) => x.p)
}

export const QUALITY_LABEL: Record<DataQuality, string> = {
  complete: '安裝資料完整',
  needs_review: '待人工確認',
  missing: '缺少安裝資料',
  invalid: '資料格式異常',
}

/** 詳細頁的規格分組；只列出有值的欄位（沒有值 = 原文未提供，不顯示 0） */
export const SPEC_GROUPS: { title: string; fields: SpecField[] }[] = [
  { title: '本體尺寸', fields: ['width_cm', 'height_cm', 'depth_cm'] },
  { title: '開門與使用空間', fields: ['door_open_90_depth_cm', 'door_open_90_width_cm', 'door_removed_depth_cm', 'full_open_depth_cm', 'drawer_open_depth_cm', 'full_open_height_cm', 'door_clearance_cm'] },
  { title: '管線', fields: ['power_cable_cm', 'water_inlet_hose_cm', 'drain_hose_cm', 'inlet_drain_hose_cm'] },
  { title: '外箱尺寸（搬運）', fields: ['package_width_cm', 'package_height_cm', 'package_depth_cm'] },
]
export { SPEC_LABELS }

export function specValue(p: CatalogProduct, f: SpecField): number | null {
  const v = p[f]
  return v === null || v === undefined ? null : Number(v)
}

export function catalogStats(products: CatalogProduct[]) {
  const act = products.filter((p) => p.is_active)
  return {
    total: act.length,
    withInstall: act.filter((p) => p.data_quality !== 'missing').length,
    complete: act.filter((p) => p.data_quality === 'complete').length,
    missing: act.filter((p) => p.data_quality === 'missing').length,
    abnormal: act.filter((p) => p.data_quality === 'needs_review' || p.data_quality === 'invalid').length,
    inactive: products.length - act.length,
  }
}

/** 冷氣型號「LSU22DHST/LSN22DDHST」中的室內機是否出現在一對多搭配裡 */
export function systemsForProduct(p: CatalogProduct, systems: CatalogSystem[]): CatalogSystem[] {
  const parts = p.model_code.split('/')
  return systems.filter((s) => s.is_active && s.indoor_units.some((u) => parts.includes(u.model_code)))
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
