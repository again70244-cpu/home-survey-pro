import type { SurveyArea, SurveyPhoto } from '../db/types'

export type DimState = 'none' | 'partial' | 'complete'

export interface AreaStatus {
  area: SurveyArea
  dims: DimState
  measured: number // 已填幾項（0–3）
  photos: number
  /** 區域或其照片有尚未同步到雲端的修改 */
  unsynced: boolean
  complete: boolean
}

export function dimState(a: Pick<SurveyArea, 'width_cm' | 'depth_cm' | 'height_cm'>): { state: DimState; measured: number } {
  const measured = [a.width_cm, a.depth_cm, a.height_cm].filter((v) => v !== null && v !== undefined).length
  return { state: measured === 0 ? 'none' : measured === 3 ? 'complete' : 'partial', measured }
}

export function areaStatus(area: SurveyArea, photos: SurveyPhoto[]): AreaStatus {
  const mine = photos.filter((p) => p.area_id === area.id && !p.deleted_at)
  const { state, measured } = dimState(area)
  const unsynced = !!area._dirty || mine.some((p) => p._dirty || p._blobState === 'pending')
  return { area, dims: state, measured, photos: mine.length, unsynced, complete: state === 'complete' && mine.length > 0 }
}

export interface SurveySummary {
  areas: AreaStatus[]
  completeAreas: number
  missing: string[]
  unsynced: boolean
  /** 只有「全部區域尺寸完整、都有照片、全部已同步」才算完整 */
  complete: boolean
}

export function surveySummary(areas: SurveyArea[], photos: SurveyPhoto[], surveyDirty: boolean): SurveySummary {
  const st = areas.map((a) => areaStatus(a, photos))
  const missing: string[] = []
  for (const s of st) {
    if (s.dims === 'none') missing.push(`${s.area.name}：尚未測量尺寸`)
    else if (s.dims === 'partial') missing.push(`${s.area.name}：尺寸只填 ${s.measured}/3 項`)
    if (s.photos === 0) missing.push(`${s.area.name}：尚未拍照`)
  }
  const unsynced = surveyDirty || st.some((s) => s.unsynced)
  if (areas.length === 0) missing.push('尚未建立任何場勘區域')
  return {
    areas: st,
    completeAreas: st.filter((s) => s.complete).length,
    missing,
    unsynced,
    complete: areas.length > 0 && missing.length === 0 && !unsynced,
  }
}
