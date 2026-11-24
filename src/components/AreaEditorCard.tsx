import { useEffect, useRef, useState } from 'react'
import { deleteArea, moveArea, updateArea, type AreaPatch } from '../db/repo'
import { AREA_KIND_LABEL } from '../db/types'
import type { AreaStatus } from '../lib/completeness'
import { AreaChips } from './AreaList'
import { PhotoSection } from './PhotoSection'
import { useToast } from './Toast'

type DimKey = 'width_cm' | 'depth_cm' | 'height_cm'
const DIMS: { key: DimKey; label: string }[] = [
  { key: 'width_cm', label: '寬' },
  { key: 'depth_cm', label: '深' },
  { key: 'height_cm', label: '高' },
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

/** 跳到下一個尺寸欄位（鍵盤「下一個」） */
function focusNext(el: HTMLInputElement) {
  const all = [...document.querySelectorAll<HTMLInputElement>('input[data-dim]')]
  const i = all.indexOf(el)
  if (i >= 0 && all[i + 1]) all[i + 1].focus()
  else el.blur()
}

/** 場勘頁上直接編輯的區域卡片：尺寸、照片、備註都不用另外點進去 */
export function AreaEditorCard({ s, index, total, sorting }: { s: AreaStatus; index: number; total: number; sorting: boolean }) {
  const a = s.area
  const toast = useToast()
  const [text, setText] = useState({ width_cm: toText(a.width_cm), depth_cm: toText(a.depth_cm), height_cm: toText(a.height_cm), notes: a.notes ?? '', name: a.name })
  const [errors, setErrors] = useState<Partial<Record<DimKey, string>>>({})
  const [saved, setSaved] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const [renaming, setRenaming] = useState(false)
  const pending = useRef<AreaPatch>({})
  const timer = useRef<number | undefined>(undefined)
  const focused = useRef(false)

  // 沒有正在輸入時，才用資料庫的值（例如其他裝置同步過來）更新畫面
  useEffect(() => {
    if (Object.keys(pending.current).length || focused.current) return
    setText({ width_cm: toText(a.width_cm), depth_cm: toText(a.depth_cm), height_cm: toText(a.height_cm), notes: a.notes ?? '', name: a.name })
  }, [a.width_cm, a.depth_cm, a.height_cm, a.notes, a.name])

  async function flush() {
    window.clearTimeout(timer.current)
    const patch = pending.current
    if (!Object.keys(patch).length) return
    pending.current = {}
    try {
      await updateArea(a.id, patch)
      setSaved('saved')
    } catch {
      pending.current = { ...patch, ...pending.current }
      setSaved('error')
    }
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flushRef.current()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      void flushRef.current() // 離開頁面時一定存檔
    }
  }, [])

  function queue(patch: AreaPatch) {
    pending.current = { ...pending.current, ...patch }
    setSaved('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 500)
  }

  function onDim(key: DimKey, t: string) {
    setText((x) => ({ ...x, [key]: t }))
    const r = parseCm(t)
    if (!r.ok) return setErrors((e) => ({ ...e, [key]: r.error }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    queue({ [key]: r.value })
  }

  async function onDelete() {
    if (!confirm(`確定刪除「${a.name}」？\n此區域的尺寸與照片都會刪除。`)) return
    window.clearTimeout(timer.current)
    pending.current = {}
    await deleteArea(a.id)
    toast('已刪除區域')
  }

  const inputEvents = { onFocus: () => (focused.current = true), onBlur: () => { focused.current = false; void flush() } }

  const DIM_EN: Record<DimKey, string> = { width_cm: 'WIDTH', depth_cm: 'DEPTH', height_cm: 'HEIGHT' }

  return (
    <section id={`area-${a.id}`} className="scroll-mt-20 glass-card my-3 p-5" aria-label={`區域 ${a.name}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={text.name}
              onChange={(e) => {
                setText((x) => ({ ...x, name: e.target.value }))
                if (e.target.value.trim()) queue({ name: e.target.value.trim() })
              }}
              onBlur={() => { setRenaming(false); void flush() }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full border-0 border-b border-ink bg-transparent px-0 py-1 text-xl focus:outline-none focus:ring-0"
              aria-label="區域名稱"
            />
          ) : (
            <h3 className="truncate text-xl font-normal text-ink">
              <span className="mr-2.5 align-middle text-xs tabular-nums text-[#9a9a9a]">{String(index + 1).padStart(2, '0')}</span>
              {a.name}
              <span className="ml-2 align-middle text-xs text-[#9a9a9a]">{AREA_KIND_LABEL[a.kind]}</span>
            </h3>
          )}
          <div className="mt-1.5"><AreaChips s={s} /></div>
        </div>
        {sorting ? (
          <div className="flex gap-1">
            <button aria-label={`${a.name} 上移`} disabled={index === 0} onClick={() => void moveArea(a.survey_id, a.id, -1)} className="glass h-11 w-11 rounded-full text-lg disabled:opacity-40">↑</button>
            <button aria-label={`${a.name} 下移`} disabled={index === total - 1} onClick={() => void moveArea(a.survey_id, a.id, 1)} className="glass h-11 w-11 rounded-full text-lg disabled:opacity-40">↓</button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => setRenaming(true)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink" aria-label={`${a.name} 改名`}>改名</button>
            <button onClick={() => void onDelete()} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-red-700" aria-label={`刪除區域 ${a.name}`}>刪除</button>
          </div>
        )}
      </div>

      {!sorting && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {DIMS.map((d) => {
              const t = text[d.key]
              const empty = t.trim() === ''
              const err = errors[d.key]
              return (
                <label
                  key={d.key}
                  className={`block rounded-2xl border px-3 py-2.5 focus-within:border-ink/40 ${empty ? 'border-white/60 bg-white/40' : 'border-white/90 bg-white/75'}`}
                >
                  <span className="flex items-baseline justify-between text-[10px] tracking-[0.14em] text-sub">
                    <span>{d.label} {DIM_EN[d.key]}</span>
                    {err ? <span className="tracking-normal text-red-700">{err}</span> : !empty && <span className="tracking-normal">cm</span>}
                  </span>
                  <input
                    data-dim
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    value={t}
                    placeholder="—"
                    onChange={(e) => onDim(d.key, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), focusNext(e.currentTarget))}
                    onFocus={inputEvents.onFocus}
                    onBlur={() => {
                      const r = parseCm(text[d.key])
                      if (r.ok) setText((x) => ({ ...x, [d.key]: toText(r.value) })) // 全形數字等整理成標準格式
                      inputEvents.onBlur()
                    }}
                    className="mt-0.5 w-full min-w-0 border-0 bg-transparent p-0 text-[30px] font-light tabular-nums text-ink placeholder:text-[#c9c9c9] focus:outline-none focus:ring-0"
                    aria-label={`${a.name} ${d.label}（公分）`}
                  />
                </label>
              )
            })}
          </div>

          <div className="mt-4">
            <PhotoSection areaId={a.id} bare />
          </div>

          <label className="mt-2 block">
            <span className="sr-only">區域備註</span>
            <textarea
              rows={1}
              value={text.notes}
              placeholder="＋ 區域備註（例如：門框凸出 2cm、需拆門）"
              onChange={(e) => {
                setText((x) => ({ ...x, notes: e.target.value }))
                queue({ notes: e.target.value.trim() || null })
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              {...inputEvents}
              className="block w-full resize-none border-0 border-b border-transparent bg-transparent px-0 py-2 text-[15px] text-ink focus:border-ink focus:outline-none focus:ring-0"
              aria-label={`${a.name} 區域備註`}
            />
          </label>
          <div className="mt-1 h-4 text-right text-[11px] text-[#9a9a9a]">
            {saved === 'pending' ? '儲存中…' : saved === 'saved' ? '已儲存到本機' : saved === 'error' ? <span className="text-red-700">儲存失敗，請重試</span> : ''}
          </div>
        </>
      )}
    </section>
  )
}
