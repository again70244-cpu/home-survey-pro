/**
 * 洗衣機／洗衣塔場勘模板（v1）
 *
 * 搬運路線與安裝空間的「寬深高」沿用既有的場勘區域（survey_areas），不重複輸入：
 *   - 使用者指定一個區域為「安裝位置」（預設：名稱含「安裝位置」者，否則「陽台」）
 *   - 其餘有測量寬度的區域視為搬運路線（大門、走廊、轉角、電梯、樓梯…）
 * 其他現場條件（水、電、排水、地面、前方空間…）存在模板欄位值中。
 *
 * 模板內容只新增、不刪除欄位；變更時提高 version，舊案件保留它當時的版本號。
 */
export const WASHER_TEMPLATE_ID = 'washer'
export const WASHER_TEMPLATE_VERSION = 1

export type FieldType = 'cm' | 'choice' | 'text'
export interface TemplateField {
  key: string
  label: string
  type: FieldType
  hint?: string
  options?: { value: string; label: string }[]
  /** 防呆檢查需要的欄位 */
  required?: boolean
}
export interface TemplateSection {
  title: string
  fields: TemplateField[]
}
export interface ShotItem {
  key: string
  label: string
  hint: string
  /** 只有符合條件時才需要拍（例如需要接進水管才拍水源） */
  when?: (values: Record<string, string | number | null | undefined>) => boolean
}

const YES_NO_UNSURE = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '沒有' },
  { value: 'unsure', label: '不確定' },
]

export const WASHER_SECTIONS: TemplateSection[] = [
  {
    title: '安裝方式',
    fields: [
      {
        key: 'stacked',
        label: '是否上下疊放',
        type: 'choice',
        hint: '例如滾筒洗衣機加抽屜櫃、迷你洗衣機；疊放時高度以所選產品相加計算',
        options: [
          { value: 'no', label: '單台' },
          { value: 'yes', label: '上下疊放' },
        ],
        required: true,
      },
    ],
  },
  {
    title: '門片與前方空間',
    fields: [
      { key: 'front_clearance_cm', label: '機器正前方可用空間', type: 'cm', hint: '從機器正面量到前方最近的障礙物（牆、門、櫃子）', required: true },
      { key: 'door_obstacle', label: '門片開啟範圍內有障礙物', type: 'choice', options: YES_NO_UNSURE, required: true },
    ],
  },
  {
    title: '進水',
    fields: [
      { key: 'faucet', label: '洗衣機專用水龍頭', type: 'choice', options: YES_NO_UNSURE, required: true },
      { key: 'faucet_distance_cm', label: '水龍頭到機器位置的距離', type: 'cm', required: true },
    ],
  },
  {
    title: '排水',
    fields: [
      {
        key: 'drain_type',
        label: '排水方式',
        type: 'choice',
        options: [
          { value: 'floor', label: '地板排水孔' },
          { value: 'wall', label: '牆面排水管' },
          { value: 'none', label: '沒有排水' },
          { value: 'unsure', label: '不確定' },
        ],
        required: true,
      },
      { key: 'drain_distance_cm', label: '排水孔到機器位置的距離', type: 'cm', required: true },
    ],
  },
  {
    title: '電源',
    fields: [
      { key: 'outlet', label: '附近有插座', type: 'choice', options: YES_NO_UNSURE, required: true },
      { key: 'outlet_distance_cm', label: '插座到機器位置的距離', type: 'cm', required: true },
      { key: 'outlet_grounded', label: '插座有接地（三孔）', type: 'choice', options: YES_NO_UNSURE },
      { key: 'dedicated_circuit', label: '專用迴路', type: 'choice', options: YES_NO_UNSURE },
    ],
  },
  {
    title: '地面與周邊',
    fields: [
      {
        key: 'floor_level',
        label: '地面平整',
        type: 'choice',
        options: [
          { value: 'yes', label: '平整' },
          { value: 'no', label: '不平整' },
          { value: 'unsure', label: '不確定' },
        ],
        required: true,
      },
      { key: 'top_obstacle', label: '上方有櫃子、窗戶或曬衣架', type: 'choice', options: YES_NO_UNSURE },
      { key: 'other_obstacles', label: '其他障礙物或注意事項', type: 'text' },
    ],
  },
]

export const WASHER_SHOTS: ShotItem[] = [
  { key: 'space_front', label: '安裝空間正面', hint: '站在正前方，拍到整個空間與地面' },
  { key: 'space_left', label: '安裝空間左側', hint: '拍到左側牆面或障礙物' },
  { key: 'space_right', label: '安裝空間右側', hint: '拍到右側牆面或障礙物' },
  { key: 'space_top', label: '安裝空間上方', hint: '櫃子、窗戶、曬衣架' },
  { key: 'faucet', label: '水龍頭（進水）', hint: '拍到水龍頭與機器位置的相對關係' },
  { key: 'drain', label: '排水位置', hint: '排水孔或排水管' },
  { key: 'outlet', label: '插座', hint: '拍到插座與機器位置的距離' },
  { key: 'route', label: '搬運路線', hint: '大門、走道、轉角' },
  { key: 'elevator_stairs', label: '電梯或樓梯', hint: '電梯門口與內部，或樓梯轉角' },
]

/** 預留空間標準（使用者設定：左右各 2 cm、後方 10 cm；非 LG 官方數值） */
export const WASHER_CLEARANCE = { side_each_cm: 2, back_cm: 10, tight_cm: 2 } as const

/** 這個產品是否適用洗衣機模板（依產品知識庫分類） */
export function isWasherCategory(category: string | null | undefined): boolean {
  return !!category && /洗衣|乾衣|洗脫烘/.test(category)
}
