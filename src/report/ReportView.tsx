/** 報告版面：純展示元件，固定像素尺寸（不受手機螢幕寬度影響） */
import { forwardRef, type CSSProperties, type ReactNode } from 'react'
import { AREA_KIND_LABEL } from '../db/types'
import { formatDate } from '../lib/format'
import { dimState } from '../lib/completeness'
import { SPEC_FIELDS, SPEC_LABELS } from '../../supabase/functions/_shared/catalog/installText.ts'
import { RISK_LABEL, RISK_ORDER, type RiskLevel } from '../rules/types'
import {
  CONTENT_W, FOOTER_H, GAP, HEADER_H, MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, PHOTO_CELL_W, PHOTO_GAP,
  type Block, type ReportData, type ReportPhoto,
} from './model'

const RISK_COLOR: Record<RiskLevel, string> = { high: '#b91c1c', confirm: '#7c3aed', caution: '#b45309', info: '#4b5563' }
const C = { ink: '#111827', text: '#1f2937', sub: '#4b5563', mute: '#9ca3af', line: '#e5e7eb', soft: '#f3f4f6', warn: '#b45309', ok: '#047857' }
// 報告只用系統字型：網頁字型（Noto Sans TC 網路字型）轉成圖片時不會被嵌入，排版量測與輸出會用到不同字型而造成換行、重疊
const FONT = '"Noto Sans CJK TC","PingFang TC","Microsoft JhengHei","Heiti TC","Source Han Sans TC",sans-serif'

const fmtDateTime = (d: Date) =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function Dim({ label, v, big = true }: { label: string; v: number | null; big?: boolean }) {
  const empty = v === null || v === undefined
  return (
    <div style={{ flex: 1, border: `2px solid ${empty ? C.line : C.ink}`, borderStyle: empty ? 'dashed' : 'solid', borderRadius: 14, padding: big ? '14px 18px' : '8px 12px' }}>
      <div style={{ fontSize: 20, color: C.sub, fontWeight: 600 }}>{label}</div>
      {empty ? (
        <div style={{ fontSize: big ? 34 : 24, color: C.warn, fontWeight: 700, marginTop: 4 }}>尚未測量</div>
      ) : (
        <div style={{ marginTop: 2, color: C.ink, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: big ? 56 : 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }}>{v}</span>
          <span style={{ fontSize: big ? 26 : 18, fontWeight: 600, marginLeft: 6, color: C.sub }}>cm</span>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: 'flex', padding: '14px 0', borderBottom: `1px solid ${C.line}`, fontSize: 26 }}>
      <div style={{ width: 200, color: C.sub, flexShrink: 0 }}>{label}</div>
      <div style={{ color: value ? C.ink : C.mute, fontWeight: value ? 600 : 400, wordBreak: 'break-word', minWidth: 0 }}>{value || '未填寫'}</div>
    </div>
  )
}

function Photo({ p, w, h }: { p: ReportPhoto; w: number; h: number }) {
  return (
    <div style={{ width: w }}>
      <div style={{ width: w, height: h, background: C.soft, borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {p.url ? (
          <img src={p.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div style={{ fontSize: 22, color: C.warn }}>照片無法取得（尚未下載）</div>
        )}
        <div style={{ position: 'absolute', left: 10, top: 10, background: 'rgba(17,24,39,.75)', color: '#fff', fontSize: 18, padding: '2px 10px', borderRadius: 999 }}>{p.index}</div>
      </div>
      <div style={{ fontSize: 22, color: p.caption ? C.text : C.mute, marginTop: 8, lineHeight: 1.45, wordBreak: 'break-word' }}>
        {p.caption || '（無說明）'}
      </div>
    </div>
  )
}

export function BlockView({ b, d }: { b: Block; d: ReportData }) {
  const s = d.survey
  switch (b.kind) {
    case 'cover':
      return (
        <div>
          <div style={{ fontSize: 22, letterSpacing: 6, color: C.sub, fontWeight: 600 }}>HOME APPLIANCE SITE SURVEY</div>
          <div style={{ fontSize: 64, fontWeight: 800, color: C.ink, marginTop: 6 }}>家電場勘紀錄</div>
          <div style={{ height: 4, width: 96, background: C.ink, margin: '20px 0 16px' }} />
          <InfoRow label="客戶姓名" value={s.customer_name} />
          <InfoRow label="場勘日期" value={s.survey_date ? formatDate(s.survey_date) : null} />
          <InfoRow label="聯絡電話" value={s.customer_phone} />
          <InfoRow label="客戶地址" value={s.customer_address} />
          <InfoRow label="產品型號" value={s.product_model} />
        </div>
      )
    case 'summary-head': {
      const sum = d.summary
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: C.ink }}>場勘摘要</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: sum.complete ? C.ok : C.warn }}>
              {sum.complete ? '✓ 場勘完整' : `尚未完成・${sum.completeAreas}/${sum.areas.length} 區完成`}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 0.8fr', fontSize: 21, color: C.sub, fontWeight: 600, padding: '14px 12px', background: C.soft, borderRadius: 10, marginTop: 14 }}>
            <div>區域</div><div>寬</div><div>深</div><div>高</div><div style={{ textAlign: 'right' }}>照片</div>
          </div>
        </div>
      )
    }
    case 'summary-row': {
      const a = d.areas[b.areaIndex]
      const n = d.photosByArea.get(a.id)?.length ?? 0
      const cell = (v: number | null) => (v === null ? <span style={{ color: C.warn }}>尚未測量</span> : <span style={{ fontWeight: 700, color: C.ink }}>{v} cm</span>)
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 0.8fr', fontSize: 24, padding: '4px 12px', borderBottom: `1px solid ${C.line}`, paddingBottom: 16, marginTop: -12, alignItems: 'baseline' }}>
          <div style={{ fontWeight: 700, color: C.ink, wordBreak: 'break-word', paddingRight: 8 }}>{a.name}</div>
          <div>{cell(a.width_cm)}</div><div>{cell(a.depth_cm)}</div><div>{cell(a.height_cm)}</div>
          <div style={{ textAlign: 'right', color: n ? C.ink : C.warn, fontWeight: n ? 700 : 400 }}>{n ? `${n} 張` : '未拍照'}</div>
        </div>
      )
    }
    case 'product': {
      const sp = d.products[b.productIndex]
      const s = sp.spec_snapshot as Record<string, unknown>
      const v = (f: string) => (s[f] === null || s[f] === undefined ? null : (s[f] as number))
      const extras = SPEC_FIELDS.filter((f) => !['width_cm', 'height_cm', 'depth_cm'].includes(f) && v(f) !== null)
      return (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 20px' }}>
          {b.productIndex === 0 && <div style={{ fontSize: 34, fontWeight: 800, color: C.ink, margin: '-2px 0 14px' }}>安裝產品規格</div>}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: C.ink }}>{sp.model_code}</div>
            <div style={{ fontSize: 21, color: C.sub, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{sp.display_name ?? ''}</div>
          </div>
          {s.data_quality === 'missing' ? (
            <div style={{ fontSize: 22, color: C.warn, marginTop: 10 }}>試算表未提供此產品的安裝尺寸，請現場確認</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Dim label="產品寬 W" v={v('width_cm')} big={false} />
                <Dim label="產品高 H" v={v('height_cm')} big={false} />
                <Dim label="產品深 D" v={v('depth_cm')} big={false} />
              </div>
              {extras.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 21, color: C.text }}>
                  {extras.map((f) => (
                    // 一列一項：標籤可換行並撐高該列，數值不換行 → 不會重疊
                    <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, borderBottom: `1px solid ${C.line}`, padding: '7px 0', lineHeight: 1.4 }}>
                      <span style={{ flex: 1, minWidth: 0, color: C.sub, wordBreak: 'break-word' }}>{SPEC_LABELS[f]}</span>
                      <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 700 }}>{v(f)} cm</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div style={{ fontSize: 18, color: C.mute, marginTop: 10 }}>規格來源：LG 產品知識庫（{fmtDateTime(new Date(sp.snapshot_at))} 選擇時的資料）</div>
        </div>
      )
    }
    case 'check-head': {
      const c = d.checks[b.checkIndex]
      const r = c.result
      return (
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.ink }}>{c.title}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            {RISK_ORDER.map((l) => (
              <div key={l} style={{ flex: 1, border: `2px solid ${r.counts[l] ? RISK_COLOR[l] : C.line}`, borderRadius: 12, padding: '8px 14px' }}>
                <div style={{ fontSize: 20, color: C.sub, fontWeight: 600 }}>{RISK_LABEL[l]}</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: r.counts[l] ? RISK_COLOR[l] : C.mute, fontVariantNumeric: 'tabular-nums' }}>{r.counts[l]}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 20, color: C.sub, marginTop: 10 }}>
            完成度 {r.score.percent}%・{c.note}・系統提醒僅供參考，請以現場判斷為準
          </div>
          {r.findings.length === 0 && <div style={{ fontSize: 24, color: C.ok, marginTop: 12, fontWeight: 700 }}>未發現問題</div>}
        </div>
      )
    }
    case 'finding': {
      const f = d.checks[b.checkIndex].result.findings[b.findingIndex]
      return (
        <div style={{ borderLeft: `6px solid ${RISK_COLOR[f.level]}`, background: f.level === 'high' ? '#fef2f2' : C.soft, borderRadius: 8, padding: '12px 18px', lineHeight: 1.45 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ flexShrink: 0, fontSize: 20, fontWeight: 800, color: RISK_COLOR[f.level], whiteSpace: 'nowrap' }}>{RISK_LABEL[f.level]}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 25, fontWeight: 800, color: C.ink, wordBreak: 'break-word' }}>{f.title}</span>
          </div>
          <div style={{ fontSize: 21, color: C.text, marginTop: 4, wordBreak: 'break-word' }}>{f.why}</div>
          <div style={{ fontSize: 21, color: C.ink, marginTop: 4, wordBreak: 'break-word' }}>建議：{f.suggestion}</div>
          <div style={{ fontSize: 17, color: C.mute, marginTop: 4, wordBreak: 'break-word' }}>依據：{f.basis}</div>
        </div>
      )
    }
    case 'area-head': {
      const a = d.areas[b.areaIndex]
      const st = dimState(a).state
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, borderBottom: `3px solid ${C.ink}`, paddingBottom: 10 }}>
            <div style={{ fontSize: 22, color: C.sub, fontWeight: 700 }}>{String(b.areaIndex + 1).padStart(2, '0')}</div>
            <div style={{ fontSize: 42, fontWeight: 800, color: C.ink, flex: 1, wordBreak: 'break-word' }}>{a.name}</div>
            <div style={{ fontSize: 20, color: C.sub }}>{AREA_KIND_LABEL[a.kind]}</div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 18 }}>
            <Dim label="寬度 W" v={a.width_cm} />
            <Dim label="深度 D" v={a.depth_cm} />
            <Dim label="高度 H" v={a.height_cm} />
          </div>
          {st !== 'complete' && <div style={{ fontSize: 20, color: C.warn, marginTop: 10 }}>※ 此區域尺寸尚未完整測量</div>}
        </div>
      )
    }
    case 'area-cont': {
      const a = d.areas[b.areaIndex]
      return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: `2px solid ${C.line}`, paddingBottom: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.ink }}>{a.name}</div>
          <div style={{ fontSize: 22, color: C.sub }}>（續）</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 20, color: C.sub, whiteSpace: 'nowrap' }}>
            W {a.width_cm ?? '—'} ・ D {a.depth_cm ?? '—'} ・ H {a.height_cm ?? '—'} cm
          </div>
        </div>
      )
    }
    case 'area-notes':
      return (
        <div style={{ background: C.soft, borderRadius: 12, padding: '14px 18px', fontSize: 24, color: C.text, lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
          {b.first && <div style={{ fontWeight: 700, color: C.sub, marginBottom: 4 }}>區域備註</div>}
          {b.text}
        </div>
      )
    case 'no-photo':
      return <div style={{ border: `2px dashed ${C.line}`, borderRadius: 12, padding: 22, fontSize: 24, color: C.warn, textAlign: 'center' }}>此區域尚未拍照</div>
    case 'photo-row': {
      const single = b.photos.length === 1
      const w = single ? Math.round(CONTENT_W * 0.66) : PHOTO_CELL_W
      return (
        <div style={{ display: 'flex', gap: PHOTO_GAP, justifyContent: single ? 'center' : 'flex-start' }}>
          {b.photos.map((p) => <Photo key={p.id} p={p} w={w} h={b.height} />)}
        </div>
      )
    }
    case 'final': {
      const sum = d.summary
      return (
        <div style={{ borderTop: `3px solid ${C.ink}`, paddingTop: 18 }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.ink }}>整體備註</div>
          <div style={{ fontSize: 25, color: s.notes ? C.text : C.mute, lineHeight: 1.6, marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s.notes || '無'}</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.ink, marginTop: 28 }}>尚未完成的場勘項目</div>
          {sum.missing.length === 0 && !sum.unsynced ? (
            <div style={{ fontSize: 25, color: C.ok, marginTop: 10, fontWeight: 700 }}>✓ 所有區域尺寸與照片皆已完成</div>
          ) : (
            <ul style={{ margin: '10px 0 0', paddingLeft: 30, fontSize: 25, color: C.text, lineHeight: 1.7 }}>
              {sum.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <div style={{ fontSize: 22, color: C.sub, marginTop: 28 }}>報告產生時間：{fmtDateTime(d.generatedAt)}</div>
        </div>
      )
    }
  }
}

export const ReportPage = forwardRef<HTMLDivElement, { blocks: Block[]; d: ReportData; page: number; total: number }>(function ReportPage({ blocks, d, page, total }, ref) {
  const style: CSSProperties = { width: PAGE_W, height: PAGE_H, background: '#fff', fontFamily: FONT, color: C.text, position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }
  return (
    <div ref={ref} style={style}>
      <div style={{ position: 'absolute', left: MARGIN_X, right: MARGIN_X, top: MARGIN_TOP, height: HEADER_H - 34, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${C.line}`, fontSize: 20, color: C.sub }}>
        <div><b style={{ color: C.ink }}>家電場勘紀錄</b>・客戶：{d.survey.customer_name}</div>
        <div>{d.survey.survey_date ? formatDate(d.survey.survey_date) : ''}</div>
      </div>
      <div style={{ position: 'absolute', left: MARGIN_X, top: MARGIN_TOP + HEADER_H, width: CONTENT_W, display: 'flex', flexDirection: 'column', gap: GAP }}>
        {blocks.map((b) => <BlockView key={b.key} b={b} d={d} />)}
      </div>
      <div style={{ position: 'absolute', left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM, height: FOOTER_H - 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `1px solid ${C.line}`, fontSize: 20, color: C.sub }}>
        <div>{d.survey.customer_name}</div>
        <div style={{ fontWeight: 700, color: C.ink }}>第 {page} / {total} 頁</div>
      </div>
    </div>
  )
})

/** 量測容器：每個區塊在內容寬度下的實際高度 */
export function MeasureBox({ children }: { children: ReactNode }) {
  return <div style={{ width: CONTENT_W, fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>{children}</div>
}
