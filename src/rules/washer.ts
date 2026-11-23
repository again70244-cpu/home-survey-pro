/**
 * 洗衣機／洗衣塔防呆規則（v1）
 *
 * 純函式、確定性：相同輸入一定得到相同結果，不使用 AI、不連網。
 * 所有長度單位為公分；產品規格取自場勘當下凍結的規格快照（spec_snapshot）。
 * 規則只做「提醒」，不會阻止存檔或出報告。
 */
import type { SurveyArea, SurveyProduct } from '../db/types'
import { SPEC_LABELS } from '../../supabase/functions/_shared/catalog/installText.ts'
import { WASHER_CLEARANCE, WASHER_SECTIONS, WASHER_SHOTS, isWasherCategory } from '../templates/washer'
import { countLevels, sortFindings, type CheckResult, type Finding, type RiskLevel } from './types'

export const WASHER_RULES_ID = 'washer'
export const WASHER_RULES_VERSION = 1
const RV = `規則 washer v${WASHER_RULES_VERSION}`

export type TemplateValues = Record<string, string | number | null | undefined>

export interface WasherInput {
  values: TemplateValues
  /** 使用者指定的安裝位置區域；null = 自動判斷 */
  installAreaId: string | null
  areas: SurveyArea[]
  products: SurveyProduct[]
  /** 已有照片的拍攝項目 key */
  shotsTaken: Set<string>
}

type Spec = { model: string; get: (f: string) => number | null }

function specOf(p: SurveyProduct): Spec {
  const s = p.spec_snapshot as Record<string, unknown>
  return {
    model: p.model_code,
    get: (f) => {
      const v = s?.[`${f}_cm`] // 產品知識庫欄位名稱一律以 _cm 結尾
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
    },
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const fmt = (n: number) => `${Math.round(n * 10) / 10} cm`

/** 安裝位置：使用者指定 → 名稱含「安裝位置」→ 陽台 */
export function pickInstallArea(areas: SurveyArea[], installAreaId: string | null): SurveyArea | null {
  const live = areas.filter((a) => !a.deleted_at)
  if (installAreaId) {
    const a = live.find((x) => x.id === installAreaId)
    if (a) return a
  }
  return live.find((a) => a.name.includes('安裝位置')) ?? live.find((a) => a.kind === 'balcony') ?? null
}

/** 適用此模板的產品（依分類） */
export function washerProducts(products: SurveyProduct[]): SurveyProduct[] {
  return products.filter((p) => !p.deleted_at && isWasherCategory(p.category ?? (p.spec_snapshot?.category as string | null)))
}

export function checkWasher(input: WasherInput): CheckResult {
  const out: Finding[] = []
  const add = (level: RiskLevel, id: string, title: string, why: string, basis: string, suggestion: string, extra: Partial<Finding> = {}) =>
    out.push({ id, level, title, why, basis, suggestion, ...extra })
  const v = input.values
  const C = WASHER_CLEARANCE
  const products = washerProducts(input.products)
  const specs = products.map(specOf)
  const stacked = v.stacked === 'yes'
  const area = pickInstallArea(input.areas, input.installAreaId)

  // ---- 產品 ----------------------------------------------------------------
  if (!specs.length) {
    add('confirm', 'product:none', '尚未選擇洗衣機產品', '沒有產品規格就無法比對空間、水電與搬運路線', RV, '在「預計安裝產品」選擇洗衣機或乾衣機型號')
  }
  if (stacked && specs.length === 1) {
    add('confirm', 'stack:one', '選擇上下疊放，但只選了一台產品', '疊放高度需要上下兩台的高度相加', RV, '再選擇另一台疊放的產品，或改為「單台」')
  }
  for (const s of specs) {
    const miss = ['width', 'depth', 'height'].filter((f) => s.get(f) === null)
    if (miss.length)
      add('confirm', `spec:${s.model}`, `${s.model} 缺少機身尺寸`, '缺少產品規格時，空間判斷不可靠', `產品規格快照缺少：${miss.map(fieldName).join('、')}`, '依原廠型錄確認尺寸，並請管理者更新產品知識庫', { model: s.model })
  }

  // ---- 不合理數值（單位輸入錯誤） --------------------------------------------
  for (const a of input.areas.filter((x) => !x.deleted_at)) {
    for (const [k, label] of [['width_cm', '寬'], ['depth_cm', '深'], ['height_cm', '高']] as const) {
      const n = a[k]
      if (n === null) continue
      if (n > 600) add('caution', `unit:${a.id}:${k}`, `${a.name} ${label} ${fmt(n)} 數值異常偏大`, '可能誤以毫米輸入（例如 650 mm 輸入成 650 cm）', `${RV}：區域尺寸超過 600 cm 視為異常`, '確認單位是否為公分', { areaId: a.id, field: k })
      else if (n < 20) add('caution', `unit:${a.id}:${k}`, `${a.name} ${label} ${fmt(n)} 數值異常偏小`, '可能誤以公尺輸入（例如 0.7 m 輸入成 0.7）', `${RV}：區域尺寸小於 20 cm 視為異常`, '確認單位是否為公分', { areaId: a.id, field: k })
    }
  }
  for (const f of ['front_clearance_cm', 'faucet_distance_cm', 'drain_distance_cm', 'outlet_distance_cm']) {
    const n = num(v[f])
    if (n !== null && n > 1000) add('caution', `unit:${f}`, `${fieldLabel(f)} ${fmt(n)} 數值異常偏大`, '可能誤以毫米輸入', `${RV}：距離超過 1000 cm 視為異常`, '確認單位是否為公分', { field: f })
  }

  // ---- 安裝空間 ------------------------------------------------------------
  if (!area) {
    add('confirm', 'install:none', '尚未指定安裝位置', '需要安裝位置的寬深高才能判斷放不放得下', RV, '在洗衣機檢查中選擇安裝位置的區域，或新增名為「安裝位置」的區域')
  } else if (specs.length) {
    const ws = specs.map((s) => s.get('width'))
    const ds = specs.map((s) => s.get('depth'))
    const hs = specs.map((s) => s.get('height'))
    const W = ws.every((x) => x !== null) ? Math.max(...(ws as number[])) : null
    const D = ds.every((x) => x !== null) ? Math.max(...(ds as number[])) : null
    const H = hs.every((x) => x !== null) ? (stacked ? (hs as number[]).reduce((a, b) => a + b, 0) : Math.max(...(hs as number[]))) : null
    const models = specs.map((s) => s.model).join(' + ')
    const missDims = (['width_cm', 'depth_cm'] as const).filter((k) => area[k] === null)
    if (missDims.length)
      add('confirm', 'install:dims', `安裝位置「${area.name}」尚未量${missDims.map((k) => (k === 'width_cm' ? '寬' : '深')).join('、')}`, '缺少現場尺寸就無法判斷放不放得下', RV, '補量安裝位置的寬度與深度', { areaId: area.id })

    if (W !== null && area.width_cm !== null) {
      const need = W + C.side_each_cm * 2
      if (area.width_cm < W)
        add('high', 'install:width', `安裝位置寬度不足，機器放不進去`, `空間寬 ${fmt(area.width_cm)}，機身寬 ${fmt(W)}，差 ${fmt(W - area.width_cm)}`, `${models} 機身寬 ${fmt(W)}；${RV}`, '更換較窄的型號或另選安裝位置', { areaId: area.id, field: 'width_cm' })
      else if (area.width_cm < need)
        add('caution', 'install:width', `安裝位置左右預留空間不足`, `空間寬 ${fmt(area.width_cm)}，機身寬 ${fmt(W)}，左右需各預留 ${C.side_each_cm} cm（共需 ${fmt(need)}）`, `${models} 機身寬 ${fmt(W)}；預留標準左右各 ${C.side_each_cm} cm（${RV}）`, '確認牆面與周邊是否可接受貼近安裝；運轉振動可能碰撞', { areaId: area.id, field: 'width_cm' })
    }
    if (D !== null && area.depth_cm !== null) {
      const need = D + C.back_cm
      if (area.depth_cm < D)
        add('high', 'install:depth', `安裝位置深度不足，機器放不進去`, `空間深 ${fmt(area.depth_cm)}，機身深 ${fmt(D)}，差 ${fmt(D - area.depth_cm)}`, `${models} 機身深 ${fmt(D)}；${RV}`, '更換較淺的型號或另選安裝位置', { areaId: area.id, field: 'depth_cm' })
      else if (area.depth_cm < need)
        add('caution', 'install:depth', `安裝位置後方預留空間不足`, `空間深 ${fmt(area.depth_cm)}，機身深 ${fmt(D)}，後方需預留 ${C.back_cm} cm 給水管與排水管（共需 ${fmt(need)}）`, `${models} 機身深 ${fmt(D)}；預留標準後方 ${C.back_cm} cm（${RV}）`, '確認水管、排水管與電源線是否會被壓折', { areaId: area.id, field: 'depth_cm' })
    }
    if (H !== null) {
      if (area.height_cm === null) {
        if (stacked || v.top_obstacle === 'yes' || v.top_obstacle === 'unsure')
          add('confirm', 'install:height', `安裝位置尚未量高度`, stacked ? `疊放總高 ${fmt(H)}，需要確認上方空間` : '上方有櫃子、窗戶或曬衣架，需要確認高度', `${models} ${stacked ? '疊放總高' : '機身高'} ${fmt(H)}；${RV}`, '補量安裝位置的可用高度（到上方最低障礙物）', { areaId: area.id, field: 'height_cm' })
      } else if (area.height_cm < H) {
        add('high', 'install:height', stacked ? '疊放總高度超過可用高度' : '機身高度超過可用高度', `可用高度 ${fmt(area.height_cm)}，${stacked ? '疊放總高' : '機身高'} ${fmt(H)}，差 ${fmt(H - area.height_cm)}`, `${models} ${stacked ? `高度相加 ${specs.map((s) => fmt(s.get('height')!)).join(' + ')}` : `機身高 ${fmt(H)}`}；${RV}`, '更換型號、改為單台，或移除上方障礙物', { areaId: area.id, field: 'height_cm' })
      } else if (area.height_cm - H < C.tight_cm) {
        add('caution', 'install:height', '上方空間非常緊', `可用高度 ${fmt(area.height_cm)}，${stacked ? '疊放總高' : '機身高'} ${fmt(H)}，只剩 ${fmt(area.height_cm - H)}`, `${models}；${RV}`, '確認上蓋或頂部是否需要開啟、安裝人員是否有操作空間', { areaId: area.id, field: 'height_cm' })
      }
    }
  }

  // ---- 門片開啟 ------------------------------------------------------------
  const front = num(v.front_clearance_cm)
  if (front !== null) {
    for (const s of specs) {
      const d = s.get('depth')
      for (const [f, label, level] of [
        ['door_open_90_depth', '門開 90 度', 'high'],
        ['full_open_depth', '門全開', 'caution'],
        ['drawer_open_depth', '抽屜拉出', 'caution'],
      ] as const) {
        const total = s.get(f)
        if (d === null || total === null || total <= d) continue
        const ext = total - d
        if (front < ext)
          add(level, `door:${s.model}:${f}`, `${s.model} ${label}時前方空間不足`, `${label}需凸出機身前方 ${fmt(ext)}，現場前方只有 ${fmt(front)}`, `${s.model} ${fieldName(f)} ${fmt(total)} − 機身深 ${fmt(d)}；${RV}`, level === 'high' ? '門片無法完全打開會影響放取衣物，請改位置或確認可接受' : '確認是否影響日常使用', { model: s.model, field: 'front_clearance_cm' })
      }
    }
    if (specs.length && specs.every((s) => s.get('door_open_90_depth') === null && s.get('full_open_depth') === null))
      add('info', 'door:nospec', '產品沒有開門深度資料', '無法判斷門片開啟時前方空間是否足夠', RV, '現場實際比對門片開啟範圍')
  }
  if (v.door_obstacle === 'yes') add('caution', 'door:obstacle', '門片開啟範圍內有障礙物', '門片可能撞到障礙物或無法完全打開', RV, '拍照記錄障礙物位置，確認是否可移除')
  else if (v.door_obstacle === 'unsure') add('confirm', 'door:obstacle', '不確定門片開啟範圍是否有障礙物', '門片撞到障礙物會影響使用', RV, '現場確認門片開啟範圍')

  // ---- 水電與排水 ----------------------------------------------------------
  const hoseCheck = (opts: {
    key: string; presence: unknown; distKey: string; specField: string; name: string; specName: string
    noLevel: RiskLevel; noTitle: string; noWhy: string; noSuggest: string
  }) => {
    const p = opts.presence
    if (p === 'no' || p === 'none') return add(opts.noLevel, `${opts.key}:none`, opts.noTitle, opts.noWhy, RV, opts.noSuggest)
    if (p === 'unsure') return add('confirm', `${opts.key}:unsure`, `不確定${opts.name}狀況`, `${opts.name}是安裝必要條件`, RV, `現場確認${opts.name}位置並拍照`)
    if (p == null || p === '') return
    const dist = num(v[opts.distKey])
    if (dist === null) return
    for (const s of specs) {
      const len = s.get(opts.specField)
      if (len === null) {
        const shared = s.get('inlet_drain_hose')
        if (opts.specField !== 'power_cable' && shared !== null) {
          if (dist > shared) add('confirm', `${opts.key}:shared:${s.model}`, `${s.model} ${opts.name}距離可能超過管線長度`, `距離 ${fmt(dist)}，型錄只列出進排水管長度 ${fmt(shared)}，無法分辨是進水或排水`, `${s.model} 進排水管 ${fmt(shared)}；${RV}`, '依原廠資料確認進水管與排水管各自長度', { model: s.model, field: opts.distKey })
        } else add('confirm', `${opts.key}:nospec:${s.model}`, `${s.model} 缺少${opts.specName}資料`, `無法判斷${opts.name}距離是否足夠`, `產品規格快照缺少${opts.specName}；${RV}`, '依原廠型錄確認長度', { model: s.model })
        continue
      }
      if (dist > len)
        add(opts.specField === 'power_cable' ? 'high' : 'caution', `${opts.key}:len:${s.model}`, `${s.model} ${opts.specName}長度不足`, `${opts.name}距離 ${fmt(dist)}，${opts.specName} ${fmt(len)}，差 ${fmt(dist - len)}`, `${s.model} ${opts.specName} ${fmt(len)}；${RV}`, opts.specField === 'power_cable' ? '不建議使用延長線，請安排移設插座' : `需準備加長${opts.specName}或移設位置`, { model: s.model, field: opts.distKey })
    }
  }
  hoseCheck({ key: 'faucet', presence: v.faucet, distKey: 'faucet_distance_cm', specField: 'water_inlet_hose', name: '水龍頭', specName: '進水管', noLevel: 'high', noTitle: '沒有洗衣機專用水龍頭', noWhy: '沒有進水就無法安裝', noSuggest: '安裝前需請水電師傅加裝水龍頭' })
  hoseCheck({ key: 'drain', presence: v.drain_type, distKey: 'drain_distance_cm', specField: 'drain_hose', name: '排水', specName: '排水管', noLevel: 'high', noTitle: '沒有排水位置', noWhy: '沒有排水就無法安裝', noSuggest: '安裝前需處理排水' })
  hoseCheck({ key: 'outlet', presence: v.outlet, distKey: 'outlet_distance_cm', specField: 'power_cable', name: '插座', specName: '電源線', noLevel: 'high', noTitle: '附近沒有插座', noWhy: '不建議使用延長線供電', noSuggest: '安裝前需請水電師傅加裝插座' })
  if (v.drain_type === 'wall') add('info', 'drain:wall', '牆面排水', '牆面排水管的高度可能影響排水', RV, '量測牆面排水口離地高度並拍照')
  if (v.outlet_grounded === 'no') add('caution', 'outlet:ground', '插座沒有接地', '洗衣機屬於潮濕環境用電，未接地有觸電風險', RV, '建議請水電師傅改為接地插座')
  else if (v.outlet_grounded === 'unsure' && (v.outlet === 'yes')) add('info', 'outlet:ground', '不確定插座是否接地', '未接地有觸電風險', RV, '確認是否為三孔插座')
  if (v.dedicated_circuit === 'no') add('info', 'outlet:circuit', '不是專用迴路', '烘乾功能耗電較高，與其他電器共用可能跳電', RV, '提醒客戶避免同時使用大功率電器')

  // ---- 地面與周邊 ----------------------------------------------------------
  if (v.floor_level === 'no') add('caution', 'floor', '地面不平整', '運轉時會振動、位移或發出噪音', RV, '安裝時需調整腳座，嚴重時需墊平')
  else if (v.floor_level === 'unsure') add('confirm', 'floor', '不確定地面是否平整', '地面不平會造成運轉振動', RV, '用水平儀或手機水平功能確認')
  if (v.top_obstacle === 'yes') add('info', 'top', '上方有櫃子、窗戶或曬衣架', '可能影響上掀蓋開啟或安裝作業', RV, '拍攝上方照片並確認高度')

  // ---- 搬運路線 ------------------------------------------------------------
  const route = input.areas.filter((a) => !a.deleted_at && a.id !== area?.id)
  for (const s of specs) {
    const w = s.get('width'), d = s.get('depth'), h = s.get('height')
    if (w === null || d === null) continue
    const bodyMin = Math.min(w, d)
    const pw = s.get('package_width'), pd = s.get('package_depth')
    const pkgMin = pw !== null && pd !== null ? Math.min(pw, pd) : null
    for (const a of route) {
      if (a.width_cm === null) continue
      const isElev = a.kind === 'elevator'
      if (a.width_cm < bodyMin) {
        // 電梯：寬不夠但深度夠時可轉向
        if (isElev && a.depth_cm !== null && a.depth_cm >= bodyMin) {
          // 可轉向放入，不提醒
        } else {
          add('high', `route:${a.id}:${s.model}:body`, `${a.name}寬度不足，${s.model} 機身無法通過`, `${a.name}寬 ${fmt(a.width_cm)}，機身最窄面 ${fmt(bodyMin)}`, `${s.model} 寬 ${fmt(w)} × 深 ${fmt(d)}；${RV}`, '確認是否可拆門框、改走其他路線，或改用吊掛', { areaId: a.id, model: s.model, field: 'width_cm' })
          continue
        }
      }
      if (pkgMin !== null && a.width_cm < pkgMin && !(isElev && a.depth_cm !== null && a.depth_cm >= pkgMin))
        add('caution', `route:${a.id}:${s.model}:pkg`, `${a.name}無法帶外箱通過`, `${a.name}寬 ${fmt(a.width_cm)}，外箱最窄面 ${fmt(pkgMin)}；機身可通過`, `${s.model} 外箱 ${fmt(pw!)} × ${fmt(pd!)}；${RV}`, '需在入口前拆箱搬運，並告知客戶外箱處理方式', { areaId: a.id, model: s.model, field: 'width_cm' })
      if (h !== null && a.height_cm !== null && a.height_cm < h) {
        // 可傾斜：截面對角線 ≥ 機身高
        const diag = a.depth_cm !== null ? Math.hypot(a.depth_cm, a.height_cm) : null
        if (isElev && diag !== null && diag < h)
          add('high', `route:${a.id}:${s.model}:h`, `${s.model} 無法放入${a.name}`, `${a.name}高 ${fmt(a.height_cm)}、深 ${fmt(a.depth_cm!)}，斜放也放不下高 ${fmt(h)} 的機身`, `${s.model} 高 ${fmt(h)}；${RV}`, '改走樓梯或吊掛', { areaId: a.id, model: s.model, field: 'height_cm' })
        else
          add('caution', `route:${a.id}:${s.model}:h`, `${a.name}高度低於機身，需要傾斜搬運`, `${a.name}高 ${fmt(a.height_cm)}，機身高 ${fmt(h)}`, `${s.model} 高 ${fmt(h)}；${RV}`, '洗衣機傾斜搬運需注意，確認是否可行', { areaId: a.id, model: s.model, field: 'height_cm' })
      }
    }
  }
  if (specs.length)
    for (const a of route.filter((x) => x.kind === 'elevator' && (x.width_cm === null || x.depth_cm === null)))
      add('confirm', `route:${a.id}:dims`, `${a.name}尚未量寬或深`, '電梯尺寸不足時需改走樓梯，影響搬運人力', RV, '補量電梯門寬與內部深度', { areaId: a.id })
  if (specs.length && !route.some((a) => a.width_cm !== null))
    add('confirm', 'route:none', '搬運路線尚未測量', '大門、走廊、電梯或樓梯過窄會導致無法送達', RV, '至少量測大門寬度，以及電梯或樓梯寬度', {})

  // ---- 必填欄位與拍攝清單 → 完成度 ----------------------------------------
  const conditional: Record<string, () => boolean> = {
    faucet_distance_cm: () => v.faucet === 'yes',
    drain_distance_cm: () => v.drain_type === 'floor' || v.drain_type === 'wall',
    outlet_distance_cm: () => v.outlet === 'yes',
  }
  const required = WASHER_SECTIONS.flatMap((s) => s.fields).filter((f) => f.required && (conditional[f.key]?.() ?? true))
  const missing = required.filter((f) => v[f.key] == null || v[f.key] === '')
  if (missing.length)
    add('confirm', 'fields:missing', `還有 ${missing.length} 個必要項目未填寫`, '未填寫的項目無法檢查', RV, `補填：${missing.map((f) => f.label).join('、')}`)
  const shotsMissing = WASHER_SHOTS.filter((s) => !input.shotsTaken.has(s.key))
  if (shotsMissing.length)
    add('info', 'shots:missing', `還有 ${shotsMissing.length} 個建議拍攝項目`, '照片是事後確認與安裝人員判斷的依據', RV, `補拍：${shotsMissing.map((s) => s.label).join('、')}`)
  const areaReq = area ? 2 : 1
  const areaDone = area ? (area.width_cm !== null ? 1 : 0) + (area.depth_cm !== null ? 1 : 0) : 0
  const total = required.length + WASHER_SHOTS.length + areaReq + 1
  const done = required.length - missing.length + (WASHER_SHOTS.length - shotsMissing.length) + areaDone + (specs.length ? 1 : 0)

  const findings = sortFindings(out)
  return {
    rulesId: WASHER_RULES_ID,
    rulesVersion: WASHER_RULES_VERSION,
    findings,
    score: { done, total, percent: Math.round((done / total) * 100) },
    counts: countLevels(findings),
  }
}

function fieldName(f: string) {
  return (SPEC_LABELS as Record<string, string>)[`${f}_cm`] ?? f
}
function fieldLabel(key: string) {
  return WASHER_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key)?.label ?? key
}
