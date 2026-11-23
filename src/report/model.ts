import type { Survey, SurveyArea, SurveyPhoto, SurveyProduct } from '../db/types'
import { surveySummary, type SurveySummary } from '../lib/completeness'

/** A4 直式（CSS px）：1240 × 1754，輸出時 pixelRatio 2 → 2480 × 3508 */
export const PAGE_W = 1240
export const PAGE_H = 1754
export const MARGIN_X = 80
export const MARGIN_TOP = 64
export const MARGIN_BOTTOM = 56
export const HEADER_H = 76
export const FOOTER_H = 56
export const CONTENT_W = PAGE_W - MARGIN_X * 2
export const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - HEADER_H - FOOTER_H
export const GAP = 28
export const PHOTO_GAP = 24
export const PHOTO_CELL_W = (CONTENT_W - PHOTO_GAP) / 2
export const PHOTO_MAX_H = 500

export interface ReportPhoto {
  id: string
  url: string | null // null = 照片檔案無法取得
  width: number
  height: number
  caption: string | null
  index: number
}

export type Block =
  | { kind: 'cover'; key: string }
  | { kind: 'summary-head'; key: string }
  | { kind: 'summary-row'; key: string; areaIndex: number }
  | { kind: 'product'; key: string; productIndex: number }
  | { kind: 'area-head'; key: string; areaIndex: number; startsArea: true }
  | { kind: 'area-cont'; key: string; areaIndex: number }
  | { kind: 'area-notes'; key: string; areaIndex: number; text: string; first: boolean }
  | { kind: 'photo-row'; key: string; areaIndex: number; photos: ReportPhoto[]; height: number }
  | { kind: 'no-photo'; key: string; areaIndex: number }
  | { kind: 'final'; key: string }

export interface ReportData {
  survey: Survey
  areas: SurveyArea[]
  photosByArea: Map<string, ReportPhoto[]>
  summary: SurveySummary
  /** 場勘選擇的產品（規格以快照為準） */
  products: SurveyProduct[]
  generatedAt: Date
}

export function buildReportData(survey: Survey, areas: SurveyArea[], photos: SurveyPhoto[], urls: Map<string, string | null>, products: SurveyProduct[] = []): ReportData {
  const live = photos.filter((p) => !p.deleted_at)
  const photosByArea = new Map<string, ReportPhoto[]>()
  for (const a of areas) {
    const list = live
      .filter((p) => p.area_id === a.id)
      .sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at))
      .map((p, i) => ({ id: p.id, url: urls.get(p.id) ?? null, width: p.width ?? 4, height: p.height ?? 3, caption: p.caption, index: i + 1 }))
    photosByArea.set(a.id, list)
  }
  return { survey, areas, photosByArea, summary: surveySummary(areas, live, !!survey._dirty), generatedAt: new Date(), products }
}

/** 照片列高度：依照片比例縮放到欄寬，取兩張中較高者，上限 PHOTO_MAX_H（不裁切，object-fit: contain） */
export function photoRowHeight(photos: ReportPhoto[]): number {
  const cellW = photos.length === 1 ? CONTENT_W * 0.66 : PHOTO_CELL_W
  return Math.round(Math.min(PHOTO_MAX_H, Math.max(...photos.map((p) => (cellW * p.height) / p.width))))
}

/** 備註切段：保留換行，每段最多約 420 字，避免單一區塊超過一頁 */
function splitNotes(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of text.trim().split('\n')) {
    for (let i = 0; i < Math.max(1, line.length); i += 420) {
      const piece = line.slice(i, i + 420)
      if (cur && cur.length + piece.length > 420) {
        out.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n${piece}` : piece
    }
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function buildBlocks(d: ReportData): Block[] {
  const blocks: Block[] = [{ kind: 'cover', key: 'cover' }, { kind: 'summary-head', key: 'sum-h' }]
  d.areas.forEach((_, i) => blocks.push({ kind: 'summary-row', key: `sum-${i}`, areaIndex: i }))
  d.products.forEach((_, i) => blocks.push({ kind: 'product', key: `prod-${i}`, productIndex: i }))
  d.areas.forEach((a, i) => {
    blocks.push({ kind: 'area-head', key: `ah-${i}`, areaIndex: i, startsArea: true })
    if (a.notes) splitNotes(a.notes).forEach((t, k) => blocks.push({ kind: 'area-notes', key: `an-${i}-${k}`, areaIndex: i, text: t, first: k === 0 }))
    const ph = d.photosByArea.get(a.id) ?? []
    if (!ph.length) blocks.push({ kind: 'no-photo', key: `np-${i}`, areaIndex: i })
    for (let k = 0; k < ph.length; k += 2) {
      const row = ph.slice(k, k + 2)
      blocks.push({ kind: 'photo-row', key: `pr-${i}-${k}`, areaIndex: i, photos: row, height: photoRowHeight(row) })
    }
  })
  blocks.push({ kind: 'final', key: 'final' })
  return blocks
}

/**
 * 分頁：依量測到的高度把區塊依序放入頁面
 * - 封面與摘要在第一頁（摘要過長會延續）
 * - 每個區域從新的區塊開始；區域標題必須和下一個區塊在同一頁（不留孤立標題）
 * - 區域跨頁時，新頁面加上「（續）」標題
 * - 不產生空白頁
 */
export function paginate(blocks: Block[], heights: Map<string, number>, contHeight: number): Block[][] {
  const pages: Block[][] = []
  let page: Block[] = []
  let used = 0
  const h = (b: Block) => heights.get(b.key) ?? 0
  const push = () => {
    if (page.length) pages.push(page)
    page = []
    used = 0
  }
  const add = (b: Block) => {
    used += (page.length ? GAP : 0) + h(b)
    page.push(b)
  }
  let firstArea = true
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const need = (page.length ? GAP : 0) + h(b)

    if (b.kind === 'area-head') {
      // 區域內容從封面之後的新頁開始
      if (firstArea) {
        push()
        firstArea = false
      }
      const next = blocks[i + 1]
      const withNext = need + (next ? GAP + h(next) : 0)
      if (used + withNext > CONTENT_H && page.length) push()
      add(b)
      continue
    }

    if (used + need > CONTENT_H && page.length) {
      push()
      if (b.kind === 'photo-row' || b.kind === 'area-notes' || b.kind === 'no-photo') {
        add({ kind: 'area-cont', key: `cont-${b.areaIndex}-${pages.length}`, areaIndex: b.areaIndex })
        used = contHeight
      }
    }
    add(b)
  }
  push()
  return pages
}
