/**
 * 現場拍攝模式：每個模板的步驟定義（先量測／回答，再拍照）
 *
 * 一個步驟 = 一組量測（某個區域的寬深高）＋ 相關問題（模板欄位）＋ 拍攝項目（照片）。
 * 步驟完成與否完全由資料推算（不另外存「跳過」狀態），所以跨裝置、離線都一致。
 * 照片不強制：量測與必填問題完成即算完成；沒拍的照片在完成頁另外提醒。
 */
import type { SurveyArea } from '../db/types'
import type { TemplateValues } from '../rules/common'
import type { Finding } from '../rules/types'
import type { ShotItem, TemplateField } from './washer'

export type DimKey = 'width_cm' | 'depth_cm' | 'height_cm'
/** 量測的對象：install = 安裝位置；door = 大門；passage = 電梯或樓梯 */
export type DimTarget = 'install' | 'door' | 'passage'

export interface FieldStep {
  key: string
  title: string
  hint: string
  dims?: { target: DimTarget; keys: DimKey[]; require: DimKey[] }
  /** 模板欄位 key（依模板的顯示條件過濾） */
  fields: string[]
  /** 拍攝項目 key（依拍攝項目的 when 條件過濾） */
  shots: string[]
  /** 這一步相關的檢查結果 */
  findings: (f: Finding, ctx: { areaId: string | null }) => boolean
}

const prefix = (...ps: string[]) => (f: Finding) => ps.some((p) => f.id === p || f.id.startsWith(p.endsWith(':') ? p : `${p}:`))
const routeOf = (f: Finding, ctx: { areaId: string | null }) => !!ctx.areaId && f.id.startsWith('route:') && f.areaId === ctx.areaId

const ALL: DimKey[] = ['width_cm', 'depth_cm', 'height_cm']

export const WASHER_STEPS: FieldStep[] = [
  { key: 'install', title: '安裝位置', hint: '先量寬、深、高，再站在正前方拍一張（拍到整個空間與地面）', dims: { target: 'install', keys: ALL, require: ALL }, fields: ['stacked'], shots: ['space_front'], findings: prefix('install:', 'stack:') },
  { key: 'sides', title: '左右兩側', hint: '拍左右兩側的牆面或障礙物', fields: [], shots: ['space_left', 'space_right'], findings: () => false },
  { key: 'top', title: '上方空間', hint: '確認上方有沒有櫃子、窗戶或曬衣架，再拍一張', fields: ['top_obstacle'], shots: ['space_top'], findings: prefix('top') },
  { key: 'front', title: '門片前方', hint: '量機器正前方到最近障礙物（牆、門、櫃子）的距離', fields: ['front_clearance_cm', 'door_obstacle'], shots: [], findings: prefix('door:') },
  { key: 'faucet', title: '水龍頭', hint: '先確認有沒有、量距離，再拍水龍頭和機器位置的相對關係', fields: ['faucet', 'faucet_distance_cm'], shots: ['faucet'], findings: prefix('faucet:') },
  { key: 'drain', title: '排水', hint: '確認排水方式、量距離，再拍排水孔或排水管', fields: ['drain_type', 'drain_distance_cm'], shots: ['drain'], findings: prefix('drain:') },
  { key: 'outlet', title: '插座', hint: '確認插座、量距離，再拍插座與機器位置', fields: ['outlet', 'outlet_distance_cm', 'outlet_grounded', 'dedicated_circuit'], shots: ['outlet'], findings: prefix('outlet:') },
  { key: 'floor', title: '地面與周邊', hint: '確認地面是否平整，記下其他障礙物', fields: ['floor_level', 'other_obstacles'], shots: [], findings: prefix('floor') },
  { key: 'door', title: '大門與走道', hint: '量大門寬度與高度，再拍搬運路線（大門、走道、轉角）', dims: { target: 'door', keys: ['width_cm', 'height_cm'], require: ['width_cm'] }, fields: [], shots: ['route'], findings: routeOf },
  { key: 'passage', title: '電梯或樓梯', hint: '量電梯門寬、內部深度與高度（樓梯量寬度），再拍一張', dims: { target: 'passage', keys: ALL, require: ['width_cm'] }, fields: [], shots: ['elevator_stairs'], findings: routeOf },
]

export const FRIDGE_STEPS: FieldStep[] = [
  { key: 'install', title: '安裝位置', hint: '先量寬、深、高（高度量到上方吊櫃或樑），再站在正前方拍一張', dims: { target: 'install', keys: ALL, require: ALL }, fields: ['side_walls'], shots: ['fridge_space_front'], findings: prefix('install:', 'door:width') },
  { key: 'sides', title: '左右兩側', hint: '拍左右兩側的牆面或櫃子', fields: [], shots: ['fridge_space_left', 'fridge_space_right'], findings: () => false },
  { key: 'top', title: '上方空間', hint: '拍上方的吊櫃或樑柱', fields: [], shots: ['fridge_space_top'], findings: () => false },
  { key: 'front', title: '門片前方', hint: '量冰箱正前方到最近障礙物（中島、牆、餐桌）的距離', fields: ['front_clearance_cm', 'door_obstacle'], shots: [], findings: (f) => f.id.startsWith('door:') && !f.id.startsWith('door:width') },
  { key: 'outlet', title: '插座', hint: '確認插座、量距離，再拍插座與冰箱位置', fields: ['outlet', 'outlet_distance_cm', 'outlet_grounded', 'dedicated_circuit'], shots: ['fridge_outlet'], findings: prefix('outlet:') },
  { key: 'water', title: '進水管', hint: '有自動製冰或門外取水的機型才需要；需要時量水源距離並拍照', fields: ['water_line', 'water_source_distance_cm'], shots: ['fridge_water'], findings: prefix('water:') },
  { key: 'floor', title: '地面與周邊', hint: '確認地面是否平整、旁邊有沒有熱源', fields: ['floor_level', 'heat_source', 'other_obstacles'], shots: [], findings: prefix('floor', 'heat') },
  { key: 'door', title: '大門', hint: '量大門寬度與高度，再拍門框', dims: { target: 'door', keys: ['width_cm', 'height_cm'], require: ['width_cm'] }, fields: [], shots: ['fridge_entrance'], findings: routeOf },
  { key: 'route', title: '搬運路線', hint: '拍走道、轉角、廚房入口', fields: [], shots: ['fridge_route'], findings: () => false },
  { key: 'passage', title: '電梯或樓梯', hint: '量電梯門寬、內部深度與高度（冰箱需直立搬運；樓梯量寬度），再拍一張', dims: { target: 'passage', keys: ALL, require: ['width_cm'] }, fields: [], shots: ['fridge_elevator_stairs'], findings: routeOf },
]

/** 依名稱或類型找出量測對象的區域 */
export function resolveTarget(target: DimTarget, areas: SurveyArea[], install: SurveyArea | null, passageKind: 'elevator' | 'stairs' | null = null): SurveyArea | null {
  const live = areas.filter((a) => !a.deleted_at)
  if (target === 'install') return install
  if (target === 'door') return live.find((a) => a.name.includes('大門')) ?? null
  const kind = passageKind ?? (live.some((a) => a.kind === 'elevator') ? 'elevator' : live.some((a) => a.kind === 'stairs') ? 'stairs' : 'elevator')
  return live.find((a) => a.kind === kind) ?? null
}

export interface StepContext {
  values: TemplateValues
  fieldsByKey: Map<string, TemplateField>
  showIf: Record<string, (v: TemplateValues) => boolean>
  shotsByKey: Map<string, ShotItem>
  shotsTaken: Set<string>
  area: SurveyArea | null
}

export function visibleFields(step: FieldStep, ctx: Pick<StepContext, 'values' | 'fieldsByKey' | 'showIf'>): TemplateField[] {
  return step.fields.map((k) => ctx.fieldsByKey.get(k)).filter((f): f is TemplateField => !!f && (ctx.showIf[f.key]?.(ctx.values) ?? true))
}
export function visibleShots(step: FieldStep, ctx: Pick<StepContext, 'values' | 'shotsByKey'>): ShotItem[] {
  return step.shots.map((k) => ctx.shotsByKey.get(k)).filter((s): s is ShotItem => !!s && (s.when?.(ctx.values) ?? true))
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== ''

/**
 * 步驟狀態
 *   done：必填的量測與問題都完成（有必填時）；沒有必填項目的步驟，回答任一題或拍了照即完成
 *   photoMissing：已完成但還有照片沒拍
 */
export function stepStatus(step: FieldStep, ctx: StepContext): { done: boolean; photoMissing: boolean; shotsDone: number; shotsTotal: number } {
  const fields = visibleFields(step, ctx)
  const shots = visibleShots(step, ctx)
  const dimReq = step.dims ? step.dims.require.map((k) => ctx.area?.[k] ?? null) : []
  const req = [...fields.filter((f) => f.required).map((f) => ctx.values[f.key]), ...dimReq]
  const shotsDone = shots.filter((s) => ctx.shotsTaken.has(s.key)).length
  const anyAnswer = fields.some((f) => filled(ctx.values[f.key]))
  const done = req.length ? req.every(filled) : anyAnswer || (shots.length > 0 && shotsDone > 0)
  return { done, photoMissing: done && shotsDone < shots.length, shotsDone, shotsTotal: shots.length }
}
