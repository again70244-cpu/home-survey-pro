import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { fmtTime, QUALITY_LABEL, SPEC_GROUPS, SPEC_LABELS, specValue, systemsForProduct } from '../catalog/search'
import type { CatalogProduct } from '../catalog/types'
import { Icon, IconButton, PageTitle, TopBar } from '../components/ui'
import { ProductImage } from './CatalogPage'

/** 規格表（場勘頁的產品快照也共用） */
export function SpecTable({ p }: { p: Pick<CatalogProduct, 'install_extra'> & Partial<CatalogProduct> }) {
  const conds = p.install_extra?.conditions ?? []
  return (
    <div className="space-y-5">
      {SPEC_GROUPS.map((g) => {
        const rows = g.fields.map((f) => ({ f, v: specValue(p as CatalogProduct, f) }))
        const isBody = g.title === '本體尺寸'
        const shown = isBody ? rows : rows.filter((r) => r.v !== null)
        if (!shown.length) return null
        return (
          <section key={g.title}>
            <h3 className="mb-1 text-[11px] tracking-[0.16em] text-sub">{g.title}</h3>
            {isBody ? (
              <div className="grid grid-cols-3 border-y border-ink">
                {shown.map(({ f, v }, i) => (
                  <div key={f} className={`py-2.5 ${i ? 'pl-2.5' : ''} ${i < 2 ? 'border-r border-line pr-2.5' : ''} ${v === null ? 'bg-sand' : ''}`}>
                    <div className="text-[10px] tracking-[0.14em] text-sub">{SPEC_LABELS[f]}</div>
                    <div className={`text-[26px] font-light tabular-nums ${v === null ? 'text-oak text-base' : ''}`}>{v === null ? '未提供' : v}<span className="ml-1 text-xs text-sub">{v === null ? '' : 'cm'}</span></div>
                  </div>
                ))}
              </div>
            ) : (
              <dl className="border-t border-line">
                {shown.map(({ f, v }) => {
                  const c = conds.filter((x) => x.field === f)
                  return (
                    <div key={f} className="flex justify-between gap-4 border-b border-line py-2.5 text-[15px]">
                      <dt className="text-ink/75">{SPEC_LABELS[f]}</dt>
                      <dd className="text-right tabular-nums">
                        {v} cm
                        {c.map((x) => <div key={x.condition} className="text-xs text-sub">（{x.condition}）</div>)}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}
            {isBody && conds.filter((x) => g.fields.includes(x.field)).map((x) => (
              <p key={x.field + x.condition} className="mt-1 text-xs text-sub">※ {SPEC_LABELS[x.field]}：{x.condition}</p>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function CatalogProductPage() {
  const { productId } = useParams()
  const nav = useNavigate()
  const [raw, setRaw] = useState(false)
  const data = useLiveQuery(async () => {
    const p = await db.catalog_products.get(productId!)
    if (!p) return null
    return { p, systems: systemsForProduct(p, await db.catalog_systems.toArray()) }
  }, [productId])
  if (data === undefined) return null
  if (data === null)
    return (
      <div className="min-h-dvh">
        <TopBar left={<IconButton label="返回" onClick={() => nav('/catalog')}>{Icon.back}產品</IconButton>} />
        <p className="p-8 text-center text-sub">找不到這個產品（可能尚未下載）</p>
      </div>
    )
  const { p, systems } = data
  const issues = p.parse_issues ?? []
  const notes = p.install_extra?.notes ?? []

  return (
    <div className="min-h-dvh pb-12">
      <TopBar left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}產品</IconButton>} />
      <main className="mx-auto max-w-2xl px-6">
        <PageTitle
          eyebrow={p.category ?? 'LG PRODUCT'}
          title={p.model_code}
          meta={<span className={p.data_quality === 'complete' ? '' : p.data_quality === 'missing' ? 'text-oak' : 'text-red-700'}>{QUALITY_LABEL[p.data_quality]}</span>}
        />
        {!p.is_active && <p className="mb-4 border-l-2 border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">此產品已不在 Google Sheets 中（停用於 {fmtTime(p.deactivated_at)}），僅供查閱歷史資料。</p>}
        {p.display_name && <p className="-mt-3 mb-5 text-[15px] text-ink/75">{p.display_name}</p>}

        {p.image_urls.length > 0 && (
          <div className="-mx-6 mb-6 flex snap-x gap-2 overflow-x-auto px-6" aria-label="產品圖片">
            {p.image_urls.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer" className="snap-start">
                <ProductImage url={u} className="h-56 w-56 shrink-0 border border-line" />
              </a>
            ))}
          </div>
        )}

        <section className="glass-card my-3 p-5" aria-label="安裝資訊">
          <h2 className="mb-4 text-xs font-medium tracking-[0.18em] text-sub">安裝資訊</h2>
          {p.data_quality === 'missing' ? (
            <p className="bg-sand py-5 text-center text-sm text-oak">Google Sheets 尚未提供此產品的安裝尺寸</p>
          ) : (
            <SpecTable p={p} />
          )}
          {issues.length > 0 && (
            <div className="mt-5 border-l-2 border-red-700 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
              <div className="mb-1 font-medium">待人工確認</div>
              <ul className="space-y-0.5">{issues.map((i, k) => <li key={k}>— {i.message}{i.line ? `：${i.line}` : ''}</li>)}</ul>
            </div>
          )}
          {notes.length > 0 && <ul className="mt-3 space-y-0.5 text-xs text-sub">{notes.map((n) => <li key={n}>※ {n}</li>)}</ul>}
          {p.install_text_raw && (
            <div className="mt-4">
              <button onClick={() => setRaw((v) => !v)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink">{raw ? '收起原文' : '查看試算表原文'}</button>
              {raw && <pre className="mt-2 whitespace-pre-wrap break-words bg-sand p-3 font-sans text-[13px] text-ink">{p.install_text_raw}</pre>}
            </div>
          )}
        </section>

        {systems.length > 0 && (
          <section className="glass-card my-3 p-5">
            <h2 className="mb-2 text-xs font-medium tracking-[0.18em] text-sub">可搭配一對多室外機</h2>
            <ul>{systems.map((s) => <li key={s.id}><Link to="/catalog/multi-split" className="text-[15px] underline underline-offset-4">{s.model_code}{s.capacity_kw ? `（${s.capacity_kw}KW）` : ''}</Link></li>)}</ul>
          </section>
        )}

        {(p.link_urls.length > 0 || p.video_urls.length > 0) && (
          <section className="glass-card my-3 p-5">
            <h2 className="mb-2 text-xs font-medium tracking-[0.18em] text-sub">相關連結</h2>
            <ul className="space-y-2 text-[15px]">
              {p.link_urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4">{u}</a></li>)}
              {p.video_urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4">▶ 影片：{u}</a></li>)}
            </ul>
          </section>
        )}

        <section className="glass-card my-3 p-5">
          <h2 className="mb-2 text-xs font-medium tracking-[0.18em] text-sub">保養說明</h2>
          <p className={`whitespace-pre-wrap text-[15px] ${p.maintenance_notes ? '' : 'text-sub'}`}>{p.maintenance_notes || 'Google Sheets 尚未提供'}</p>
        </section>

        <section className="glass-card my-3 p-5 text-[13px] text-sub">
          <div className="flex justify-between"><span>規格最後更新</span><span>{fmtTime(p.spec_updated_at)}</span></div>
          <div className="flex justify-between"><span>最後同步</span><span>{fmtTime(p.last_synced_at)}</span></div>
          <div className="flex justify-between"><span>資料來源</span><span>Google Sheets「報價」第 {p.source_row ?? '—'} 列</span></div>
        </section>
      </main>
    </div>
  )
}
