import { useSyncState } from '../sync/useSync'

/** 單筆資料的同步狀態 */
export type RowSyncState = 'local' | 'syncing' | 'waiting' | 'synced' | 'error' | 'conflict'

const styles: Record<RowSyncState, [string, string]> = {
  local: ['本機已保存', 'text-oak'],
  syncing: ['同步中', 'text-sub'],
  waiting: ['等待網路同步', 'text-oak'],
  synced: ['已同步', 'text-ink/75'],
  error: ['同步失敗', 'text-red-700'],
  conflict: ['版本衝突待處理', 'text-red-700'],
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
    <span className={`inline-flex items-center gap-1.5 text-xs ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${state === 'syncing' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}

/** 便利元件：直接傳入資料列 */
export function RowSync({ row, hasConflict }: { row: { _dirty: 0 | 1; _syncError?: string | null }; hasConflict?: boolean }) {
  return <SyncBadge state={useRowSyncState(row, hasConflict)} />
}
