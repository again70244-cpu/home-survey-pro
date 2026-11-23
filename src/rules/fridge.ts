/**
 * 冰箱防呆規則（v1）
 *
 * 純函式、確定性：相同輸入一定得到相同結果，不使用 AI、不連網。單位公分，規格取自規格快照。
 * 與洗衣機的主要差異：
 *   - 冰箱需直立搬運：電梯高度不足為高風險（不允許斜放）；門框或樓梯高度不足為注意（只能小角度傾斜）
 *   - 可拆門搬運：通道寬度不足但 ≥ 拆門總深 → 注意（需拆門）
 *   - 嵌入或靠牆：門開 90 度總寬 > 空間寬 → 門可能開不到 90 度，抽屜、層架可能無法取出
 *   - 上方空間一定要量
 */
import type { SurveyArea, SurveyProduct } from '../db/types'
import { SPEC_LABELS } from '../../supabase/functions/_shared/catalog/installText.ts'
import { FRIDGE_CLEARANCE, FRIDGE_SECTIONS, FRIDGE_SHOTS, isFridgeCategory } from '../templates/fridge'
import { fmt, num, productCategory, specOf, unitChecks, type AddFinding, type RuleInput } from './common'
import { countLevels, sortFindings, type CheckResult, type Finding } from './types'

export const FRIDGE_RULES_ID = 'fridge'
export const FRIDGE_RULES_VERSION = 1
const RV = `規則 fridge v${FRIDGE_RULES_VERSION}`

/** 安裝位置：使用者指定 → 名稱含「冰箱」→ 名稱含「安裝位置」→ 名稱含「廚房」（不預設陽台） */
export function pickFridgeArea(areas: SurveyArea[], installAreaId: string | null): SurveyArea | null {
  const live = areas.filter((a) => !a.deleted_at)
  if (installAreaId) {
    const a = live.find((x) => x.id === installAreaId)
    if (a) return a
  }
  for (const k of ['冰箱', '安裝位置', '廚房']) {
    const a = live.find((x) => x.name.includes(k))
    if (a) return a
  }
  return null
}

export function fridgeProducts(products: SurveyProduct[]): SurveyProduct[] {
  return products.filter((p) => !p.deleted_at && isFridgeCategory(productCategory(p)))
}

const label = (key: string) => FRIDGE_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key)?.label ?? key
const specName = (f: string) => (SPEC_LABELS as Record<string, string>)[`${f}_cm`] ?? f

export function checkFridge(input: RuleInput): CheckResult {
  const out: Finding[] = []
  const add: AddFinding = (level, id, title, why, basis, suggestion, extra = {}) => out.push({ id, level, title, why, basis, suggestion, ...extra })
  const v = input.values
  const C = FRIDGE_CLEARANCE
  const specs = fridgeProducts(input.products).map(specOf)
  const area = pickFridgeArea(input.areas, input.installAreaId)

  // ---- 產品 ----------------------------------------------------------------
  if (!specs.length) add('confirm', 'product:none', '尚未選擇冰箱產品', '沒有產品規格就無法比對空間、門片與搬運路線', RV, '在「安裝產品」選擇冰箱型號')
  if (specs.length > 1) add('info', 'product:many', `選擇了 ${specs.length} 台冰箱`, '檢查會逐台比對同一個安裝位置', RV, '如果是不同位置，請各自新增場勘或確認位置')
  for (const s of specs) {
    const miss = ['width', 'depth', 'height'].filter((f) => s.get(f) === null)
    if (miss.length)
      add('confirm', `spec:${s.model}`, `${s.model} 缺少機身尺寸`, '缺少產品規格時，空間判斷不可靠', `產品規格快照缺少：${miss.map(specName).join('、')}`, '依原廠型錄確認尺寸，並請管理者更新產品知識庫', { model: s.model })
  }

  unitChecks(add, input.areas, v, ['front_clearance_cm', 'outlet_distance_cm', 'water_source_distance_cm'], label, RV)

  // ---- 安裝空間 ------------------------------------------------------------
  if (!area) {
    add('confirm', 'install:none', '尚未指定冰箱安裝位置', '需要安裝位置的寬深高才能判斷放不放得下', RV, '新增名為「冰箱安裝位置」的區域並量寬深高，或在冰箱檢查中選擇區域')
  } else {
    const miss = (['width_cm', 'depth_cm', 'height_cm'] as const).filter((k) => area[k] === null)
    if (miss.length)
      add('confirm', 'install:dims', `安裝位置「${area.name}」尚未量${miss.map((k) => ({ width_cm: '寬', depth_cm: '深', height_cm: '高' })[k]).join('、')}`, '冰箱較高大，寬、深、高都需要現場尺寸', RV, '補量安裝位置的寬度、深度與可用高度（到上方吊櫃或樑）', { areaId: area.id })
    for (const s of specs) {
      const dims = [
        { k: 'width_cm', f: 'width', name: '寬', extra: C.side_each_cm * 2, extraText: `左右各 ${C.side_each_cm} cm`, why: '兩側需留散熱空間' },
        { k: 'depth_cm', f: 'depth', name: '深', extra: C.back_cm, extraText: `後方 ${C.back_cm} cm`, why: '背面需留散熱空間，電源線與插頭也需要位置' },
        { k: 'height_cm', f: 'height', name: '高', extra: C.top_cm, extraText: `上方 ${C.top_cm} cm`, why: '上方需留散熱空間，搬入定位時也需要操作空間' },
      ] as const
      for (const d of dims) {
        const have = area[d.k]
        const need = s.get(d.f)
        if (have === null || need === null) continue
        if (have < need)
          add('high', `install:${d.f}:${s.model}`, `安裝位置${d.name}度不足，${s.model} 放不進去`, `空間${d.name} ${fmt(have)}，機身${d.name} ${fmt(need)}，差 ${fmt(need - have)}`, `${s.model} 機身${d.name} ${fmt(need)}；${RV}`, '更換尺寸較小的型號，或另選安裝位置', { areaId: area.id, field: d.k, model: s.model })
        else if (have < need + d.extra)
          add('caution', `install:${d.f}:${s.model}`, `安裝位置${d.name}度預留空間不足`, `空間${d.name} ${fmt(have)}，機身${d.name} ${fmt(need)}，需預留${d.extraText}（共需 ${fmt(need + d.extra)}）；${d.why}`, `${s.model} 機身${d.name} ${fmt(need)}；預留標準${d.extraText}（${RV}）`, '散熱不足會較耗電、較吵，確認客戶是否接受', { areaId: area.id, field: d.k, model: s.model })
      }
      // 靠牆或嵌入：門開 90 度總寬
      const w = s.get('width')
      const doorW = s.get('door_open_90_width')
      if ((v.side_walls === 'one' || v.side_walls === 'both') && w !== null && doorW !== null && doorW > w && area.width_cm !== null && area.width_cm < doorW)
        add('caution', `door:width:${s.model}`, `${s.model} 門片可能無法開到 90 度`, `門開 90 度總寬 ${fmt(doorW)}，${v.side_walls === 'both' ? '嵌入空間' : '靠牆側空間'}寬 ${fmt(area.width_cm)}；門開不到 90 度時，抽屜或層架可能拿不出來`, `${s.model} ${specName('door_open_90_width')} ${fmt(doorW)}；${RV}`, '確認門片鉸鏈側與牆面的距離，必要時調整安裝位置', { areaId: area.id, model: s.model })
    }
  }
  if (v.side_walls === 'one' || v.side_walls === 'both') {
    if (specs.length && specs.every((s) => s.get('door_open_90_width') === null))
      add('info', 'door:width:nospec', '產品沒有門開 90 度總寬資料', '冰箱靠牆或嵌入時，無法判斷門片能否開到 90 度', RV, '現場確認門片鉸鏈側與牆面的距離')
  }

  // ---- 門片開啟（前方） ----------------------------------------------------
  const front = num(v.front_clearance_cm)
  if (front !== null) {
    for (const s of specs) {
      const d = s.get('depth')
      for (const [f, what, level] of [
        ['door_open_90_depth', '門開 90 度', 'high'],
        ['full_open_depth', '門全開', 'caution'],
        ['drawer_open_depth', '抽屜全開', 'caution'],
      ] as const) {
        const total = s.get(f)
        if (d === null || total === null || total <= d) continue
        const ext = total - d
        if (front < ext)
          add(level, `door:${s.model}:${f}`, `${s.model} ${what}時前方空間不足`, `${what}需凸出機身前方 ${fmt(ext)}，現場前方只有 ${fmt(front)}`, `${s.model} ${specName(f)} ${fmt(total)} − 機身深 ${fmt(d)}；${RV}`, level === 'high' ? '門片無法打開會無法使用，請改位置或移開障礙物' : '確認是否影響日常取放', { model: s.model, field: 'front_clearance_cm' })
      }
    }
  }
  if (v.door_obstacle === 'yes') add('caution', 'door:obstacle', '門片開啟範圍內有障礙物', '門片可能撞到障礙物或無法完全打開', RV, '拍照記錄障礙物位置，確認是否可移除')
  else if (v.door_obstacle === 'unsure') add('confirm', 'door:obstacle', '不確定門片開啟範圍是否有障礙物', '門片撞到障礙物會影響使用', RV, '現場確認門片開啟範圍')

  // ---- 電源 ----------------------------------------------------------------
  if (v.outlet === 'no') add('high', 'outlet:none', '附近沒有插座', '冰箱長時間運轉，不建議使用延長線', RV, '安裝前需請水電師傅加裝插座')
  else if (v.outlet === 'unsure') add('confirm', 'outlet:unsure', '不確定插座狀況', '插座是安裝必要條件', RV, '現場確認插座位置並拍照')
  else if (v.outlet === 'yes') {
    const dist = num(v.outlet_distance_cm)
    if (dist !== null)
      for (const s of specs) {
        const len = s.get('power_cable')
        if (len === null) add('confirm', `outlet:nospec:${s.model}`, `${s.model} 缺少電源線長度資料`, '無法判斷插座距離是否足夠', `產品規格快照缺少電源線長度；${RV}`, '依原廠型錄確認長度', { model: s.model })
        else if (dist > len) add('high', `outlet:len:${s.model}`, `${s.model} 電源線長度不足`, `插座距離 ${fmt(dist)}，電源線 ${fmt(len)}，差 ${fmt(dist - len)}`, `${s.model} 電源線 ${fmt(len)}；${RV}`, '不建議使用延長線，請安排移設插座', { model: s.model, field: 'outlet_distance_cm' })
      }
    if (v.outlet_grounded === 'no') add('caution', 'outlet:ground', '插座沒有接地', '冰箱為金屬外殼長時間通電，未接地有漏電風險', RV, '建議請水電師傅改為接地插座')
    else if (v.outlet_grounded === 'unsure') add('info', 'outlet:ground', '不確定插座是否接地', '未接地有漏電風險', RV, '確認是否為三孔插座')
    if (v.dedicated_circuit === 'no') add('info', 'outlet:circuit', '與其他電器共用插座', '與微波爐、電鍋等共用可能跳電，造成冰箱斷電', RV, '建議冰箱使用專用插座')
  }

  // ---- 進水管 --------------------------------------------------------------
  if (v.water_line === 'unsure') add('confirm', 'water:unsure', '不確定是否需要接進水管', '自動製冰或門外取水的機型需要接水管才能使用', RV, '依型號規格確認是否有製冰或取水功能')
  else if (v.water_line === 'yes') {
    const dist = num(v.water_source_distance_cm)
    if (dist !== null)
      for (const s of specs) {
        const len = s.get('water_inlet_hose')
        if (len === null)
          add('confirm', `water:nospec:${s.model}`, `${s.model} 沒有進水管長度資料`, `水源距離 ${fmt(dist)}，產品知識庫沒有進水管長度`, `產品規格快照缺少進水管長度；${RV}`, '確認原廠附的進水管長度，不足時需準備延長管與接頭', { model: s.model, field: 'water_source_distance_cm' })
        else if (dist > len)
          add('caution', `water:len:${s.model}`, `${s.model} 進水管長度不足`, `水源距離 ${fmt(dist)}，進水管 ${fmt(len)}，差 ${fmt(dist - len)}`, `${s.model} 進水管 ${fmt(len)}；${RV}`, '需準備延長管與接頭，或移設水源', { model: s.model, field: 'water_source_distance_cm' })
      }
  }

  // ---- 地面與周邊 ----------------------------------------------------------
  if (v.floor_level === 'no') add('caution', 'floor', '地面不平整', '冰箱傾斜會造成門片關不緊、運轉噪音', RV, '安裝時需調整腳座，嚴重時需墊平')
  else if (v.floor_level === 'unsure') add('confirm', 'floor', '不確定地面是否平整', '地面不平會造成門片關不緊', RV, '用水平儀或手機水平功能確認')
  if (v.heat_source === 'yes') add('caution', 'heat', '旁邊有爐具、烤箱或陽光直射', '周邊溫度高會增加耗電並影響冷藏效果', RV, '建議與熱源保持距離或加裝隔熱板')

  // ---- 搬運路線 ------------------------------------------------------------
  const route = input.areas.filter((a) => !a.deleted_at && a.id !== area?.id)
  for (const s of specs) {
    const w = s.get('width'), d = s.get('depth'), h = s.get('height')
    if (w === null || d === null) continue
    const bodyMin = Math.min(w, d)
    const noDoor = s.get('door_removed_depth')
    const noDoorMin = noDoor !== null ? Math.min(w, noDoor) : null
    const pw = s.get('package_width'), pd = s.get('package_depth')
    const pkgMin = pw !== null && pd !== null ? Math.min(pw, pd) : null
    for (const a of route) {
      if (a.width_cm === null) continue
      const isElev = a.kind === 'elevator'
      const fitsTurned = (min: number) => isElev && a.depth_cm !== null && a.depth_cm >= min
      if (a.width_cm < bodyMin && !fitsTurned(bodyMin)) {
        if (noDoorMin !== null && noDoorMin < bodyMin && (a.width_cm >= noDoorMin || fitsTurned(noDoorMin)))
          add('caution', `route:${a.id}:${s.model}:nodoor`, `${a.name}需拆門才能讓 ${s.model} 通過`, `${a.name}寬 ${fmt(a.width_cm)}，機身最窄面 ${fmt(bodyMin)}，拆門後 ${fmt(noDoorMin)}`, `${s.model} ${specName('door_removed_depth')} ${fmt(noDoor!)}；${RV}`, '安排拆門搬運並預留時間，告知客戶', { areaId: a.id, model: s.model, field: 'width_cm' })
        else
          add('high', `route:${a.id}:${s.model}:body`, `${a.name}寬度不足，${s.model} 無法通過`, `${a.name}寬 ${fmt(a.width_cm)}，機身最窄面 ${fmt(bodyMin)}${noDoorMin !== null ? `，拆門後 ${fmt(noDoorMin)} 也過不去` : ''}`, `${s.model} 寬 ${fmt(w)} × 深 ${fmt(d)}；${RV}`, '確認是否可拆門框、改走其他路線，或改用吊掛', { areaId: a.id, model: s.model, field: 'width_cm' })
        continue
      }
      if (pkgMin !== null && a.width_cm < pkgMin && !fitsTurned(pkgMin))
        add('caution', `route:${a.id}:${s.model}:pkg`, `${a.name}無法帶外箱通過`, `${a.name}寬 ${fmt(a.width_cm)}，外箱最窄面 ${fmt(pkgMin)}；機身可通過`, `${s.model} 外箱 ${fmt(pw!)} × ${fmt(pd!)}；${RV}`, '需在入口前拆箱搬運，並告知客戶外箱處理方式', { areaId: a.id, model: s.model, field: 'width_cm' })
      if (h !== null && a.height_cm !== null && a.height_cm < h) {
        if (isElev)
          add('high', `route:${a.id}:${s.model}:h`, `${s.model} 無法直立放入${a.name}`, `${a.name}高 ${fmt(a.height_cm)}，機身高 ${fmt(h)}；冰箱需直立搬運，不可平放`, `${s.model} 高 ${fmt(h)}；${RV}`, '改走樓梯或吊掛', { areaId: a.id, model: s.model, field: 'height_cm' })
        else
          add('caution', `route:${a.id}:${s.model}:h`, `${a.name}高度低於機身，需要傾斜搬運`, `${a.name}高 ${fmt(a.height_cm)}，機身高 ${fmt(h)}`, `${s.model} 高 ${fmt(h)}；${RV}`, '冰箱只能小角度傾斜，到定位後需靜置再通電', { areaId: a.id, model: s.model, field: 'height_cm' })
      }
    }
  }
  if (specs.length) {
    for (const a of route.filter((x) => x.kind === 'elevator' && (x.width_cm === null || x.depth_cm === null || x.height_cm === null)))
      add('confirm', `route:${a.id}:dims`, `${a.name}尚未量完寬、深、高`, '冰箱需直立搬運，電梯高度與深度不足時需改走樓梯', RV, '補量電梯門寬、內部深度與高度', { areaId: a.id })
    if (!route.some((a) => a.width_cm !== null))
      add('confirm', 'route:none', '搬運路線尚未測量', '大門、走廊、電梯或樓梯過窄會導致無法送達', RV, '至少量測大門寬度，以及電梯或樓梯的寬度與高度')
  }

  // ---- 完成度 --------------------------------------------------------------
  const conditional: Record<string, () => boolean> = {
    outlet_distance_cm: () => v.outlet === 'yes',
    water_source_distance_cm: () => v.water_line === 'yes',
  }
  const required = FRIDGE_SECTIONS.flatMap((s) => s.fields).filter((f) => f.required && (conditional[f.key]?.() ?? true))
  const missing = required.filter((f) => v[f.key] == null || v[f.key] === '')
  if (missing.length) add('confirm', 'fields:missing', `還有 ${missing.length} 個必要項目未填寫`, '未填寫的項目無法檢查', RV, `補填：${missing.map((f) => f.label).join('、')}`)
  const shots = FRIDGE_SHOTS.filter((s) => s.when?.(v) ?? true)
  const shotsMissing = shots.filter((s) => !input.shotsTaken.has(s.key))
  if (shotsMissing.length) add('info', 'shots:missing', `還有 ${shotsMissing.length} 個建議拍攝項目`, '照片是事後確認與安裝人員判斷的依據', RV, `補拍：${shotsMissing.map((s) => s.label).join('、')}`)
  const areaDone = area ? (['width_cm', 'depth_cm', 'height_cm'] as const).filter((k) => area[k] !== null).length : 0
  const total = required.length + shots.length + 3 + 1
  const done = required.length - missing.length + (shots.length - shotsMissing.length) + areaDone + (specs.length ? 1 : 0)

  const findings = sortFindings(out)
  return { rulesId: FRIDGE_RULES_ID, rulesVersion: FRIDGE_RULES_VERSION, findings, score: { done, total, percent: Math.round((done / total) * 100) }, counts: countLevels(findings) }
}
