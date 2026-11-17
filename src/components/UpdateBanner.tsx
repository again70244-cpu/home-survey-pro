import { useSyncExternalStore } from 'react'
import { applyUpdate, pwaStore } from '../lib/pwa'

export function UpdateBanner() {
  const s = useSyncExternalStore(pwaStore.subscribe, pwaStore.get)
  if (!s.needRefresh) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-sm text-white">
      <span>有新版本可用（資料都已保存在本機）</span>
      <button onClick={() => void applyUpdate()} className="rounded-lg bg-white px-3 py-1.5 font-semibold text-slate-900">更新</button>
    </div>
  )
}
