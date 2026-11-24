import { useSyncExternalStore } from 'react'
import { applyUpdate, pwaStore } from '../lib/pwa'

export function UpdateBanner() {
  const s = useSyncExternalStore(pwaStore.subscribe, pwaStore.get)
  if (!s.needRefresh) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 glass-dark rounded-b-3xl px-6 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-sm text-white">
      <span>有新版本可用（資料都已保存在本機）</span>
      <button onClick={() => void applyUpdate()} className="rounded-full border border-[#081018]/60 px-4 py-1.5 font-medium text-[#081018]">更新</button>
    </div>
  )
}
