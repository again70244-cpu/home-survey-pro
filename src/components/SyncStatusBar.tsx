import { Link } from 'react-router-dom'
import { useSyncState } from '../sync/useSync'
import { retrySync, syncNow } from '../sync/engine'

function ago(ts: number | null) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return '剛剛'
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}

/** 全域同步狀態列 */
export function SyncStatusBar() {
  const s = useSyncState()

  if (s.conflicts > 0)
    return (
      <Link to="/conflicts" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
        <span>⚠ 有 {s.conflicts} 筆資料在兩台裝置都被修改，請選擇要保留的版本</span>
        <span className="font-semibold">處理</span>
      </Link>
    )

  if (s.phase === 'error')
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
        <span className="min-w-0 break-words">同步失敗：{s.lastError}</span>
        <button onClick={() => void retrySync()} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold ring-1 ring-red-200 active:bg-red-100">
          重試
        </button>
      </div>
    )

  const [dot, text] =
    s.phase === 'offline'
      ? ['bg-amber-500', s.pending ? `離線中・${s.pending} 筆等待網路同步` : '離線中・資料保存在本機']
      : s.phase === 'syncing'
        ? ['bg-brand-500 animate-pulse', '雲端同步中…']
        : s.pending
          ? ['bg-amber-500', `本機已保存・${s.pending} 筆尚未同步`]
          : ['bg-emerald-500', `雲端已同步${s.lastSyncedAt ? `・${ago(s.lastSyncedAt)}` : ''}`]

  return (
    <button onClick={() => void syncNow()} className="flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left text-sm text-slate-500 active:bg-slate-200" title="立即同步">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span>{text}</span>
    </button>
  )
}
