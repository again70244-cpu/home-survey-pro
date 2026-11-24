import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { getCatalogMeta, refreshCatalog, useCatalogSyncState } from '../catalog/catalogSync'
import { catalogStats, fmtTime, QUALITY_LABEL, searchProducts } from '../catalog/search'
import type { CatalogProduct } from '../catalog/types'
import { Icon, IconButton, PageTitle, TextButton, TextInput, TopBar } from '../components/ui'

function QualityTag({ q }: { q: CatalogProduct['data_quality'] }) {
  const cls = q === 'complete' ? 'text-ink/75' : q === 'missing' ? 'text-oak' : 'text-red-700'
  return <span className={`text-xs ${cls}`}>{q === 'complete' ? '✓ ' : ''}{QUALITY_LABEL[q]}</span>
}

/**
 * 產品縮圖：以 CORS 載入（快取才能判斷是否成功）；失敗時自動重試一次（imgbb 偶爾逾時），
 * 再失敗才顯示佔位（例如離線且未快取）
 */
export function ProductImage({ url, className = '' }: { url?: string; className?: string }) {
  const [tries, setTries] = useState(0)
  if (!url || tries > 1) return <div className={`flex items-center justify-center bg-sand text-[10px] text-sub ${className}`}>無圖片</div>
  return (
    <img
      key={tries}
      src={tries ? `${url}${url.includes('?') ? '&' : '?'}retry=1` : url}
      alt=""
      loading="lazy"
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      onError={() => setTimeout(() => setTries((t) => t + 1), tries ? 0 : 1500)}
      className={`bg-white object-contain ${className}`}
    />
  )
}

function SyncStatus({ products }: { products: CatalogProduct[] }) {
  const sync = useCatalogSyncState()
  const meta = useLiveQuery(() => getCatalogMeta(), [])
  const st = catalogStats(products)
  const last = meta?.lastAttempt
  const ok = last ? last.status === 'success' || last.status === 'unchanged' : null
  return (
    <section className="border-y border-line py-4" aria-label="同步狀態">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-[0.18em] text-sub">資料同步</h2>
        <button onClick={() => void refreshCatalog(true)} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-ink disabled:opacity-40" disabled={sync.phase === 'checking' || sync.phase === 'downloading'}>
          {sync.phase === 'checking' ? '檢查中…' : sync.phase === 'downloading' ? '下載中…' : '重新整理'}
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-sub">最近同步</dt>
        <dd className="text-right">{fmtTime(meta?.lastSuccess?.finished_at)}</dd>
        <dt className="text-sub">同步狀態</dt>
        <dd className={`text-right ${ok === false ? 'text-red-700' : ''}`}>
          {ok === null ? '尚未同步' : ok ? '成功' : last?.status === 'rejected' ? '已拒絕（保護機制）' : '失敗'}
        </dd>
        <dt className="text-sub">這台裝置下載於</dt>
        <dd className="text-right">{fmtTime(meta?.downloadedAt)}</dd>
      </dl>
      {ok === false && <p className="mt-2 text-[13px] text-red-700">最近一次同步沒有成功，目前顯示的是最後一次成功同步的資料。{last?.error ? `（${last.error}）` : ''}</p>}
      {sync.phase === 'offline' && <p className="mt-2 text-[13px] text-oak">離線中，顯示這台裝置最後下載的資料</p>}
      {sync.phase === 'error' && <p className="mt-2 text-[13px] text-red-700">下載失敗：{sync.error}（仍顯示既有資料）</p>}
      <div className="glass-card mt-4 grid grid-cols-4 p-2 text-center">
        {(
          [
            ['產品', st.total],
            ['有安裝尺寸', st.withInstall],
            ['缺少安裝', st.missing],
            ['資料異常', st.abnormal],
          ] as const
        ).map(([l, n], i) => (
          <div key={l} className={`py-2.5 ${i < 3 ? 'border-r border-line' : ''}`}>
            <div className="text-2xl font-light tabular-nums">{n}</div>
            <div className="text-[11px] text-sub">{l}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function CatalogPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [quality, setQuality] = useState<'all' | 'with' | 'missing'>('all')
  const products = useLiveQuery(() => db.catalog_products.toArray(), [])
  useEffect(() => void refreshCatalog(), [])

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products ?? []) if (p.is_active && p.category) m.set(p.category, (m.get(p.category) ?? 0) + 1)
    return [...m.entries()]
  }, [products])
  const results = useMemo(() => (products ? searchProducts(products, { text: q, category: cat, quality }) : []), [products, q, cat, quality])

  const chip = (active: boolean) => `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] ${active ? 'glass-dark' : 'glass text-ink'}`

  return (
    <div className="min-h-dvh pb-10">
      <TopBar
        left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}紀錄</IconButton>}
        right={<TextButton onClick={() => nav('/catalog/multi-split')}>一對多搭配</TextButton>}
      />
      <main className="mx-auto max-w-2xl px-6">
        <PageTitle eyebrow="LG PRODUCT KNOWLEDGE BASE" title="LG 產品知識庫" />
        <SyncStatus products={products ?? []} />

        <div className="relative mt-5">
          <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-sub">{Icon.search}</span>
          <TextInput type="search" placeholder="搜尋型號，例如 S2220、R723" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" aria-label="搜尋產品型號" />
        </div>
        <div className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 pb-1" role="group" aria-label="分類">
          <button className={chip(!cat)} onClick={() => setCat(null)}>全部</button>
          {categories.map(([c, n]) => (
            <button key={c} className={chip(cat === c)} onClick={() => setCat(cat === c ? null : c)}>{c}（{n}）</button>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[13px]" role="group" aria-label="安裝資料">
          {([['all', '全部'], ['with', '有安裝尺寸'], ['missing', '缺少安裝資料']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setQuality(k)} className={`rounded-full px-3 py-1 ${quality === k ? 'glass-dark' : 'text-sub'}`}>{l}</button>
          ))}
        </div>

        {products === undefined ? (
          <p className="py-10 text-center text-sub">讀取中…</p>
        ) : products.length === 0 ? (
          <p className="py-12 text-center text-sub">尚未下載產品資料{navigator.onLine ? '（產品資料尚未從 Google Sheets 同步）' : '，請連線後再試'}</p>
        ) : (
          <>
            <p className="mt-4 text-xs text-sub">{results.length} 筆</p>
            <ul className="glass-card mt-2 px-4">
              {results.map((p) => (
                <li key={p.id} className="border-b border-line">
                  <Link to={`/catalog/${p.id}`} className="flex items-center gap-4 py-4 active:bg-sand">
                    <ProductImage url={p.image_urls[0]} className="h-16 w-16 shrink-0 border border-line" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[17px] text-ink">{p.model_code}</div>
                      <div className="mt-0.5 truncate text-[13px] text-ink/75">{p.display_name || p.category || '—'}</div>
                      <div className="mt-1 flex gap-3">
                        <QualityTag q={p.data_quality} />
                        {p.category && <span className="text-xs text-sub">{p.category}</span>}
                      </div>
                    </div>
                    <span className="text-ink/40">{Icon.chevron}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {results.length === 0 && <p className="py-10 text-center text-sub">找不到符合的產品</p>}
          </>
        )}
      </main>
    </div>
  )
}
