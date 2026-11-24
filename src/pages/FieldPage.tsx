/**
 * 現場拍攝模式：一步一步完成量測、問題與拍照（先量測，再拍照）
 * 網址：/survey/:id/field/:tpl?step=0..n | done
 * 所有輸入立即寫入本機（與詳細頁面使用相同資料），可隨時離開、換裝置繼續。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addArea, addPhoto, saveTemplate, templateRowId, updateArea, updatePhotoCaption } from '../db/repo'
import type { AreaKind, SurveyArea, SurveyPhoto } from '../db/types'
import { useUserId } from '../auth/AuthProvider'
import { compressImage } from '../lib/image'
import { parseCm } from '../components/AreaEditorCard'
import { loadTemplateCheck } from '../components/TemplateCheck'
import { usePhotoUrl } from '../components/PhotoSection'
import { Icon } from '../components/ui'
import { useToast } from '../components/Toast'
import { TEMPLATES, type TemplateDef } from '../templates'
import { resolveTarget, stepStatus, visibleFields, visibleShots, type DimKey, type FieldStep, type StepContext } from '../templates/steps'
import type { ShotItem, TemplateField } from '../templates/washer'
import { RISK_LABEL, type Finding } from '../rules/types'

const DIM_LABEL: Record<DimKey, string> = { width_cm: '寬', depth_cm: '深', height_cm: '高' }
type Passage = 'elevator' | 'stairs'

/** 載入現場拍攝需要的資料（場勘頁的進度卡也共用） */
export async function loadField(def: TemplateDef, surveyId: string, tplId: string) {
  const [check, photos] = await Promise.all([loadTemplateCheck(def, surveyId, tplId), db.survey_photos.where('survey_id').equals(surveyId).toArray()])
  const areaIds = new Set(check.areas.map((a) => a.id))
  const livePhotos = photos.filter((p) => !p.deleted_at && areaIds.has(p.area_id))
  return { ...check, photos: livePhotos }
}
type FieldData = Awaited<ReturnType<typeof loadField>>

export function stepContext(def: TemplateDef, d: FieldData, area: SurveyArea | null): StepContext {
  return {
    values: d.values,
    fieldsByKey: new Map(def.sections.flatMap((s) => s.fields).map((f) => [f.key, f])),
    showIf: def.showIf,
    shotsByKey: new Map(def.shots.map((s) => [s.key, s])),
    shotsTaken: d.shotsTaken,
    area,
  }
}

/** 每一步的狀態（量測對象依預設規則找區域） */
export function allStepStatus(def: TemplateDef, d: FieldData) {
  return def.steps.map((s) => stepStatus(s, stepContext(def, d, s.dims ? resolveTarget(s.dims.target, d.areas, d.installArea) : null)))
}

function DimInput({ area, k, autoFocus }: { area: SurveyArea; k: DimKey; autoFocus?: boolean }) {
  const [text, setText] = useState(area[k] == null ? '' : String(area[k]))
  const [err, setErr] = useState('')
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(area[k] == null ? '' : String(area[k]))
  }, [area, k])
  const commit = () => {
    editing.current = false
    const r = parseCm(text)
    if (!r.ok) return setErr(r.error)
    setErr('')
    setText(r.value == null ? '' : String(r.value))
    if (r.value !== area[k]) void updateArea(area.id, { [k]: r.value })
  }
  const filled = text.trim() !== ''
  return (
    <label className={`block rounded-[18px] border-2 px-3 py-2.5 ${filled ? 'border-ink/80 bg-white/85' : 'border-transparent bg-white/55'}`}>
      <span className="flex items-baseline justify-between text-[13px] text-sub">
        <span>{DIM_LABEL[k]}</span>
        {err && <span className="text-red-700">{err}</span>}
      </span>
      <input
        data-field-dim={k}
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        autoFocus={autoFocus}
        value={text}
        placeholder="—"
        aria-label={`${area.name} ${DIM_LABEL[k]}（公分）`}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="mt-0.5 w-full min-w-0 border-0 bg-transparent p-0 text-[32px] font-light tabular-nums text-ink placeholder:text-[#c9c9c9] focus:outline-none focus:ring-0"
      />
    </label>
  )
}

function BigField({ f, value, onSave }: { f: TemplateField; value: unknown; onSave: (v: string | number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setText(value == null ? '' : String(value))
  }, [value])
  if (f.type === 'choice')
    return (
      <fieldset>
        <legend className="mb-2.5 text-[18px] text-ink">{f.label}{f.required && <span className="ml-1 text-oak">*</span>}</legend>
        {f.hint && <p className="-mt-1.5 mb-2.5 text-[13px] text-sub">{f.hint}</p>}
        <div className={`grid gap-2 ${f.options!.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`} role="radiogroup" aria-label={f.label}>
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
                onClick={() => onSave(on ? null : o.value)}
                className={`min-h-[58px] rounded-[20px] px-2 text-[16px] leading-tight ${on ? 'glass-dark' : 'glass text-ink'}`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  const commit = () => {
    editing.current = false
    const t = text.trim()
    if (f.type === 'cm') {
      const r = parseCm(t)
      if (!r.ok) return setText(value == null ? '' : String(value))
      if (r.value !== (value ?? null)) onSave(r.value)
    } else if ((t || null) !== (value ?? null)) onSave(t || null)
  }
  return (
    <label className="block">
      <span className="mb-2.5 block text-[18px] text-ink">{f.label}{f.required && <span className="ml-1 text-oak">*</span>}</span>
      {f.hint && <span className="-mt-1.5 mb-2.5 block text-[13px] text-sub">{f.hint}</span>}
      <span className={`flex items-baseline gap-2 rounded-[18px] border-2 px-4 py-2.5 ${text ? 'border-ink/80 bg-white/85' : 'border-transparent bg-white/55'}`}>
        <input
          data-field={f.key}
          inputMode={f.type === 'cm' ? 'decimal' : undefined}
          value={text}
          placeholder={f.type === 'cm' ? '—' : '選填'}
          aria-label={f.label}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-ink placeholder:text-[#c9c9c9] focus:outline-none focus:ring-0 ${f.type === 'cm' ? 'text-[32px] font-light tabular-nums' : 'text-[17px]'}`}
        />
        {f.type === 'cm' && <span className="text-[15px] text-sub">公分</span>}
      </span>
    </label>
  )
}

function Thumb({ p }: { p: SurveyPhoto }) {
  const { url } = usePhotoUrl(p.id)
  return (
    <span className="relative block h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl bg-sand-2">
      {url && <img src={url} alt={p.caption ?? ''} className="h-full w-full object-cover" />}
      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] text-white" aria-hidden>✓</span>
    </span>
  )
}

const LEVEL_TONE: Record<Finding['level'], string> = {
  high: 'border-red-700/25 bg-red-50/90',
  confirm: 'border-amber-700/25 bg-sand/90',
  caution: 'border-[#b8860b]/25 bg-[#fdf8ec]/90',
  info: 'border-white/80 bg-white/70',
}

export function FieldPage() {
  const { id, tpl } = useParams()
  const [params, setParams] = useSearchParams()
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()
  const def = TEMPLATES.find((t) => t.id === tpl)
  const [tplId, setTplId] = useState<string | null>(null)
  const [passage, setPassage] = useState<Passage | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<{ shot: ShotItem; areaId: string } | null>(null)
  useEffect(() => void (def && templateRowId(id!, def.id).then(setTplId)), [id, def])
  const data = useLiveQuery(async () => {
    if (!def || !tplId) return undefined
    const survey = await db.surveys.get(id!)
    if (!survey || survey.user_id !== userId || survey.deleted_at) return null
    return { survey, ...(await loadField(def, id!, tplId)) }
  }, [id, def, tplId, userId])

  const stepParam = params.get('step')
  const idx = stepParam === 'done' ? -1 : Math.max(0, Math.min((def?.steps.length ?? 1) - 1, Number(stepParam) || 0))
  useEffect(() => {
    window.scrollTo(0, 0) // 新版瀏覽器的 scrollTo 會回傳 Promise，不能直接當成 effect 的回傳值
  }, [stepParam])

  const statuses = useMemo(() => (def && data ? allStepStatus(def, data) : []), [def, data])

  if (!def) return <p className="p-8 text-center text-sub">找不到這個現場檢查</p>
  if (data === undefined) return null
  if (data === null) return <p className="p-8 text-center text-sub">這筆場勘不存在或已刪除</p>

  const d = data
  const steps = def.steps
  const shortTitle = def.title.replace('現場檢查', '')
  const go = (i: number | 'done') => setParams({ step: String(i) })
  const back = () => nav(`/survey/${id}`)
  const save = (patch: Parameters<typeof saveTemplate>[3]) =>
    saveTemplate(id!, def.id, def.version, patch).catch((e) => toast(`儲存失敗：${e instanceof Error ? e.message : e}`))

  async function onFile(files: FileList | null) {
    const p = pending.current
    if (!files?.length || !p) return
    setBusy(true)
    try {
      for (const f of [...files]) {
        const pid = await addPhoto(p.areaId, await compressImage(f), p.shot.key)
        await updatePhotoCaption(pid, p.shot.label)
      }
      toast(`已儲存「${p.shot.label}」照片`)
    } catch (e) {
      toast(`照片無法讀取：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  const doneCount = statuses.filter((s) => s.done).length
  const Progress = (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-[12px] text-sub">
        <span>{shortTitle}現場拍攝</span>
        <span data-testid="field-progress">{idx >= 0 ? `第 ${idx + 1} / ${steps.length} 步` : `完成 ${doneCount} / ${steps.length}`}</span>
      </div>
      <div className="mt-1.5 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(i)}
            aria-label={`第 ${i + 1} 步 ${s.title}${statuses[i]?.done ? '（已完成）' : ''}`}
            data-step-state={i === idx ? 'current' : statuses[i]?.done ? 'done' : 'todo'}
            className="flex h-5 items-center"
          >
            <span className={`block h-1 w-full rounded-full ${statuses[i]?.done ? 'bg-ink' : i === idx ? 'bg-ink/45' : 'bg-black/[0.12]'}`} />
          </button>
        ))}
      </div>
    </div>
  )

  // ---- 完成頁 -----------------------------------------------------------------
  if (idx === -1) {
    const notDone = steps.map((s, i) => ({ s, i, st: statuses[i] })).filter((x) => !x.st.done)
    const noPhoto = steps.map((s, i) => ({ s, i, st: statuses[i] })).filter((x) => x.st.photoMissing)
    const important = (d.result?.findings ?? []).filter((f) => f.level === 'high' || f.level === 'caution')
    return (
      <div className="min-h-dvh pb-48">
        <header className="sticky top-0 z-20 flex items-center gap-2.5 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
          <button type="button" onClick={back} aria-label="回到場勘頁" className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {Progress}
        </header>
        <main className="mx-auto max-w-2xl space-y-3 px-4">
          <div className="px-1.5 py-2 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
            </div>
            <h1 className="mt-3.5 text-[28px] font-normal" data-testid="field-done-title">現場拍攝完成 {doneCount} / {steps.length}</h1>
            <p className="mt-1.5 text-[15px] text-[#555]">
              {notDone.length ? `還有 ${notDone.length} 步未完成，離開前建議補上` : noPhoto.length ? `還有 ${noPhoto.length} 步沒拍照` : '全部完成'}
            </p>
          </div>
          {notDone.length > 0 && (
            <section className="glass-card px-4 py-1.5" aria-label="未完成的步驟">
              {notDone.map(({ s, i }) => (
                <div key={s.key} className="flex items-center gap-3 border-b border-black/[0.07] py-3 last:border-0">
                  <span className="h-7 w-7 shrink-0 rounded-full border-[1.5px] border-dashed border-black/35" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px]">{s.title}</div>
                    <div className="truncate text-[12px] text-sub">{s.hint}</div>
                  </div>
                  <button type="button" onClick={() => go(i)} className="glass-dark h-10 shrink-0 rounded-full px-4 text-[14px]" aria-label={`補填 ${s.title}`}>補填</button>
                </div>
              ))}
            </section>
          )}
          {noPhoto.length > 0 && (
            <section className="glass-card px-4 py-1.5" aria-label="還沒拍照的步驟">
              {noPhoto.map(({ s, i, st }) => (
                <div key={s.key} className="flex items-center gap-3 border-b border-black/[0.07] py-3 last:border-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-sub" aria-hidden>{Icon.camera}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px]">{s.title}</div>
                    <div className="text-[12px] text-sub">已量測・照片 {st.shotsDone} / {st.shotsTotal}</div>
                  </div>
                  <button type="button" onClick={() => go(i)} className="glass h-10 shrink-0 rounded-full px-4 text-[14px] text-ink" aria-label={`補拍 ${s.title}`}>補拍</button>
                </div>
              ))}
            </section>
          )}
          <section className="glass-card p-4" aria-label="檢查結果">
            <div className="text-[13px] text-sub">檢查結果</div>
            {important.length ? (
              <ul className="mt-2.5 space-y-2">
                {important.slice(0, 4).map((f) => (
                  <li key={f.id} className={`rounded-2xl border px-3.5 py-2.5 ${LEVEL_TONE[f.level]}`} data-finding={f.id} data-level={f.level}>
                    <div className="text-[11px] tracking-[0.12em] text-sub">{RISK_LABEL[f.level]}</div>
                    <div className="text-[16px]">{f.title}</div>
                    <div className="text-[13px] text-[#555]">{f.suggestion}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-ink">目前沒有高風險或注意事項</p>
            )}
          </section>
        </main>
        <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <div className="mx-auto max-w-2xl space-y-2">
            <button type="button" onClick={() => nav(`/survey/${id}/report`)} className="glass-dark h-14 w-full rounded-full text-[17px] tracking-[0.06em]">產生場勘報告</button>
            <button type="button" onClick={back} className="glass h-12 w-full rounded-full text-[15px] text-ink">回到場勘頁</button>
          </div>
        </div>
      </div>
    )
  }

  // ---- 單一步驟 ---------------------------------------------------------------
  const step: FieldStep = steps[idx]
  const target = step.dims ? resolveTarget(step.dims.target, d.areas, d.installArea, step.dims.target === 'passage' ? passage : null) : null
  const ctx = stepContext(def, d, target)
  const st = stepStatus(step, ctx)
  const fields = visibleFields(step, ctx)
  const shots = visibleShots(step, ctx)
  // 「尚未量測」類提醒在逐步填寫時只是干擾，這裡只顯示真正的問題（完成頁與場勘頁仍會列出）
  const related = (d.result?.findings ?? []).filter((f) => f.level !== 'info' && !f.id.endsWith(':dims') && step.findings(f, { areaId: target?.id ?? null }))
  const next = idx + 1 < steps.length ? steps[idx + 1] : null
  const passageKind: Passage = passage ?? (target?.kind === 'stairs' ? 'stairs' : 'elevator')
  const dimKeys = step.dims ? (step.dims.target === 'passage' && passageKind === 'stairs' ? (['width_cm', 'height_cm'] as DimKey[]) : step.dims.keys) : []

  async function createTarget() {
    if (!step.dims) return
    const t = step.dims.target
    const [kind, name]: [AreaKind, string] =
      t === 'install' ? ['other', def!.installAreaName ?? '安裝位置'] : t === 'door' ? ['other', '大門'] : passageKind === 'stairs' ? ['stairs', '樓梯'] : ['elevator', '電梯']
    const aid = await addArea(id!, kind, name)
    if (t === 'install') await save({ install_area_id: aid })
    toast(`已新增「${name}」`)
  }

  function shoot(shot: ShotItem) {
    const area = target ?? def!.shotArea(shot, d.areas, d.installArea)
    if (!area) return toast('請先新增場勘區域')
    pending.current = { shot, areaId: area.id }
    fileRef.current?.click()
  }

  const hasInputs = !!step.dims || fields.length > 0
  return (
    <div className="min-h-dvh pb-36">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)]">
        <button type="button" onClick={back} aria-label="結束現場拍攝" className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {Progress}
      </header>

      <main className="mx-auto max-w-2xl space-y-3.5 px-4" aria-label={`步驟 ${step.title}`}>
        <div className="px-1.5 pt-1">
          <h1 className="text-[30px] font-normal leading-tight">{step.title}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-[#555]">{step.hint}</p>
        </div>

        {hasInputs && (
          <section className="glass-card space-y-5 p-4" aria-label="量測與問題">
            <div className="flex items-center gap-2 text-[13px] text-sub">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-[12px] text-white">1</span>
              {step.dims ? '量尺寸（公分）' : '回答問題'}
            </div>
            {step.dims && (
              <div>
                {step.dims.target === 'passage' && (
                  <div className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-black/[0.06] p-1" role="radiogroup" aria-label="電梯或樓梯">
                    {(['elevator', 'stairs'] as const).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={passageKind === k} onClick={() => setPassage(k)} className={`h-10 rounded-full text-[15px] ${passageKind === k ? 'glass-dark' : 'text-ink'}`}>
                        {k === 'elevator' ? '電梯' : '樓梯'}
                      </button>
                    ))}
                  </div>
                )}
                {target ? (
                  <>
                    {step.dims.target !== 'install' && <div className="mb-2 text-[13px] text-sub">區域：{target.name}</div>}
                    {step.dims.target === 'install' && <div className="mb-2 text-[13px] text-sub">安裝位置：{target.name}</div>}
                    <div className={`grid gap-2 ${dimKeys.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {dimKeys.map((k, i) => <DimInput key={`${target.id}-${k}`} area={target} k={k} autoFocus={i === 0 && target[k] == null} />)}
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => void createTarget()} className="glass-dark flex h-14 w-full items-center justify-center gap-2 rounded-full text-[16px]">
                    {Icon.plus}
                    新增「{step.dims.target === 'install' ? def.installAreaName ?? '安裝位置' : step.dims.target === 'door' ? '大門' : passageKind === 'stairs' ? '樓梯' : '電梯'}」並開始量測
                  </button>
                )}
              </div>
            )}
            {fields.map((f) => <BigField key={f.key} f={f} value={d.values[f.key]} onSave={(v) => void save({ values: { [f.key]: v } })} />)}
            {related.length > 0 ? (
              <ul className="space-y-2" aria-label="這一步的提醒">
                {related.map((f) => (
                  <li key={f.id} className={`rounded-2xl border px-3.5 py-2.5 ${LEVEL_TONE[f.level]}`} data-finding={f.id} data-level={f.level}>
                    <div className="text-[11px] tracking-[0.12em] text-sub">{RISK_LABEL[f.level]}</div>
                    <div className="text-[15px]">{f.title}</div>
                    <div className="text-[13px] text-[#555]">{f.why}</div>
                  </li>
                ))}
              </ul>
            ) : (
              st.done && <p className="text-[14px] text-[#555]" data-testid="step-ok">✓ 這一步沒有發現問題</p>
            )}
          </section>
        )}

        {shots.length > 0 && (
          <section className="glass-card space-y-3 p-4" aria-label="拍照">
            <div className="flex items-center gap-2 text-[13px] text-sub">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-[12px] text-white">{hasInputs ? 2 : 1}</span>
              拍照
            </div>
            {shots.map((s) => {
              const ps = d.photos.filter((p) => p.shot_key === s.key)
              return (
                <div key={s.key} className="flex items-center gap-3" data-shot={s.key} data-done={ps.length ? 1 : 0}>
                  {ps.length ? <Thumb p={ps[ps.length - 1]} /> : (
                    <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-black/20 text-sub" aria-hidden>{Icon.camera}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px]">{s.label}</div>
                    <div className="text-[12px] text-sub">{ps.length ? `已拍 ${ps.length} 張` : s.hint}</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => shoot(s)} aria-label={`拍攝 ${s.label}`} className={`flex h-12 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] disabled:opacity-40 ${ps.length ? 'glass text-ink' : 'glass-dark'}`}>
                    {Icon.camera}{ps.length ? '再拍' : '拍照'}
                  </button>
                </div>
              )
            })}
            {busy && <p className="text-[13px] text-sub">處理照片中…</p>}
          </section>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="field-shot-input" onChange={(e) => { void onFile(e.target.files); e.target.value = '' }} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          {idx > 0 && (
            <button type="button" onClick={() => go(idx - 1)} aria-label="上一步" className="glass flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-ink">{Icon.back}</button>
          )}
          {!st.done && (
            <button type="button" onClick={() => go(next ? idx + 1 : 'done')} className="glass h-14 shrink-0 rounded-full px-5 text-[15px] text-ink">跳過</button>
          )}
          <button type="button" onClick={() => go(next ? idx + 1 : 'done')} className="glass-dark flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full text-[16px] tracking-[0.04em]">
            <span className="truncate">{next ? `下一步：${next.title}` : '完成'}</span>
            {Icon.chevron}
          </button>
        </div>
      </div>
    </div>
  )
}
