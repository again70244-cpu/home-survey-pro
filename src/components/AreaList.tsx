import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addArea, moveArea, OTHER_AREA_PRESETS } from '../db/repo'
import type { AreaKind } from '../db/types'
import type { AreaStatus, SurveySummary } from '../lib/completeness'
import { formatCm } from '../lib/format'
import { Button, Card, Icon, TextInput } from './ui'
import { useToast } from './Toast'

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
  const nav = useNavigate()
  const toast = useToast()
  const [custom, setCustom] = useState('')
  async function add(kind: AreaKind, name: string) {
    const id = await addArea(surveyId, kind, name)
    toast(`已新增「${name}」`)
    onClose()
    nav(`/survey/${surveyId}/area/${id}`)
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
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)
  const [sorting, setSorting] = useState(false)
  const list = sum.areas

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500">場勘區域</h2>
        {list.length > 1 && (
          <button onClick={() => setSorting((v) => !v)} className="rounded-lg px-2 py-1 text-sm font-medium text-brand-600 active:bg-brand-50">
            {sorting ? '完成排序' : '調整排序'}
          </button>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {list.map((s, i) => (
          <li key={s.area.id} className="flex items-center gap-2 py-3">
            <button className="min-w-0 flex-1 text-left" disabled={sorting} onClick={() => nav(`/survey/${surveyId}/area/${s.area.id}`)}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-base font-semibold text-slate-900">{s.area.name}</span>
                {!sorting && <span className="text-slate-300">{Icon.chevron}</span>}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1 text-sm tabular-nums">
                {(['寬', '深', '高'] as const).map((l, k) => {
                  const v = [s.area.width_cm, s.area.depth_cm, s.area.height_cm][k]
                  return (
                    <span key={l} className={v === null ? 'text-slate-400' : 'font-medium text-slate-800'}>
                      {l} {formatCm(v)}
                    </span>
                  )
                })}
              </div>
              <div className="mt-2">
                <AreaChips s={s} />
              </div>
            </button>
            {sorting && (
              <div className="flex flex-col gap-1">
                <button aria-label={`${s.area.name} 上移`} disabled={i === 0} onClick={() => void moveArea(surveyId, s.area.id, -1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-lg disabled:opacity-30 active:bg-slate-100">↑</button>
                <button aria-label={`${s.area.name} 下移`} disabled={i === list.length - 1} onClick={() => void moveArea(surveyId, s.area.id, 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-lg disabled:opacity-30 active:bg-slate-100">↓</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="py-4 text-center text-sm text-slate-400">還沒有區域</p>}
      <Button variant="secondary" className="mt-2 w-full border-dashed" onClick={() => setAdding(true)}>
        {Icon.plus} 新增區域
      </Button>
      {adding && <AddAreaSheet surveyId={surveyId} onClose={() => setAdding(false)} />}
    </Card>
  )
}
