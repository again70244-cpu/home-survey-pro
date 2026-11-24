/**
 * 燈號：把檢查結果依類別歸類，每格取最嚴重的等級
 *   high 高風險 > caution 注意 > confirm 待確認 > todo 未填 > ok 正常
 * 「未填」：該類別對應的現場拍攝步驟還沒完成，且沒有任何提醒（避免沒填資料卻顯示綠燈）
 */
import type { LightGroup } from '../templates'
import type { Finding } from './types'

export type LightState = 'high' | 'caution' | 'confirm' | 'todo' | 'ok'
export const LIGHT_LABEL: Record<LightState, string> = { high: '高風險', caution: '注意', confirm: '待確認', todo: '未填', ok: '正常' }

export interface Light {
  group: LightGroup
  state: LightState
  findings: Finding[]
}

/** stepDone：現場拍攝步驟 key → 是否完成 */
export function computeLights(groups: LightGroup[], findings: Finding[], stepDone: Map<string, boolean>): Light[] {
  const dataGroup = groups.find((g) => g.key === 'data')
  const byGroup = new Map<string, Finding[]>(groups.map((g) => [g.key, []]))
  for (const f of findings) {
    const g = groups.find((x) => x.key !== 'data' && x.match(f.id)) ?? dataGroup
    if (g) byGroup.get(g.key)!.push(f)
  }
  return groups.map((g) => {
    const fs = byGroup.get(g.key)!
    const has = (l: Finding['level']) => fs.some((f) => f.level === l)
    const pending = g.steps.some((k) => stepDone.get(k) === false)
    const state: LightState = has('high') ? 'high' : has('caution') ? 'caution' : has('confirm') ? 'confirm' : pending ? 'todo' : 'ok'
    return { group: g, state, findings: fs }
  })
}

/** 整體結論：高風險 → 需要處理；注意或待確認 → 需留意；未填 → 尚未完成；全部正常 → 可以安裝 */
export function verdict(lights: Light[]): { state: LightState; text: string } {
  const n = (s: LightState) => lights.filter((l) => l.state === s).length
  if (n('high')) return { state: 'high', text: `${n('high')} 類高風險，需要處理` }
  if (n('caution') || n('confirm')) return { state: n('caution') ? 'caution' : 'confirm', text: [n('caution') && `${n('caution')} 類需注意`, n('confirm') && `${n('confirm')} 類待確認`].filter(Boolean).join('・') }
  if (n('todo')) return { state: 'todo', text: `還有 ${n('todo')} 類尚未填寫` }
  return { state: 'ok', text: '目前評估可以安裝' }
}
