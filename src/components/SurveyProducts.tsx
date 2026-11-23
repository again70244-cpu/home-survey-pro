import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addSurveyProduct, removeSurveyProduct, updateSurveyProduct } from '../db/repo'
import type { SurveyProduct } from '../db/types'
import { fmtTime, QUALITY_LABEL, SPEC_GROUPS, SPEC_LABELS } from '../catalog/search'
import { autoTemplate, productCategory, specValueOf } from '../rules/common'
import { TEMPLATES } from '../templates'
import { SpecTable } from '../pages/CatalogProductPage'
import type { CatalogProduct } from '../catalog/types'
import { ProductPicker } from './ProductPicker'
import { Button, Icon } from './ui'
import { useToast } from './Toast'

const dim = (v: unknown) => (v === null || v === undefined ? '—' : String(v))
const tplName = (id: string | null) => (id ? TEMPLATES.find((t) => t.id === id)?.title.replace('現場檢查', '') ?? id : '不檢查')

/** 手動修正規格：只影響這筆場勘，快照與產品知識庫不變 */
function SpecEditor({ sp, onClose }: { sp: SurveyProduct; onClose: () => void }) {
  const toast = useToast()
  const init = Object.fromEntries(Object.entries(sp.spec_overrides?.fields ?? {}).map(([k, v]) => [k, String(v)]))
  const [vals, setVals] = useState<Record<string, string>>(init)
  const [note, setNote] = useState(sp.spec_overrides?.note ?? '')
  const [err, setErr] = useState('')
  async function save() {
    const fields: Record<string, number> = {}
    for (const [k, t] of Object.entries(vals)) {
      const s = t.trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      if (!s) continue
      const n = Number(s)
      if (!Number.isFinite(n) || n <= 0 || n > 2000) return setErr(`「${SPEC_LABELS[k as keyof typeof SPEC_LABELS]}」請輸入 0～2000 的數字（公分）`)
      fields[k] = Math.round(n * 10) / 10
    }
    await updateSurveyProduct(sp.id, { spec_overrides: Object.keys(fields).length ? { fields, note: note.trim() || null, updated_at: new Date().toISOString() } : null })
    toast(Object.keys(fields).length ? `已儲存 ${Object.keys(fields).length} 項手動修正` : '已清除手動修正')
    onClose()
  }
  return (
    <div className="mt-3 border border-ink p-3" role="group" aria-label={`修正 ${sp.model_code} 規格`}>
      <p className="text-xs text-sub">只影響這筆場勘的檢查與報告；產品知識庫不會改變。空白 = 使用產品知識庫的數值。</p>
      {SPEC_GROUPS.map((g) => (
        <div key={g.title} className="mt-3">
          <h4 className="mb-1 text-[11px] tracking-[0.14em] text-sub">{g.title}</h4>
          {g.fields.map((f) => {
            const orig = specValueOf(sp, f).original
            return (
              <label key={f} className="flex items-center gap-3 border-b border-line py-1.5">
                <span className="min-w-0 flex-1 text-[14px]">{SPEC_LABELS[f]}<span className="ml-1.5 text-xs text-sub">知識庫：{orig === null ? '未提供' : `${orig} cm`}</span></span>
                <input
                  inputMode="decimal"
                  value={vals[f] ?? ''}
                  placeholder={orig === null ? '—' : String(orig)}
                  onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value }))}
                  aria-label={`修正 ${SPEC_LABELS[f]}`}
                  data-override={f}
                  className="w-20 border-0 border-b border-[#d4d4d4] bg-transparent px-0 py-1 text-right text-[16px] tabular-nums focus:border-ink focus:outline-none focus:ring-0"
                />
                <span className="w-6 text-xs text-sub">cm</span>
              </label>
            )
          })}
        </div>
      ))}
      <label className="mt-3 block">
        <span className="text-xs text-sub">資料來源</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：說明書、現場實測" aria-label="修正資料來源" className="block w-full border-0 border-b border-[#d4d4d4] bg-transparent px-0 py-1.5 text-[15px] focus:border-ink focus:outline-none focus:ring-0" />
      </label>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button className="col-span-2" onClick={() => void save()}>儲存修正</Button>
        <Button variant="secondary" onClick={onClose}>取消</Button>
      </div>
      {sp.spec_overrides && (
        <button className="mt-2 text-[13px] text-red-700 underline underline-offset-4" onClick={() => { setVals({}); setNote(''); void updateSurveyProduct(sp.id, { spec_overrides: null }).then(onClose) }}>
          清除所有手動修正
        </button>
      )}
    </div>
  )
}

function ProductCard({ sp }: { sp: SurveyProduct }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const s = sp.spec_snapshot
  const manual = Object.keys(sp.spec_overrides?.fields ?? {}).filter((f) => specValueOf(sp, f).manual)
  const hasBody = (['width_cm', 'height_cm', 'depth_cm'] as const).some((f) => specValueOf(sp, f).value !== null)
  const auto = autoTemplate(productCategory(sp))
  // 產品知識庫中目前的版本（只用來提示「資料已更新」，不會改動快照）
  const current = useLiveQuery(() => (sp.catalog_product_id ? db.catalog_products.get(sp.catalog_product_id) : undefined), [sp.catalog_product_id])
  const changed = current && sp.catalog_spec_hash && current.spec_hash !== sp.catalog_spec_hash
  return (
    <li className="border-b border-line py-4" aria-label={`安裝產品 ${sp.model_code}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[17px]">{sp.model_code}</div>
          <div className="truncate text-[13px] text-[#555]">{sp.display_name || sp.category || ''}</div>
        </div>
        <button onClick={() => confirm(`移除「${sp.model_code}」？`) && void removeSurveyProduct(sp.id)} className="h-9 px-1 text-[13px] text-red-700 underline underline-offset-4" aria-label={`移除產品 ${sp.model_code}`}>
          移除
        </button>
      </div>
      {s.data_quality === 'missing' && !hasBody ? (
        <p className="mt-2 bg-sand px-3 py-2 text-[13px] text-oak">此產品在試算表中沒有安裝尺寸。可按「修正規格」輸入說明書或實測數值。</p>
      ) : (
        <div className="mt-2 grid grid-cols-3 border-y border-ink text-center tabular-nums">
          {(['width_cm', 'height_cm', 'depth_cm'] as const).map((f, i) => {
            const x = specValueOf(sp, f)
            return (
              <div key={f} className={`py-1.5 ${i < 2 ? 'border-r border-line' : ''} ${x.manual ? 'bg-sand' : ''}`} data-spec={f} data-manual={x.manual ? 1 : 0}>
                <div className="text-[10px] tracking-[0.14em] text-sub">{['寬', '高', '深'][i]}{x.manual && <span className="ml-1 text-oak">手動</span>}</div>
                <div className={`text-xl font-light ${x.value === null ? 'text-oak' : ''}`}>{dim(x.value)}</div>
              </div>
            )
          })}
        </div>
      )}
      {manual.length > 0 && (
        <p className="mt-2 text-[12px] text-oak" data-testid="manual-note">
          手動修正 {manual.length} 項{sp.spec_overrides?.note ? `（來源：${sp.spec_overrides.note}）` : ''}：{manual.map((f) => `${SPEC_LABELS[f as keyof typeof SPEC_LABELS] ?? f} ${specValueOf(sp, f).value}`).join('、')}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2 text-[13px]">
        <label htmlFor={`tpl-${sp.id}`} className="text-sub">適用檢查</label>
        <select
          id={`tpl-${sp.id}`}
          aria-label={`${sp.model_code} 適用檢查`}
          value={sp.template_type ?? ''}
          onChange={(e) => void updateSurveyProduct(sp.id, { template_type: e.target.value || null })}
          className="h-9 flex-1 border border-line bg-white px-2 text-[14px]"
        >
          <option value="">自動（{tplName(auto)}）</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{tplName(t.id)}</option>)}
          <option value="none">不檢查</option>
        </select>
        <button onClick={() => setEditing((x) => !x)} className="h-9 px-1 text-ink underline underline-offset-4" aria-label={`修正 ${sp.model_code} 規格`}>
          {editing ? '收起' : '修正規格'}
        </button>
      </div>
      {editing && <SpecEditor sp={sp} onClose={() => setEditing(false)} />}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-sub">
        <span>規格快照：{fmtTime(sp.snapshot_at)}{s.data_quality !== 'complete' ? `・${QUALITY_LABEL[s.data_quality]}` : ''}</span>
        <button onClick={() => setOpen((v) => !v)} className="text-[13px] text-ink underline underline-offset-4">{open ? '收起規格' : '完整規格'}</button>
      </div>
      {changed && (
        <p className="mt-2 border-l-2 border-oak bg-sand px-3 py-2 text-[12px] text-ink">
          產品資料已於 {fmtTime(current!.spec_updated_at)} 更新。此案件保留選擇當時的規格；如需新規格，請移除後重新選擇。
          <Link to={`/catalog/${current!.id}`} className="ml-1 underline">查看最新</Link>
        </p>
      )}
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-sub">以下為選擇當時產品知識庫的原始資料（不含手動修正）</p>
          <SpecTable p={s as unknown as CatalogProduct} />
          {s.parse_issues.length > 0 && <p className="mt-3 text-xs text-red-700">待確認：{s.parse_issues.map((i) => i.message).join('；')}</p>}
          {s.install_text_raw && <pre className="mt-3 whitespace-pre-wrap bg-sand p-2 font-sans text-xs">{s.install_text_raw}</pre>}
        </div>
      )}
    </li>
  )
}

/** 場勘頁的「安裝產品」區塊 */
export function SurveyProducts({ surveyId }: { surveyId: string }) {
  const toast = useToast()
  const [picking, setPicking] = useState(false)
  const list = useLiveQuery(
    async () => (await db.survey_products.where('survey_id').equals(surveyId).toArray()).filter((p) => !p.deleted_at).sort((a, b) => a.sort_order - b.sort_order),
    [surveyId],
  )
  return (
    <section className="border-t border-line py-5" aria-label="安裝產品">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">安裝產品（{list?.length ?? 0}）</h2>
      </div>
      {list && list.length > 0 ? (
        <ul className="mt-2 border-t border-ink">{list.map((sp) => <ProductCard key={sp.id} sp={sp} />)}</ul>
      ) : (
        <p className="mt-2 text-sm text-sub">尚未選擇產品。選擇後會自動帶入安裝規格。</p>
      )}
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setPicking(true)}>
        {Icon.plus} 從產品知識庫選擇
      </Button>
      {picking && (
        <ProductPicker
          selected={(list ?? []).map((x) => x.catalog_product_id ?? '')}
          onClose={() => setPicking(false)}
          onPick={async (p) => {
            if ((list ?? []).some((x) => x.catalog_product_id === p.id)) return toast('已經選過這個產品')
            await addSurveyProduct(surveyId, p)
            toast(`已加入 ${p.model_code}，規格已保存`)
          }}
        />
      )}
    </section>
  )
}
