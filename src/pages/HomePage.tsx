import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useUserId } from '../auth/AuthProvider'
import { formatDate, normalize } from '../lib/format'
import { Icon, IconButton, TextInput, TopBar } from '../components/ui'
import { RowSync } from '../components/SyncBadge'
import { SyncStatusBar } from '../components/SyncStatusBar'

export function HomePage() {
  const userId = useUserId()
  const nav = useNavigate()
  const [q, setQ] = useState('')

  const surveys = useLiveQuery(
    () =>
      db.surveys
        .where('user_id')
        .equals(userId)
        .filter((s) => !s.deleted_at)
        .toArray()
        .then((rows) =>
          rows.sort((a, b) => (b.survey_date ?? '').localeCompare(a.survey_date ?? '') || b.updated_at.localeCompare(a.updated_at)),
        ),
    [userId],
  )

  const conflictIds = useLiveQuery(
    () => db.conflicts.where('userId').equals(userId).toArray().then((cs) => new Set(cs.map((c) => (c.table === 'surveys' ? c.rowId : (c.local.survey_id as string))))),
    [userId],
  )

  const filtered = useMemo(() => {
    const k = normalize(q)
    if (!surveys || !k) return surveys
    return surveys.filter((s) =>
      [s.customer_name, s.customer_phone, s.customer_address, s.product_model].some((f) => normalize(f).includes(k)),
    )
  }, [surveys, q])

  return (
    <div className="min-h-dvh pb-28">
      <TopBar
        title="場勘紀錄"
        right={
          <IconButton label="設定" onClick={() => nav('/settings')}>
            {Icon.user}
          </IconButton>
        }
      />
      <main className="mx-auto max-w-2xl space-y-3 px-4 pt-3">
        <SyncStatusBar />
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{Icon.search}</span>
          <TextInput
            type="search"
            placeholder="搜尋客戶姓名、電話、地址、型號"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-11"
          />
        </div>

        {filtered === undefined ? (
          <p className="py-10 text-center text-slate-400">讀取中…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            {q ? (
              <p className="text-slate-500">找不到符合「{q}」的場勘紀錄</p>
            ) : (
              <>
                <p className="text-base font-medium text-slate-700">還沒有場勘紀錄</p>
                <p className="mt-1 text-sm text-slate-500">點下方「新增場勘」開始第一筆</p>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/survey/${s.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-lg font-semibold text-slate-900">{s.customer_name || '（未填姓名）'}</span>
                      <span className="shrink-0 text-sm text-slate-500">{formatDate(s.survey_date)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-600">
                      {s.product_model || '未填產品型號'}
                    </div>
                    {s.customer_address && <div className="mt-0.5 truncate text-sm text-slate-400">{s.customer_address}</div>}
                    <div className="mt-2">
                      <RowSync row={s} hasConflict={conflictIds?.has(s.id)} />
                    </div>
                  </div>
                  <span className="text-slate-300">{Icon.chevron}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => nav('/survey/new')}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white shadow-md active:bg-brand-700"
          >
            {Icon.plus} 新增場勘
          </button>
        </div>
      </div>
    </div>
  )
}
