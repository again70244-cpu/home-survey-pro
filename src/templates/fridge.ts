/**
 * 冰箱場勘模板（v1）
 *
 * 與洗衣機模板相同：安裝空間與搬運路線的寬深高沿用場勘區域（survey_areas），
 * 使用者指定一個區域為冰箱安裝位置（預設：名稱含「冰箱」或「安裝位置」者）。
 * 拍攝項目 key 一律以 fridge_ 開頭，與洗衣機的拍攝項目分開計算。
 */
import type { ShotItem, TemplateSection } from './washer'

export const FRIDGE_TEMPLATE_ID = 'fridge'
export const FRIDGE_TEMPLATE_VERSION = 1

const YES_NO_UNSURE = [
  { value: 'yes', label: '有' },
  { value: 'no', label: '沒有' },
  { value: 'unsure', label: '不確定' },
]

export const FRIDGE_SECTIONS: TemplateSection[] = [
  {
    title: '安裝位置',
    fields: [
      {
        key: 'side_walls',
        label: '冰箱兩側',
        type: 'choice',
        hint: '靠牆或嵌入時，門片可能無法開到 90 度',
        options: [
          { value: 'open', label: '兩側都空曠' },
          { value: 'one', label: '一側靠牆或櫃子' },
          { value: 'both', label: '兩側都靠（嵌入）' },
        ],
        required: true,
      },
    ],
  },
  {
    title: '門片與前方空間',
    fields: [
      { key: 'front_clearance_cm', label: '冰箱正前方可用空間', type: 'cm', hint: '從冰箱正面量到前方最近的障礙物（中島、牆、餐桌）', required: true },
      { key: 'door_obstacle', label: '門片開啟範圍內有障礙物', type: 'choice', options: YES_NO_UNSURE, required: true },
    ],
  },
  {
    title: '電源',
    fields: [
      { key: 'outlet', label: '附近有插座', type: 'choice', options: YES_NO_UNSURE, required: true },
      { key: 'outlet_distance_cm', label: '插座到冰箱位置的距離', type: 'cm', required: true },
      { key: 'outlet_grounded', label: '插座有接地（三孔）', type: 'choice', options: YES_NO_UNSURE },
      { key: 'dedicated_circuit', label: '專用插座（不與其他電器共用）', type: 'choice', options: YES_NO_UNSURE },
    ],
  },
  {
    title: '進水管（製冰／飲水機款）',
    fields: [
      {
        key: 'water_line',
        label: '是否需要接進水管',
        type: 'choice',
        hint: '一般冰箱選「不需要」；有自動製冰或門外取水的機型才需要',
        options: [
          { value: 'no', label: '不需要' },
          { value: 'yes', label: '需要' },
          { value: 'unsure', label: '不確定' },
        ],
      },
      { key: 'water_source_distance_cm', label: '水源（水龍頭、角閥）到冰箱位置的距離', type: 'cm', required: true },
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
      { key: 'heat_source', label: '旁邊有爐具、烤箱或陽光直射', type: 'choice', options: YES_NO_UNSURE },
      { key: 'other_obstacles', label: '其他障礙物或注意事項', type: 'text' },
    ],
  },
]

export const FRIDGE_SHOTS: ShotItem[] = [
  { key: 'fridge_space_front', label: '安裝空間正面', hint: '站在正前方，拍到整個空間與地面' },
  { key: 'fridge_space_left', label: '安裝空間左側', hint: '拍到左側牆面或櫃子' },
  { key: 'fridge_space_right', label: '安裝空間右側', hint: '拍到右側牆面或櫃子' },
  { key: 'fridge_space_top', label: '安裝空間上方', hint: '吊櫃、樑柱' },
  { key: 'fridge_outlet', label: '插座', hint: '拍到插座與冰箱位置的距離' },
  { key: 'fridge_water', label: '進水水源', hint: '需要接進水管時，拍水龍頭或角閥', when: (v) => v.water_line === 'yes' },
  { key: 'fridge_entrance', label: '大門', hint: '拍到大門寬度與門框' },
  { key: 'fridge_route', label: '搬運路線', hint: '走道、轉角、廚房入口' },
  { key: 'fridge_elevator_stairs', label: '電梯或樓梯', hint: '電梯門口與內部，或樓梯轉角' },
]

/** 預留空間標準（使用者設定：左右各 5 cm、上方 5 cm、後方 5 cm；非 LG 官方數值） */
export const FRIDGE_CLEARANCE = { side_each_cm: 5, top_cm: 5, back_cm: 5 } as const

/** 這個產品是否適用冰箱模板（依產品知識庫分類） */
export function isFridgeCategory(category: string | null | undefined): boolean {
  return !!category && /冰箱|冷凍|冷藏/.test(category)
}
