import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { TEMPLATES } from '../templates'
import { productTemplate } from '../rules/common'
import { addArea, OTHER_AREA_PRESETS } from '../db/repo'
import type { AreaKind } from '../db/types'
import type { AreaStatus, SurveySummary } from '../lib/completeness'
import { Button, Icon, TextInput } from './ui'
import { useToast } from './Toast'
import { AreaEditorCard } from './AreaEditorCard'

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'todo' | 'info'; children: React.ReactNode }) {
  const cls = { ok: 'text-ink/75', warn: 'text-oak', todo: 'text-oak', info: 'text-sub' }[tone]
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
        <span className={`text-xs ${sum.complete ? 'text-ink/75' : 'text-oak'}`}>{sum.complete ? '✓ 場勘完整' : '尚未完成'}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-light tabular-nums text-ink">{sum.completeAreas}</span>
        <span className="text-sm text-sub">/ {total} 個區域完成（尺寸＋照片）</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-accent shadow-[0_0_12px_rgb(103_232_249/0.6)]" style={{ width: `${pct}%` }} />
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
    </section>
  )
}

function AddAreaSheet({ surveyId, onClose, onAdded }: { surveyId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const toast = useToast()
  const [custom, setCustom] = useState('')
  async function add(kind: AreaKind, name: string) {
    const id = await addArea(surveyId, kind, name)
    toast(`已新增「${name}」`)
    onAdded(id) // 清單模式下直接展開新區域
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
      <div className="w-full rounded-t-[28px] bg-[#121724]/95 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-6 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
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

/** 這筆場勘是否有現場拍攝（選了洗衣機／冰箱等有模板的產品，或已啟用模板） */
export function useHasFieldMode(surveyId: string) {
  return useLiveQuery(async () => {
    const [products, templates] = await Promise.all([
      db.survey_products.where('survey_id').equals(surveyId).toArray(),
      db.survey_templates.where('survey_id').equals(surveyId).toArray(),
    ])
    const ids = new Set(TEMPLATES.map((t) => t.id))
    return products.some((p) => !p.deleted_at && ids.has(productTemplate(p) ?? '')) || templates.some((t) => !t.deleted_at && ids.has(t.template_id))
  }, [surveyId])
}

const dimText = (v: number | null) => (v == null ? '—' : String(v))

export function AreaList({ surveyId, sum }: { surveyId: string; sum: SurveySummary }) {
  const [adding, setAdding] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const fieldMode = useHasFieldMode(surveyId)
  const list = sum.areas
  // 有現場拍攝時：區域只顯示一行摘要，點開才編輯（同一份資料）；沒有時維持完整展開
  const compact = !!fieldMode && !showAll && !sorting
  const toggle = (id: string) => setOpen((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div>
      <div className="flex items-baseline justify-between border-t border-line pt-5">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">場勘區域（{list.length}）</h2>
        {list.length > 1 && !compact && (
          <button onClick={() => setSorting((v) => !v)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink">
            {sorting ? '完成排序' : '調整排序'}
          </button>
        )}
      </div>
      {compact ? (
        <ul className="glass-card my-3 px-4" aria-label="場勘區域清單">
          {list.map((s, i) => {
            const a = s.area
            const isOpen = open.has(a.id)
            return (
              <li key={a.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? '收起' : '編輯'}區域 ${a.name}`}
                  className="flex w-full items-center gap-3 py-3.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] text-ink">{a.name}</span>
                    <span className="mt-0.5 block text-[13px] tabular-nums text-sub">
                      {s.dims === 'none' ? '尚未量測' : `${dimText(a.width_cm)} × ${dimText(a.depth_cm)} × ${dimText(a.height_cm)} cm`}・{s.photos ? `照片 ${s.photos} 張` : '尚未拍照'}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sub transition ${isOpen ? 'rotate-90' : ''}`} aria-hidden>{Icon.chevron}</span>
                </button>
                {isOpen && <div className="hsp-reveal -mx-1 pb-2"><AreaEditorCard s={s} index={i} total={list.length} sorting={false} /></div>}
              </li>
            )
          })}
          {list.length === 0 && <li className="py-8 text-center text-sm text-sub">還沒有區域</li>}
        </ul>
      ) : (
        <>
          {list.map((s, i) => <AreaEditorCard key={s.area.id} s={s} index={i} total={list.length} sorting={sorting} />)}
          {list.length === 0 && <p className="py-8 text-center text-sm text-sub">還沒有區域</p>}
        </>
      )}
      {fieldMode && !sorting && list.length > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="glass mt-2 flex h-11 w-full items-center justify-center rounded-full text-[14px] text-ink">
          {showAll ? '收合成清單' : '展開全部區域'}
        </button>
      )}
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>
        {Icon.plus} 新增區域
      </Button>
      {adding && <AddAreaSheet surveyId={surveyId} onClose={() => setAdding(false)} onAdded={(id) => setOpen((x) => new Set(x).add(id))} />}
    </div>
  )
}
