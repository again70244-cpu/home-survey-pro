import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { deleteArea, updateArea, type AreaPatch } from '../db/repo'
import { AREA_KIND_LABEL, type SurveyArea } from '../db/types'
import { useUserId } from '../auth/AuthProvider'
import { Button, Card, Icon, IconButton, TextArea, TextInput, TopBar } from '../components/ui'
import { RowSync } from '../components/SyncBadge'
import { useToast } from '../components/Toast'
import { dimState } from '../lib/completeness'
import { PhotoSection } from '../components/PhotoSection'
import { SyncStatusBar } from '../components/SyncStatusBar'

type DimKey = 'width_cm' | 'depth_cm' | 'height_cm'
const DIMS: { key: DimKey; label: string; hint: string }[] = [
  { key: 'width_cm', label: '寬度', hint: 'W' },
  { key: 'depth_cm', label: '深度', hint: 'D' },
  { key: 'height_cm', label: '高度', hint: 'H' },
]

/** 解析尺寸輸入：空白 → null（尚未測量）；支援全形數字；最多一位小數 */
export function parseCm(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/\s|cm|公分/gi, '')
  if (s === '') return { ok: true, value: null }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: '請輸入數字' }
  const v = Math.round(Number(s) * 10) / 10
  if (v > 99999) return { ok: false, error: '數字過大' }
  return { ok: true, value: v }
}

const toText = (v: number | null) => (v === null || v === undefined ? '' : String(v))

function DimInput({ label, hint, text, error, onChange }: { label: string; hint: string; text: string; error?: string; onChange: (t: string) => void }) {
  const empty = text.trim() === ''
  return (
    <label className={`block rounded-2xl border-2 bg-white p-3 transition focus-within:border-brand-500 ${error ? 'border-red-300' : empty ? 'border-dashed border-slate-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-700">
          {label} <span className="font-normal text-slate-400">{hint}</span>
        </span>
        {empty ? <span className="text-amber-600">尚未測量</span> : error ? <span className="text-red-600">{error}</span> : <span className="text-emerald-600">已測量</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <input
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          value={text}
          placeholder="—"
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-4xl font-bold tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none"
          aria-label={`${label}（公分）`}
        />
        <span className="text-lg font-medium text-slate-500">cm</span>
        {!empty && (
          <button type="button" onClick={() => onChange('')} className="rounded-full px-2 py-1 text-sm text-slate-400 active:bg-slate-100" aria-label={`清除${label}`}>
            清除
          </button>
        )}
      </div>
    </label>
  )
}

/** 每個區域用獨立元件實例（以 areaId 當 key），切換區域時狀態不會混用 */
export function AreaPage() {
  const { areaId } = useParams()
  return <AreaEditor key={areaId} />
}

function AreaEditor() {
  const { id: surveyId, areaId } = useParams()
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()

  const data = useLiveQuery(async () => {
    const area = await db.survey_areas.get(areaId!)
    if (!area || area.user_id !== userId || area.deleted_at || area.survey_id !== surveyId) return null
    const siblings = (await db.survey_areas.where('survey_id').equals(surveyId!).toArray())
      .filter((a) => !a.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
    return { area, siblings }
  }, [areaId, surveyId, userId])

  // 本地編輯狀態（自動儲存）
  const [text, setText] = useState<Record<DimKey, string> & { name: string; notes: string }>({ width_cm: '', depth_cm: '', height_cm: '', name: '', notes: '' })
  const [errors, setErrors] = useState<Partial<Record<DimKey, string>>>({})
  const [saved, setSaved] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const pending = useRef<AreaPatch>({})
  const timer = useRef<number | undefined>(undefined)
  const loadedFor = useRef<string | null>(null)

  const area = data?.area
  // 初次載入，或沒有待儲存的修改時（例如其他裝置同步過來）才用資料庫值更新畫面
  useEffect(() => {
    if (!area) return
    if (loadedFor.current === area.id && Object.keys(pending.current).length) return
    loadedFor.current = area.id
    setText({ width_cm: toText(area.width_cm), depth_cm: toText(area.depth_cm), height_cm: toText(area.height_cm), name: area.name, notes: area.notes ?? '' })
    setErrors({})
  }, [area])

  // 這個元件只屬於一個區域：存檔目標固定為建立時的 areaId
  const targetId = useRef(areaId!).current
  const leaving = useRef(false) // 已點擊離開：不再接受輸入，避免寫到上一個區域
  async function flush() {
    window.clearTimeout(timer.current)
    const patch = pending.current
    if (!Object.keys(patch).length) return
    pending.current = {}
    try {
      await updateArea(targetId, patch)
      setSaved('saved')
    } catch {
      pending.current = { ...patch, ...pending.current }
      setSaved('error')
    }
  }
  // 離開頁面時一定存檔
  useEffect(() => () => void flush(), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flush()
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  })

  function queue(patch: AreaPatch) {
    if (leaving.current) return
    pending.current = { ...pending.current, ...patch }
    setSaved('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 500)
  }

  function onDim(key: DimKey, t: string) {
    setText((s) => ({ ...s, [key]: t }))
    const r = parseCm(t)
    if (!r.ok) {
      setErrors((e) => ({ ...e, [key]: r.error }))
      return
    }
    setErrors((e) => ({ ...e, [key]: undefined }))
    queue({ [key]: r.value })
  }

  if (data === undefined) return null
  if (data === null)
    return (
      <div className="min-h-dvh">
        <TopBar title="區域" left={<IconButton label="返回" onClick={() => nav(`/survey/${surveyId}`)}>{Icon.back}</IconButton>} />
        <p className="p-8 text-center text-slate-500">這個區域不存在或已刪除</p>
      </div>
    )

  const { siblings } = data
  const a = data.area as SurveyArea
  const idx = siblings.findIndex((s) => s.id === a.id)
  const prev = siblings[idx - 1]
  const next = siblings[idx + 1]
  const { state } = dimState(a)

  function go(to: string) {
    leaving.current = true
    void flush() // 以本區域 ID 在背景存檔，畫面立即切換
    nav(to, { replace: true })
  }

  async function onDelete() {
    if (!confirm(`確定刪除「${a.name}」？\n此區域的尺寸與照片都會刪除。`)) return
    window.clearTimeout(timer.current)
    pending.current = {}
    await deleteArea(a.id)
    toast('已刪除區域')
    nav(`/survey/${surveyId}`, { replace: true })
  }

  return (
    <div className="min-h-dvh pb-28">
      <TopBar
        title={text.name || a.name}
        left={<IconButton label="返回" onClick={() => go(`/survey/${surveyId}`)}>{Icon.back}</IconButton>}
      />
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <SyncStatusBar />
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {AREA_KIND_LABEL[a.kind]}・第 {idx + 1} / {siblings.length} 區
          </span>
          <span className="flex items-center gap-2">
            <span className={saved === 'error' ? 'text-red-600' : 'text-slate-400'}>
              {saved === 'pending' ? '儲存中…' : saved === 'saved' ? '已儲存到本機' : saved === 'error' ? '儲存失敗，請重試' : ''}
            </span>
            <RowSync row={a} />
          </span>
        </div>

        <section className="space-y-3">
          {DIMS.map((d) => (
            <DimInput key={d.key} label={d.label} hint={d.hint} text={text[d.key]} error={errors[d.key]} onChange={(t) => onDim(d.key, t)} />
          ))}
          <p className="px-1 text-xs text-slate-400">
            {state === 'complete' ? '✓ 三項尺寸已完成' : '留空代表尚未測量，報告會標示「尚未測量」，不會當成 0'}
          </p>
        </section>

        <PhotoSection areaId={a.id} />

        <Card className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600">區域名稱</span>
            <TextInput
              value={text.name}
              onChange={(e) => {
                setText((s) => ({ ...s, name: e.target.value }))
                if (e.target.value.trim()) queue({ name: e.target.value.trim() })
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-600">區域備註</span>
            <TextArea
              value={text.notes}
              placeholder="例如：門框有凸出 2cm、需拆門、轉角較窄…"
              onChange={(e) => {
                setText((s) => ({ ...s, notes: e.target.value }))
                queue({ notes: e.target.value.trim() || null })
              }}
            />
          </label>
        </Card>


        <Button variant="danger" className="w-full" onClick={() => void onDelete()}>
          刪除這個區域
        </Button>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3">
          <Button variant="secondary" disabled={!prev} onClick={() => prev && go(`/survey/${surveyId}/area/${prev.id}`)} className="h-14 disabled:opacity-40">
            ‹ {prev ? prev.name : '上一區'}
          </Button>
          {next ? (
            <Button onClick={() => go(`/survey/${surveyId}/area/${next.id}`)} className="h-14">
              {next.name} ›
            </Button>
          ) : (
            <Button onClick={() => go(`/survey/${surveyId}`)} className="h-14">
              完成
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
