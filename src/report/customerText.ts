/**
 * 客戶版報告：把檢查結果改寫成客戶看得懂的一句話（固定文字對照，不使用 AI）
 *
 * 只轉換高風險與注意事項（以及「建議專用插座」）；
 * 「必須人工確認」、單位防呆、缺少規格、完成度等內部項目不給客戶看。
 */
import type { SurveyArea } from '../db/types'
import type { Finding } from '../rules/types'

export interface CustomerItem {
  /** adjust = 需要調整才能安裝（高風險）；prepare = 需要您配合或知道的事 */
  kind: 'adjust' | 'prepare'
  text: string
  action: string
}

type Rule = { re: RegExp; high?: [string, string]; caution?: [string, string]; info?: [string, string] }

/** {area} 會換成區域名稱；fridge 與 washer 用詞不同時以模板 id 區分 */
const RULES: Record<string, Rule[]> = {
  common: [
    { re: /^door:[^:]+:door_open_90_depth$/, high: ['門打開時會碰到前方的障礙物', '建議移開前方的櫃子或物品，或另選安裝位置'] },
    { re: /^door:[^:]+:(full_open_depth|drawer_open_depth)$/, caution: ['門全開或抽屜拉出時，前方空間較緊', '日常取放可能需要側身，建議保持前方淨空'] },
    { re: /^door:obstacle$/, caution: ['門片打開的範圍內有障礙物', '建議安裝前先移開'] },
    { re: /^outlet:none$/, high: ['附近沒有插座', '安裝前請先請水電師傅加裝插座（不建議使用延長線）'] },
    { re: /^outlet:len:/, high: ['插座離機器太遠，電源線不夠長', '建議請水電師傅移設插座（不建議使用延長線）'] },
    { re: /^outlet:ground$/, caution: ['插座沒有接地', '建議請水電師傅改為接地插座，使用上比較安全'] },
    { re: /^outlet:circuit$/, info: ['建議使用專用插座', '避免與微波爐、電鍋等大功率電器共用，減少跳電'] },
    { re: /^floor$/, caution: ['地面不太平整', '安裝時會調整機器腳座，必要時需要墊平'] },
    { re: /^route:[^:]+:[^:]+:body$/, high: ['{area}寬度不夠，機器無法搬進去', '可能需要拆門框、改走其他路線或吊掛，我們會再與您確認'] },
    { re: /^route:[^:]+:[^:]+:nodoor$/, caution: ['{area}較窄，需要先拆下冰箱門才能搬入', '安裝人員會現場拆裝門片'] },
    { re: /^route:[^:]+:[^:]+:pkg$/, caution: ['{area}較窄，外箱無法通過', '會在門口拆開外箱後再搬入'] },
    {
      re: /^route:[^:]+:[^:]+:h$/,
      high: ['{area}高度不夠，機器無法放入', '可能需要改走樓梯或吊掛，我們會再與您確認'],
      caution: ['{area}較低，搬運時需要傾斜機器', '安裝人員會小心搬運'],
    },
  ],
  washer: [
    { re: /^install:width$/, high: ['安裝位置寬度不夠，洗衣機放不進去', '需要換尺寸較小的機型，或另選安裝位置'], caution: ['安裝位置左右空間較緊', '洗衣機會貼近牆面，運轉時可能較容易碰到牆面'] },
    { re: /^install:depth$/, high: ['安裝位置深度不夠，洗衣機放不進去', '需要換深度較淺的機型，或另選安裝位置'], caution: ['洗衣機後方空間較緊', '水管與排水管需要彎折，安裝人員會現場調整'] },
    { re: /^install:height$/, high: ['上方空間高度不夠，洗衣機放不進去', '需要換高度較低的機型，或移除上方的櫃子、層架'], caution: ['上方空間非常緊', '安裝時需要確認上蓋或上方操作空間'] },
    { re: /^faucet:none$/, high: ['沒有洗衣機專用水龍頭', '安裝前請先請水電師傅加裝'] },
    { re: /^drain:none$/, high: ['沒有排水位置', '安裝前請先處理排水'] },
    { re: /^(faucet|drain):len:/, caution: ['水龍頭或排水孔離機器較遠，水管可能不夠長', '需要準備加長水管'] },
  ],
  fridge: [
    { re: /^install:width:/, high: ['安裝位置寬度不夠，冰箱放不進去', '需要換尺寸較小的機型，或另選安裝位置'], caution: ['冰箱兩側的散熱空間不足', '可以安裝，但可能比較耗電、運轉聲較大'] },
    { re: /^install:depth:/, high: ['安裝位置深度不夠，冰箱放不進去', '需要換深度較淺的機型，或另選安裝位置'], caution: ['冰箱後方的散熱空間不足', '可以安裝，但可能比較耗電'] },
    { re: /^install:height:/, high: ['上方空間高度不夠，冰箱放不進去', '需要換高度較低的機型，或移除上方的吊櫃'], caution: ['冰箱上方的散熱空間不足', '可以安裝，但可能比較耗電'] },
    { re: /^door:width:/, caution: ['冰箱靠牆或嵌入，門可能無法開到 90 度', '抽屜或層架可能無法完全取出，建議門片鉸鏈側與牆面保留空間'] },
    { re: /^water:len:/, caution: ['水源離冰箱較遠，進水管可能不夠長', '需要準備延長管與接頭'] },
    { re: /^heat$/, caution: ['冰箱旁邊有爐具、烤箱或陽光直射', '可能比較耗電，建議保持距離或加裝隔熱板'] },
  ],
}

export function customerItem(templateId: string, f: Finding, areas: SurveyArea[]): CustomerItem | null {
  const rules = [...(RULES[templateId] ?? []), ...RULES.common]
  const r = rules.find((x) => x.re.test(f.id))
  if (!r) return null
  const pair = f.level === 'high' ? r.high : f.level === 'caution' ? r.caution : f.level === 'info' ? r.info : undefined
  if (!pair) return null
  const area = areas.find((a) => a.id === f.areaId)?.name ?? '通道'
  return { kind: f.level === 'high' ? 'adjust' : 'prepare', text: pair[0].replace('{area}', area), action: pair[1] }
}

/** 一個檢查的客戶版項目（相同文字只列一次，需要調整的排前面） */
export function customerItems(templateId: string, findings: Finding[], areas: SurveyArea[]): CustomerItem[] {
  const seen = new Set<string>()
  const out: CustomerItem[] = []
  for (const f of findings) {
    const it = customerItem(templateId, f, areas)
    if (!it || seen.has(it.text)) continue
    seen.add(it.text)
    out.push(it)
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'adjust' ? -1 : 1))
}
