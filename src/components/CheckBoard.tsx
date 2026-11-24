/**
 * 檢查結果儀表板：一行結論 ＋ 燈號格 ＋ 空間比對圖
 * 文字說明只在點選某一格時展開；所有檢查結果仍在畫面結構中（依等級排序），只是隱藏未選取的類別
 */
import { useState } from 'react'
import type { SurveyArea, SurveyProduct } from '../db/types'
import type { TemplateDef } from '../templates'
import { matchingProducts } from '../templates'
import { specValueOf } from '../rules/common'
import { computeLights, LIGHT_LABEL, verdict, type LightState } from '../rules/lights'
import { RISK_LABEL, type CheckResult, type Finding } from '../rules/types'

const DOT: Record<LightState, string> = {
  high: 'bg-[#ff5d5d] shadow-[0_0_14px_rgb(255_93_93/0.85)]',
  caution: 'bg-[#f5b04a] shadow-[0_0_14px_rgb(245_176_74/0.8)]',
  confirm: 'bg-[#a78bfa] shadow-[0_0_14px_rgb(167_139_250/0.8)]',
  todo: 'border border-white/35 bg-transparent',
  ok: 'bg-[#4ade80] shadow-[0_0_14px_rgb(74_222_128/0.75)]',
}
const TEXT: Record<LightState, string> = { high: 'text-[#ff8a8a]', caution: 'text-[#f6c27a]', confirm: 'text-[#c4b5fd]', todo: 'text-sub', ok: 'text-[#86efac]' }
const BAR_LABEL: Record<LightState, string> = { high: '放不下', caution: '預留不足', ok: '足夠', todo: '未量', confirm: '待確認' }
const ITEM: Record<Finding['level'], string> = {
  high: 'border-[#ff5d5d]/30 bg-[#ff5d5d]/10',
  caution: 'border-[#f5b04a]/30 bg-[#f5b04a]/10',
  confirm: 'border-[#a78bfa]/30 bg-[#a78bfa]/10',
  info: 'border-white/10 bg-white/[0.05]',
}

/** 空間比對：寬、深、高各一條，機身＋預留 vs 現場空間 */
function SpaceBars({ def, products, area, stacked }: { def: TemplateDef; products: SurveyProduct[]; area: SurveyArea | null; stacked: boolean }) {
  const ps = matchingProducts(def, products)
  if (!area || !ps.length) return null
  const vals = (k: string) => ps.map((p) => specValueOf(p, k).value)
  const max = (xs: (number | null)[]) => (xs.every((x) => x !== null) ? Math.max(...(xs as number[])) : null)
  const sum = (xs: (number | null)[]) => (xs.every((x) => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) : null)
  const C = def.clearance
  const rows = [
    { k: 'width_cm', label: '寬', body: max(vals('width_cm')), extra: C.side_each_cm * 2, space: area.width_cm },
    { k: 'depth_cm', label: '深', body: max(vals('depth_cm')), extra: C.back_cm, space: area.depth_cm },
    { k: 'height_cm', label: '高', body: stacked ? sum(vals('height_cm')) : max(vals('height_cm')), extra: C.top_cm, space: area.height_cm },
  ].filter((r) => r.body !== null)
  if (!rows.length) return null
  return (
    <div className="mt-4 space-y-3" aria-label="空間比對" data-testid="space-bars">
      <div className="flex items-baseline justify-between text-[12px] text-sub">
        <span>空間比對（{area.name}）</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-white/70" />機身</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-white/25" />預留</span>
          <span className="flex items-center gap-1"><i className="inline-block h-3 w-[2px] bg-accent" />現場</span>
        </span>
      </div>
      {rows.map((r) => {
        const need = r.body! + r.extra
        const scale = Math.max(need, r.space ?? 0) * 1.08
        const pct = (v: number) => `${(v / scale) * 100}%`
        const state: LightState = r.space === null ? 'todo' : r.space < r.body! ? 'high' : r.space < need ? 'caution' : 'ok'
        return (
          <div key={r.k} data-bar={r.k} data-state={state}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink">{r.label}</span>
              <span className={`tabular-nums ${TEXT[state]}`}>
                <b className="font-medium">{BAR_LABEL[state]}</b>
                <span className="ml-2 text-sub">{r.space === null ? '—' : r.space} / 需 {Math.round(need * 10) / 10} cm</span>
              </span>
            </div>
            <div className="relative mt-1.5 h-3 overflow-visible rounded-full bg-white/[0.06]">
              <div className="absolute inset-y-0 left-0 rounded-l-full bg-white/70" style={{ width: pct(r.body!) }} />
              {r.extra > 0 && <div className="absolute inset-y-0 rounded-r-full bg-white/25" style={{ left: pct(r.body!), width: pct(r.extra) }} />}
              {r.space !== null && (
                <div className={`absolute -inset-y-1 w-[3px] rounded-full ${state === 'ok' ? 'bg-accent shadow-[0_0_10px_rgb(103_232_249/0.9)]' : state === 'caution' ? 'bg-[#f5b04a]' : 'bg-[#ff5d5d]'}`} style={{ left: `calc(${pct(r.space)} - 1.5px)` }} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CheckBoard({
  def,
  result,
  stepDone,
  products,
  installArea,
  stacked,
}: {
  def: TemplateDef
  result: CheckResult
  stepDone: Map<string, boolean>
  products: SurveyProduct[]
  installArea: SurveyArea | null
  stacked: boolean
}) {
  const [sel, setSel] = useState<string | null>(null)
  const lights = computeLights(def.lights, result.findings, stepDone)
  const v = verdict(lights)
  const groupOf = new Map(lights.flatMap((l) => l.findings.map((f) => [f.id, l.group.key] as const)))
  const selected = lights.find((l) => l.group.key === sel)
  return (
    <div className="mt-3">
      {/* 一行結論 */}
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" data-testid={`${def.id}-verdict`} data-state={v.state}>
        <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${DOT[v.state]}`} aria-hidden />
        <span className={`flex-1 text-[16px] ${TEXT[v.state]}`}>{v.text}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px] tabular-nums" aria-label="檢查結果統計">
        <span className="text-[#ff8a8a]">高風險 <b className="font-medium" data-count="high">{result.counts.high}</b> 項</span>
        <span className="text-[#f6c27a]">注意 <b className="font-medium" data-count="caution">{result.counts.caution}</b> 項</span>
        <span className="text-[#c4b5fd]">待確認 <b className="font-medium" data-count="confirm">{result.counts.confirm}</b> 項</span>
      </div>

      {/* 燈號格 */}
      <div className="mt-3 grid grid-cols-4 gap-2" role="tablist" aria-label="檢查類別">
        {lights.map((l) => {
          const on = sel === l.group.key
          return (
            <button
              key={l.group.key}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={`${l.group.label}：${LIGHT_LABEL[l.state]}${l.findings.length ? `，${l.findings.length} 項` : ''}`}
              data-light={l.group.key}
              data-state={l.state}
              onClick={() => setSel(on ? null : l.group.key)}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 transition ${on ? 'border-accent/60 bg-white/[0.1]' : 'border-white/10 bg-white/[0.04] active:bg-white/[0.08]'}`}
            >
              <span className={`h-3.5 w-3.5 rounded-full ${DOT[l.state]}`} aria-hidden />
              <span className="text-[13px] text-ink">{l.group.label}</span>
              <span className={`text-[11px] ${TEXT[l.state]}`}>{LIGHT_LABEL[l.state]}{l.findings.length > 1 ? ` ${l.findings.length}` : ''}</span>
            </button>
          )
        })}
      </div>

      {/* 圖例：每種燈號代表的狀態 */}
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 text-[12px] text-sub" aria-label="燈號說明" data-testid="light-legend">
        {(['high', 'caution', 'confirm', 'ok', 'todo'] as const).map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[st]}`} aria-hidden />
            {LIGHT_LABEL[st]}
          </span>
        ))}
        <span className="w-full text-center text-[11px]">點選燈號查看說明</span>
      </div>

      {/* 選取類別的說明（全部結果都在結構中，依等級排序；只顯示選取的類別） */}
      <ul className={selected ? 'mt-3 space-y-2' : 'hidden'} aria-label="檢查結果">
        {result.findings.map((f) => (
          <li key={f.id} hidden={groupOf.get(f.id) !== sel} className={`rounded-2xl border px-3.5 py-2.5 ${ITEM[f.level]}`} data-finding={f.id} data-level={f.level}>
            <div className="text-[11px] tracking-[0.12em] text-sub">{RISK_LABEL[f.level]}</div>
            <div className="mt-0.5 text-[15px] text-ink">{f.title}</div>
            <div className="mt-1 text-[13px] text-ink/75">{f.why}</div>
            <div className="mt-1 text-[13px] text-ink">建議：{f.suggestion}</div>
            <div className="mt-1 text-[11px] text-sub">依據：{f.basis}</div>
          </li>
        ))}
      </ul>
      {selected && selected.findings.length === 0 && (
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] text-ink/75">
          {selected.state === 'todo' ? `「${selected.group.label}」還沒填寫，可用現場拍攝補上` : `「${selected.group.label}」沒有發現問題`}
        </p>
      )}

      <SpaceBars def={def} products={products} area={installArea} stacked={stacked} />
      <p className="mt-3 text-[11px] text-sub">{def.note}・僅供提醒，請以現場判斷為準</p>
    </div>
  )
}
