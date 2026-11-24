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
/**
 * 全域同步狀態
 * - compact：只顯示一行狀態文字（放在標題下的資訊列）
 * - alertsOnly：只在有衝突或同步失敗時顯示提醒
 */
export function SyncStatusBar({ compact = false, alertsOnly = false }: { compact?: boolean; alertsOnly?: boolean }) {
  const s = useSyncState()

  if (!compact) {
    if (s.conflicts > 0)
      return (
        <Link to="/conflicts" className="flex items-center justify-between gap-3 border-l-2 border-red-700 bg-red-50 px-3.5 py-3 text-sm text-red-800">
          <span>有 {s.conflicts} 筆資料在兩台裝置都被修改，請選擇要保留的版本</span>
          <span className="glass shrink-0 rounded-full px-3 py-1 text-ink">處理</span>
        </Link>
      )
    if (s.phase === 'error')
      return (
        <div className="flex items-center justify-between gap-3 border-l-2 border-red-700 bg-red-50 px-3.5 py-3 text-sm text-red-800">
          <span className="min-w-0 break-words">同步失敗：{s.lastError}</span>
          <button onClick={() => void retrySync()} className="glass shrink-0 rounded-full px-3 py-1.5 text-red-700">
            重試
          </button>
        </div>
      )
    if (alertsOnly) return null
  }

  const [dot, text] =
    s.phase === 'offline'
      ? ['text-oak', s.pending ? `離線中・${s.pending} 筆等待網路同步` : '離線中・資料保存在本機']
      : s.phase === 'syncing'
        ? ['text-sub', '雲端同步中…']
        : s.phase === 'error'
          ? ['text-red-700', '同步失敗']
          : s.pending
            ? ['text-oak', `本機已保存・${s.pending} 筆尚未同步`]
            : ['text-ink/75', `雲端已同步${s.lastSyncedAt ? `・${ago(s.lastSyncedAt)}` : ''}`]

  return (
    <button onClick={() => void syncNow()} className={`inline-flex items-center gap-1.5 text-left text-[13px] active:opacity-60 ${dot}`} title="立即同步">
      {s.phase === 'syncing' ? (
        <svg className="hsp-spin shrink-0 text-accent" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      ) : (
        <span key={s.phase + String(s.pending > 0)} className="hsp-pop-in h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      )}
      <span>{text}</span>
    </button>
  )
}
