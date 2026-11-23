/**
 * 產品知識庫下載（唯讀）
 *
 * - 與場勘資料的雙向同步（src/sync/engine.ts）完全分開，不修改它。
 * - 只在伺服器有「新的成功同步」時才重新下載；否則沿用本機快取。
 * - 下載失敗或離線：保留最後一次成功下載的資料，App 照常使用。
 * - 寫入本機時用單一交易整批替換，不會出現一半新、一半舊的狀態。
 */
import { useSyncExternalStore } from 'react'
import { db } from '../db/db'
import { supabase } from '../lib/supabase'
import type { CatalogMeta, CatalogProduct, CatalogRunInfo, CatalogSystem } from './types'

const META_KEY = 'catalog:meta'
const PAGE = 1000
const REFRESH_MS = 30 * 60 * 1000

type Phase = 'idle' | 'checking' | 'downloading' | 'offline' | 'error'
let state: { phase: Phase; error: string | null } = { phase: 'idle', error: null }
const subs = new Set<() => void>()
const setState = (p: Partial<typeof state>) => {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
export const catalogStore = { get: () => state, subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)) }
export const useCatalogSyncState = () => useSyncExternalStore(catalogStore.subscribe, catalogStore.get)

export async function getCatalogMeta(): Promise<CatalogMeta> {
  const m = (await db.meta.get(META_KEY))?.value as CatalogMeta | undefined
  return m ?? { lastSuccess: null, lastAttempt: null, downloadedAt: null, downloadedRunId: null }
}

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase!.from(table).select(select).order('model_code').range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

let running: Promise<void> | null = null

/** 檢查並在需要時下載最新產品資料；force = 無論如何重新下載 */
export function refreshCatalog(force = false): Promise<void> {
  if (running) return running
  running = (async () => {
    if (!supabase) return
    if (!navigator.onLine) {
      setState({ phase: 'offline', error: null })
      return
    }
    try {
      setState({ phase: 'checking', error: null })
      const meta = await getCatalogMeta()
      const { data: runs, error } = await supabase
        .from('catalog_sync_runs')
        .select('id,status,trigger,finished_at,error,counts')
        .neq('status', 'preview')
        .order('finished_at', { ascending: false })
        .limit(30)
      if (error) throw error
      const list = (runs ?? []) as CatalogRunInfo[]
      const lastAttempt = list[0] ?? null
      const lastSuccess = list.find((r) => r.status === 'success' || r.status === 'unchanged') ?? null
      const lastDataChange = list.find((r) => r.status === 'success') ?? null
      const needDownload = force || !meta.downloadedRunId || (lastDataChange && lastDataChange.id !== meta.downloadedRunId)

      if (needDownload) {
        setState({ phase: 'downloading' })
        const products = await fetchAll<CatalogProduct>('catalog_products', '*')
        const systemsRaw = await fetchAll<Omit<CatalogSystem, 'indoor_units'> & { catalog_multi_split_indoor_units: CatalogSystem['indoor_units'] }>(
          'catalog_multi_split_systems',
          '*,catalog_multi_split_indoor_units(position,model_code,series,capacity_kw,source_text)',
        )
        const systems: CatalogSystem[] = systemsRaw.map(({ catalog_multi_split_indoor_units: u, ...s }) => ({
          ...s,
          indoor_units: [...(u ?? [])].sort((a, b) => a.position - b.position),
        }))
        // 伺服器沒有任何資料（尚未首次同步）時，不清除本機既有快取
        if (products.length || !meta.downloadedRunId) {
          await db.transaction('rw', db.catalog_products, db.catalog_systems, db.meta, async () => {
            await db.catalog_products.clear()
            await db.catalog_products.bulkPut(products)
            await db.catalog_systems.clear()
            await db.catalog_systems.bulkPut(systems)
            await db.meta.put({
              key: META_KEY,
              value: { lastSuccess, lastAttempt, downloadedAt: new Date().toISOString(), downloadedRunId: lastDataChange?.id ?? null } satisfies CatalogMeta,
            })
          })
        }
      } else {
        await db.meta.put({ key: META_KEY, value: { ...meta, lastSuccess, lastAttempt } satisfies CatalogMeta })
      }
      setState({ phase: 'idle', error: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ phase: /fetch|network/i.test(msg) || !navigator.onLine ? 'offline' : 'error', error: msg })
    }
  })().finally(() => {
    running = null
  })
  return running
}

/** 登入後啟動：立即檢查一次、網路恢復時、每 30 分鐘 */
export function startCatalogSync(): () => void {
  void refreshCatalog()
  const onOnline = () => void refreshCatalog()
  window.addEventListener('online', onOnline)
  const t = window.setInterval(() => void refreshCatalog(), REFRESH_MS)
  return () => {
    window.removeEventListener('online', onOnline)
    window.clearInterval(t)
  }
}
