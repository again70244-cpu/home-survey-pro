import { useSyncState } from '../sync/useSync'

/** 單筆資料的同步狀態 */
export type RowSyncState = 'local' | 'syncing' | 'waiting' | 'synced' | 'error' | 'conflict'

const styles: Record<RowSyncState, [string, string]> = {
  local: ['本機已保存', 'bg-amber-50 text-amber-700 ring-amber-200'],
  syncing: ['雲端同步中', 'bg-brand-50 text-brand-700 ring-brand-100'],
  waiting: ['等待網路同步', 'bg-amber-50 text-amber-700 ring-amber-200'],
  synced: ['雲端已同步', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  error: ['同步失敗', 'bg-red-50 text-red-700 ring-red-200'],
  conflict: ['版本衝突待處理', 'bg-red-50 text-red-700 ring-red-200'],
}

export function useRowSyncState(row: { _dirty: 0 | 1; _syncError?: string | null }, hasConflict = false): RowSyncState {
  const { phase } = useSyncState()
  if (hasConflict) return 'conflict'
  if (row._syncError) return 'error'
  if (!row._dirty) return 'synced'
  if (phase === 'syncing') return 'syncing'
  if (phase === 'offline') return 'waiting'
  return 'local'
}

export function SyncBadge({ state }: { state: RowSyncState }) {
  const [label, cls] = styles[state]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${state === 'syncing' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

/** 便利元件：直接傳入資料列 */
export function RowSync({ row, hasConflict }: { row: { _dirty: 0 | 1; _syncError?: string | null }; hasConflict?: boolean }) {
  return <SyncBadge state={useRowSyncState(row, hasConflict)} />
}
