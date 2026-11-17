import { useState } from 'react'
import { addArea, OTHER_AREA_PRESETS } from '../db/repo'
import type { AreaKind } from '../db/types'
import type { AreaStatus, SurveySummary } from '../lib/completeness'
import { Button, Card, Icon, TextInput } from './ui'
import { useToast } from './Toast'
import { AreaEditorCard } from './AreaEditorCard'

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'todo' | 'info'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-700 ring-amber-200',
    todo: 'bg-slate-100 text-slate-600 ring-slate-200',
    info: 'bg-brand-50 text-brand-700 ring-brand-100',
  }[tone]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{children}</span>
}

export function AreaChips({ s }: { s: AreaStatus }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.dims === 'complete' ? <Chip tone="ok">✓ 尺寸已完成</Chip> : s.dims === 'partial' ? <Chip tone="warn">尺寸 {s.measured}/3</Chip> : <Chip tone="todo">尚未測量</Chip>}
      {s.photos > 0 ? <Chip tone="ok">✓ 已拍照 {s.photos} 張</Chip> : <Chip tone="todo">尚未拍照</Chip>}
      {s.unsynced && <Chip tone="warn">尚未同步</Chip>}
    </div>
  )
}

export function CompletenessCard({ sum }: { sum: SurveySummary }) {
  const [open, setOpen] = useState(false)
  const total = sum.areas.length
  const pct = total ? Math.round((sum.completeAreas / total) * 100) : 0
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500">場勘完成度</h2>
        {sum.complete ? <Chip tone="ok">✓ 場勘完整</Chip> : <Chip tone="warn">尚未完成</Chip>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{sum.completeAreas}</span>
        <span className="text-slate-500">/ {total} 個區域完成（尺寸＋照片）</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${sum.complete ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {sum.missing.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen((v) => !v)} className="text-sm font-medium text-amber-700">
            {open ? '收起' : `離開現場前請確認：${sum.missing.length} 項未完成`} {open ? '▲' : '▼'}
          </button>
          {open && (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {sum.missing.map((m) => (
                <li key={m} className="flex gap-2">
                  <span className="text-amber-500">•</span>
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {sum.unsynced && <p className="mt-2 text-sm text-amber-700">• 有資料尚未同步到雲端</p>}
    </Card>
  )
}

function AddAreaSheet({ surveyId, onClose }: { surveyId: string; onClose: () => void }) {
  const toast = useToast()
  const [custom, setCustom] = useState('')
  async function add(kind: AreaKind, name: string) {
    const id = await addArea(surveyId, kind, name)
    toast(`已新增「${name}」`)
    onClose()
    // 新區域出現在列表最後，捲動過去並聚焦寬度欄位
    const started = Date.now()
    const tryFocus = () => {
      const el = document.getElementById(`area-${id}`)
      const input = el?.querySelector<HTMLInputElement>('input[data-dim]')
      if (!el || !input) {
        if (Date.now() - started < 3000) setTimeout(tryFocus, 50)
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      input.focus({ preventScroll: true })
    }
    tryFocus()
  }
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/40" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
        <h3 className="mb-3 text-lg font-semibold text-slate-900">新增場勘區域</h3>
        <div className="text-xs font-semibold text-slate-500">基本區域</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([['balcony', '陽台'], ['elevator', '電梯'], ['stairs', '樓梯']] as const).map(([k, n]) => (
            <Button key={k} variant="secondary" onClick={() => void add(k, n)}>{n}</Button>
          ))}
        </div>
        <div className="mt-4 text-xs font-semibold text-slate-500">其他</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {OTHER_AREA_PRESETS.map((n) => (
            <Button key={n} variant="secondary" onClick={() => void add('other', n)}>{n}</Button>
          ))}
        </div>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom.trim()) void add('other', custom.trim())
          }}
        >
          <TextInput placeholder="自訂區域名稱，例如：後陽台門" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button type="submit" disabled={!custom.trim()} className="shrink-0">新增</Button>
        </form>
      </div>
    </div>
  )
}

export function AreaList({ surveyId, sum }: { surveyId: string; sum: SurveySummary }) {
  const [adding, setAdding] = useState(false)
  const [sorting, setSorting] = useState(false)
  const list = sum.areas

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500">場勘區域（{list.length}）</h2>
        {list.length > 1 && (
          <button onClick={() => setSorting((v) => !v)} className="rounded-lg px-2 py-1 text-sm font-medium text-brand-600 active:bg-brand-50">
            {sorting ? '完成排序' : '調整排序'}
          </button>
        )}
      </div>
      {list.map((s, i) => <AreaEditorCard key={s.area.id} s={s} index={i} total={list.length} sorting={sorting} />)}
      {list.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white py-6 text-center text-sm text-slate-400">還沒有區域</p>}
      <Button variant="secondary" className="w-full border-dashed" onClick={() => setAdding(true)}>
        {Icon.plus} 新增區域
      </Button>
      {adding && <AddAreaSheet surveyId={surveyId} onClose={() => setAdding(false)} />}
    </div>
  )
}
