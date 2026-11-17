/** 單筆資料的同步狀態。第五階段接上同步引擎後會出現「同步中 / 失敗」 */
export type RowSyncState = 'local' | 'synced' | 'error'

export function rowSyncState(row: { _dirty: 0 | 1; _syncError?: string | null }): RowSyncState {
  if (row._syncError) return 'error'
  return row._dirty ? 'local' : 'synced'
}

const styles: Record<RowSyncState, [string, string]> = {
  local: ['本機已保存・尚未同步', 'bg-amber-50 text-amber-700 ring-amber-200'],
  synced: ['雲端已同步', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  error: ['同步失敗', 'bg-red-50 text-red-700 ring-red-200'],
}

export function SyncBadge({ state }: { state: RowSyncState }) {
  const [label, cls] = styles[state]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
