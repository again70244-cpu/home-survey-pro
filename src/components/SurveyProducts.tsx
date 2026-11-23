import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addSurveyProduct, removeSurveyProduct } from '../db/repo'
import type { SurveyProduct } from '../db/types'
import { fmtTime, QUALITY_LABEL } from '../catalog/search'
import { SpecTable } from '../pages/CatalogProductPage'
import type { CatalogProduct } from '../catalog/types'
import { ProductPicker } from './ProductPicker'
import { Button, Icon } from './ui'
import { useToast } from './Toast'

const dim = (v: unknown) => (v === null || v === undefined ? '—' : String(v))

function ProductCard({ sp }: { sp: SurveyProduct }) {
  const [open, setOpen] = useState(false)
  const s = sp.spec_snapshot
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
      {s.data_quality === 'missing' ? (
        <p className="mt-2 bg-sand px-3 py-2 text-[13px] text-oak">此產品在試算表中沒有安裝尺寸，請現場另行確認</p>
      ) : (
        <div className="mt-2 grid grid-cols-3 border-y border-ink text-center tabular-nums">
          {(['width_cm', 'height_cm', 'depth_cm'] as const).map((f, i) => (
            <div key={f} className={`py-1.5 ${i < 2 ? 'border-r border-line' : ''}`}>
              <div className="text-[10px] tracking-[0.14em] text-sub">{['寬', '高', '深'][i]}</div>
              <div className={`text-xl font-light ${s[f] === null ? 'text-oak' : ''}`}>{dim(s[f])}</div>
            </div>
          ))}
        </div>
      )}
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
