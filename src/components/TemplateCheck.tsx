import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addArea, addPhoto, saveTemplate, templateRowId, updatePhotoCaption } from '../db/repo'
import { compressImage } from '../lib/image'
import type { ShotItem, TemplateField } from '../templates/washer'
import { matchingProducts, TEMPLATES, type TemplateDef } from '../templates'
import { RISK_LABEL, type CheckResult, type Finding, type RiskLevel } from '../rules/types'
import { Button, Icon } from './ui'
import { CheckBoard } from './CheckBoard'
import { allStepStatus } from '../pages/FieldPage'
import { useToast } from './Toast'

export const LEVEL_STYLE: Record<RiskLevel, string> = {
  high: 'border-red-700 bg-red-50 text-red-800',
  confirm: 'border-oak bg-sand text-ink',
  caution: 'border-amber-400/50 bg-amber-500/10 text-ink',
  info: 'border-white/[0.12] bg-white/[0.07] text-ink/75',
}

/** 載入模板檢查需要的資料，並計算結果（報告頁也共用）；id = templateRowId(surveyId, def.id) */
export async function loadTemplateCheck(def: TemplateDef, surveyId: string, id: string) {
  const [tpl, areasAll, products, photos] = await Promise.all([
    db.survey_templates.get(id),
    db.survey_areas.where('survey_id').equals(surveyId).toArray(),
    db.survey_products.where('survey_id').equals(surveyId).toArray(),
    db.survey_photos.where('survey_id').equals(surveyId).toArray(),
  ])
  const areas = areasAll.filter((a) => !a.deleted_at).sort((a, b) => a.sort_order - b.sort_order)
  const live = products.filter((p) => !p.deleted_at)
  const activeTpl = tpl && !tpl.deleted_at ? tpl : null
  const hasProduct = matchingProducts(def, live).length > 0
  const active = !!activeTpl || hasProduct
  const areaIds = new Set(areas.map((a) => a.id))
  const shotsTaken = new Set(photos.filter((p) => !p.deleted_at && p.shot_key && areaIds.has(p.area_id)).map((p) => p.shot_key!))
  const values = activeTpl?.values ?? {}
  const installAreaId = activeTpl?.install_area_id ?? null
  const result = active ? def.check({ values, installAreaId, areas, products: live, shotsTaken }) : null
  return { active, values, installAreaId, areas, shotsTaken, result, installArea: def.pickArea(areas, installAreaId), hasProduct, products: live }
}

function ChoiceField({ f, value, onChange }: { f: TemplateField; value: unknown; onChange: (v: string | null) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] text-ink">{f.label}{f.required && <span className="ml-1 text-oak">*</span>}</legend>
      {f.hint && <p className="-mt-1 mb-1.5 text-xs text-sub">{f.hint}</p>}
      <div className="flex flex-wrap gap-1 rounded-[22px] bg-white/[0.06] p-1" role="radiogroup" aria-label={f.label}>
        {f.options!.map((o) => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-field={f.key}
              data-value={o.value}
              onClick={() => onChange(on ? null : o.value)}
              className={`h-10 min-w-16 flex-1 rounded-full px-3 text-sm ${on ? 'glass-dark' : 'text-ink active:bg-white/10'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function InputField({ f, value, onSave }: { f: TemplateField; value: unknown; onSave: (v: string | number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(value == null ? '' : String(value))
  }, [value])
  const commit = () => {
    editing.current = false
    const t = text.trim()
    if (f.type === 'cm') {
      if (t === '') return value != null && onSave(null)
      const n = Number(t)
      if (!Number.isFinite(n) || n < 0) return setText(value == null ? '' : String(value))
      if (n !== value) onSave(Math.round(n * 10) / 10)
    } else if ((t || null) !== (value ?? null)) onSave(t || null)
  }
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] text-ink">{f.label}{f.required && <span className="ml-1 text-oak">*</span>}{f.type === 'cm' && <span className="ml-1 text-xs text-sub">（公分）</span>}</span>
      {f.hint && <span className="mb-1 block text-xs text-sub">{f.hint}</span>}
      <input
        value={text}
        inputMode={f.type === 'cm' ? 'decimal' : undefined}
        data-field={f.key}
        aria-label={f.label}
        placeholder={f.type === 'cm' ? '未測量' : ''}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="block w-full border-0 border-b border-white/20 bg-transparent px-0 py-2 text-[17px] tabular-nums focus:border-ink focus:outline-none focus:ring-0"
      />
    </label>
  )
}

export function FindingItem({ f }: { f: Finding }) {
  return (
    <li className={`border-l-2 px-3 py-2.5 ${LEVEL_STYLE[f.level]}`} data-level={f.level} data-finding={f.id}>
      <div className="text-[11px] tracking-[0.12em]">{RISK_LABEL[f.level]}</div>
      <div className="mt-0.5 text-[15px] font-medium text-ink">{f.title}</div>
      <div className="mt-1 text-[13px] text-ink/80">{f.why}</div>
      <div className="mt-1 text-[12px] text-sub">依據：{f.basis}</div>
      <div className="mt-1 text-[13px] text-ink">建議：{f.suggestion}</div>
    </li>
  )
}

export function ResultSummary({ r }: { r: CheckResult }) {
  const levels: RiskLevel[] = ['high', 'confirm', 'caution', 'info']
  return (
    <div className="grid grid-cols-4 gap-1.5 text-center" aria-label="檢查結果統計">
      {levels.map((l) => (
        <div key={l} className={`rounded-2xl py-2 ${r.counts[l] && l === 'high' ? 'bg-red-100/70' : 'bg-white/[0.06]'}`}>
          <div className={`text-xl font-light tabular-nums ${r.counts[l] && l === 'high' ? 'text-red-700' : ''}`} data-count={l}>{r.counts[l]}</div>
          <div className="text-[10px] tracking-[0.08em] text-sub">{RISK_LABEL[l]}</div>
        </div>
      ))}
    </div>
  )
}

/** 場勘頁的模板檢查區塊（洗衣機、冰箱…） */
/** show：active = 只顯示已啟用的檢查；inactive = 只顯示「啟用」按鈕（收在產品與資料裡） */
export function TemplateCheck({ def, surveyId, show }: { def: TemplateDef; surveyId: string; show: 'active' | 'inactive' }) {
  const toast = useToast()
  // 模板資料列 ID 需用 crypto 計算，先算好再交給 liveQuery（liveQuery 內只放 Dexie 查詢）
  const [tplId, setTplId] = useState<string | null>(null)
  useEffect(() => void templateRowId(surveyId, def.id).then(setTplId), [surveyId])
  const data = useLiveQuery(() => (tplId ? loadTemplateCheck(def, surveyId, tplId) : undefined), [def, surveyId, tplId])
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingShot = useRef<ShotItem | null>(null)
  const [busy, setBusy] = useState(false)
  // 詳細欄位與拍攝清單預設收起（現場請用「現場拍攝」一步一步填）
  const [expanded, setExpanded] = useState(false)
  if (!data || data.active !== (show === 'active')) return null
  const save = (patch: Parameters<typeof saveTemplate>[3]) =>
    saveTemplate(surveyId, def.id, def.version, patch).catch((e) => toast(`儲存失敗：${e instanceof Error ? e.message : e}`))

  if (!data.active)
    return (
      <section className="mt-3" aria-label={def.title}>
        <button className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink" onClick={() => void save({})}>
          {def.enableLabel}
        </button>
      </section>
    )

  const { values: v, result: r, areas, installArea } = data
  const set = (key: string, val: string | number | null) => void save({ values: { [key]: val } })

  async function onShotFile(files: FileList | null) {
    const shot = pendingShot.current
    if (!files?.length || !shot) return
    const area = def.shotArea(shot, areas, installArea)
    if (!area) return toast('請先新增場勘區域')
    setBusy(true)
    try {
      for (const f of [...files]) {
        const id = await addPhoto(area.id, await compressImage(f), shot.key)
        await updatePhotoCaption(id, shot.label)
      }
      toast(`已儲存「${shot.label}」照片到「${area.name}」`)
    } catch (e) {
      toast(`照片無法讀取：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const stepStates = allStepStatus(def, data as never)
  const shots = def.shots.filter((s) => s.when?.(v) ?? true)
  return (
    <section className="glass-card my-3 p-5" aria-label={def.title}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">{def.title}</h2>
        {/* 完成度只給測試與報告用；畫面上的進度以「現場拍攝」為準，避免兩種數字 */}
        <span className="sr-only" data-testid={`${def.id}-score`}>完成度 {r!.score.percent}%</span>
      </div>
      {!data.hasProduct && <p className="mt-2 text-xs text-sub">{def.noProductHint}</p>}

      {/* 檢查結果：燈號儀表板 */}
      <CheckBoard
        def={def}
        result={r!}
        stepDone={new Map(def.steps.map((st, i) => [st.key, stepStates[i].done]))}
        products={data.products}
        installArea={installArea}
        stacked={v.stacked === 'yes'}
      />

      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
        className="glass mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-[14px] text-ink"
      >
        {expanded ? '收起詳細欄位' : '展開全部欄位與拍攝清單'}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden className={expanded ? 'rotate-180' : ''}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {expanded && (<div className="hsp-reveal">
      {/* 安裝位置 */}
      <div className="mt-5 space-y-1">
        <label className="block text-[13px] text-ink" htmlFor={`${def.id}-install-area`}>安裝位置（使用該區域的寬深高）</label>
        <select
          id={`${def.id}-install-area`}
          value={installArea?.id ?? ''}
          onChange={(e) => void save({ install_area_id: e.target.value || null })}
          className="glass block h-12 w-full rounded-full px-4 text-[15px]"
        >
          {!installArea && <option value="">請選擇</option>}
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{[a.width_cm, a.depth_cm, a.height_cm].map((x) => x ?? '—').join(' × ')}）
            </option>
          ))}
        </select>
        <p className="text-xs text-sub">其他有量寬度的區域會當作搬運路線檢查（大門、走廊、電梯、樓梯）。</p>
        {!installArea && def.installAreaName && (
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={async () => {
              const id = await addArea(surveyId, 'other', def.installAreaName!)
              await save({ install_area_id: id })
              document.getElementById(`area-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {Icon.plus} 新增「{def.installAreaName}」區域
          </Button>
        )}
      </div>

      {/* 模板欄位 */}
      <div className="mt-5 space-y-6">
        {def.sections.map((sec) => (
          <div key={sec.title}>
            <h3 className="mb-2 border-b border-ink pb-1 text-[13px] font-medium tracking-[0.08em]">{sec.title}</h3>
            <div className="space-y-4">
              {sec.fields.filter((f) => def.showIf[f.key]?.(v) ?? true).map((f) =>
                f.type === 'choice' ? (
                  <ChoiceField key={f.key} f={f} value={v[f.key]} onChange={(x) => set(f.key, x)} />
                ) : (
                  <InputField key={f.key} f={f} value={v[f.key]} onSave={(x) => set(f.key, x)} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 拍攝清單 */}
      <div className="mt-6">
        <h3 className="mb-2 flex items-baseline justify-between border-b border-ink pb-1 text-[13px] font-medium tracking-[0.08em]">
          <span>拍攝清單</span>
          <span className="font-normal tabular-nums text-sub">{shots.filter((s) => data.shotsTaken.has(s.key)).length} / {shots.length}</span>
        </h3>
        <ul className="divide-y divide-line">
          {shots.map((s) => {
            const done = data.shotsTaken.has(s.key)
            return (
              <li key={s.key} className="flex items-center gap-3 py-2" data-shot={s.key} data-done={done ? 1 : 0}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-ink text-canvas' : 'border-[1.5px] border-dashed border-white/30 text-transparent'}`} aria-hidden>✓</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px]">{s.label}</div>
                  <div className="truncate text-xs text-sub">{s.hint}</div>
                </div>
                <Button
                  variant="secondary"
                  className="h-10 min-h-10 px-3 text-sm"
                  disabled={busy}
                  aria-label={`拍攝 ${s.label}`}
                  onClick={() => {
                    pendingShot.current = s
                    fileRef.current?.click()
                  }}
                >
                  {Icon.camera}{done ? '再拍' : '拍照'}
                </Button>
              </li>
            )
          })}
        </ul>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="shot-input" onChange={(e) => { void onShotFile(e.target.files); e.target.value = '' }} />
        <p className="mt-2 text-xs text-sub">照片會存到對應的區域，並自動填上說明。</p>
      </div>
      </div>)}
    </section>
  )
}

/** 場勘頁所有模板檢查（洗衣機、冰箱…） */
export function TemplateChecks({ surveyId, show }: { surveyId: string; show: 'active' | 'inactive' }) {
  return (
    <>
      {TEMPLATES.map((d) => (
        <TemplateCheck key={d.id} def={d} surveyId={surveyId} show={show} />
      ))}
    </>
  )
}
