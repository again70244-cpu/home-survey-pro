import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { QUALITY_LABEL, searchProducts } from '../catalog/search'
import type { CatalogProduct } from '../catalog/types'
import { ProductImage } from '../pages/CatalogPage'
import { Icon, TextInput } from './ui'

/** 從產品知識庫選擇產品（使用本機快取，離線也可用） */
export function ProductPicker({ onPick, onClose, selected = [] }: { onPick: (p: CatalogProduct) => void; onClose: () => void; selected?: string[] }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const all = useLiveQuery(() => db.catalog_products.toArray(), [])
  const cats = useMemo(() => [...new Set((all ?? []).filter((p) => p.is_active && p.category).map((p) => p.category!))], [all])
  const results = useMemo(() => (all ? searchProducts(all, { text: q, category: cat, quality: 'all' }).slice(0, 60) : []), [all, q, cat])
  const chip = (on: boolean) => `shrink-0 border px-3 py-1.5 text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-line'}`

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white" role="dialog" aria-label="選擇 LG 產品">
      <div className="flex items-center justify-between border-b border-line px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <h2 className="text-xl font-light">選擇 LG 產品</h2>
        <button onClick={onClose} className="h-11 px-2 text-[15px] underline underline-offset-4">完成</button>
      </div>
      <div className="px-4 pt-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-sub">{Icon.search}</span>
          <TextInput autoFocus type="search" placeholder="搜尋型號，例如 S2220" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" aria-label="搜尋要選擇的產品" />
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-2">
          <button className={chip(!cat)} onClick={() => setCat(null)}>全部</button>
          {cats.map((c) => <button key={c} className={chip(cat === c)} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {all !== undefined && all.length === 0 ? (
          <p className="py-12 text-center text-sm text-sub">
            這台裝置還沒有產品資料。請連線後到 <Link to="/catalog" className="underline">產品知識庫</Link> 下載。
          </p>
        ) : (
          <ul className="border-t border-ink">
            {results.map((p) => {
              const picked = selected.includes(p.id)
              return (
                <li key={p.id} className="border-b border-line">
                  <button onClick={() => onPick(p)} className="flex w-full items-center gap-3 py-3 text-left active:bg-sand" aria-label={`選擇 ${p.model_code}`}>
                    <ProductImage url={p.image_urls[0]} className="h-12 w-12 shrink-0 border border-line" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px]">{p.model_code}</span>
                      <span className="block truncate text-xs text-sub">{p.display_name || p.category}</span>
                      <span className={`text-xs ${p.data_quality === 'complete' ? 'text-[#555]' : p.data_quality === 'missing' ? 'text-oak' : 'text-red-700'}`}>{QUALITY_LABEL[p.data_quality]}</span>
                    </span>
                    <span className={`shrink-0 text-[13px] ${picked ? 'text-[#555]' : 'underline underline-offset-4'}`}>{picked ? '✓ 已選' : '選擇'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
