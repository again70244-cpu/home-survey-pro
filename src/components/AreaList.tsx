import { useState } from 'react'
import { addArea, OTHER_AREA_PRESETS } from '../db/repo'
import type { AreaKind } from '../db/types'
import type { AreaStatus, SurveySummary } from '../lib/completeness'
import { Button, Icon, TextInput } from './ui'
import { useToast } from './Toast'
import { AreaEditorCard } from './AreaEditorCard'

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'todo' | 'info'; children: React.ReactNode }) {
  const cls = { ok: 'text-[#555]', warn: 'text-oak', todo: 'text-oak', info: 'text-sub' }[tone]
  return <span className={`text-xs ${cls}`}>{children}</span>
}

export function AreaChips({ s }: { s: AreaStatus }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
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
    <section className="glass-card my-3 p-5" aria-label="場勘完成度">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">場勘完成度</h2>
        <span className={`text-xs ${sum.complete ? 'text-[#555]' : 'text-oak'}`}>{sum.complete ? '✓ 場勘完整' : '尚未完成'}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-light tabular-nums text-ink">{sum.completeAreas}</span>
        <span className="text-sm text-sub">/ {total} 個區域完成（尺寸＋照片）</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.08]">
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      {sum.missing.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen((v) => !v)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-[13px] text-amber-700">
            {open ? '收起' : `離開現場前請確認：${sum.missing.length} 項未完成`}
          </button>
          {open && (
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {sum.missing.map((m) => (
                <li key={m} className="flex gap-2">
                  <span className="text-oak">—</span>
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {sum.unsynced && <p className="mt-2 text-sm text-oak">— 有資料尚未同步到雲端</p>}
    </section>
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
    <div className="fixed inset-0 z-40 flex items-end bg-black/30" onClick={onClose}>
      <div className="w-full rounded-t-[28px] bg-white/95 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-6 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-5 text-2xl font-light text-ink">新增場勘區域</h3>
        <div className="text-xs tracking-[0.18em] text-sub">基本區域</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([['balcony', '陽台'], ['elevator', '電梯'], ['stairs', '樓梯']] as const).map(([k, n]) => (
            <Button key={k} variant="secondary" onClick={() => void add(k, n)}>{n}</Button>
          ))}
        </div>
        <div className="mt-5 text-xs tracking-[0.18em] text-sub">其他</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {OTHER_AREA_PRESETS.map((n) => (
            <Button key={n} variant="secondary" onClick={() => void add('other', n)}>{n}</Button>
          ))}
        </div>
        <form
          className="mt-5 flex items-end gap-3"
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
    <div>
      <div className="flex items-baseline justify-between border-t border-line pt-5">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">場勘區域（{list.length}）</h2>
        {list.length > 1 && (
          <button onClick={() => setSorting((v) => !v)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink">
            {sorting ? '完成排序' : '調整排序'}
          </button>
        )}
      </div>
      {list.map((s, i) => <AreaEditorCard key={s.area.id} s={s} index={i} total={list.length} sorting={sorting} />)}
      {list.length === 0 && <p className="py-8 text-center text-sm text-sub">還沒有區域</p>}
      <Button variant="secondary" className="mt-5 w-full" onClick={() => setAdding(true)}>
        {Icon.plus} 新增區域
      </Button>
      {adding && <AddAreaSheet surveyId={surveyId} onClose={() => setAdding(false)} />}
    </div>
  )
}
