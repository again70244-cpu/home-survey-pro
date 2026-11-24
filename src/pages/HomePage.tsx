import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useUserId } from '../auth/AuthProvider'
import { formatDate, normalize } from '../lib/format'
import { BottomBar, Button, Icon, PageTitle, TextButton, TextInput, TopBar } from '../components/ui'
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
        left={<TextButton onClick={() => nav('/catalog')} aria-label="LG 產品知識庫">{Icon.book}產品知識庫</TextButton>}
        right={
          <TextButton onClick={() => nav('/settings')} aria-label="設定">{Icon.settings}設定</TextButton>
        }
      />
      <main className="mx-auto max-w-2xl px-6">
        <PageTitle
          eyebrow="HOME APPLIANCE SITE SURVEY"
          title="場勘紀錄"
          meta={
            <>
              <span>{surveys?.length ?? 0} 筆紀錄</span>
              <SyncStatusBar compact />
            </>
          }
        />
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-sub">{Icon.search}</span>
          <TextInput type="search" placeholder="搜尋姓名、電話、地址、型號" value={q} onChange={(e) => setQ(e.target.value)} className="glass !h-12 rounded-full !border !border-white/80 !py-0 !pl-11 !pr-4" />
        </div>
        <div className="mt-2"><SyncStatusBar alertsOnly /></div>

        {filtered === undefined ? (
          <p className="py-10 text-center text-sub">讀取中…</p>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            {q ? (
              <p className="text-sub">找不到符合「{q}」的場勘紀錄</p>
            ) : (
              <>
                <p className="text-lg font-light text-ink">還沒有場勘紀錄</p>
                <p className="mt-1 text-sm text-sub">點下方「新增場勘」開始第一筆</p>
              </>
            )}
          </div>
        ) : (
          <ul className="glass-card mt-4 px-4">
            {filtered.map((s) => (
              <li key={s.id} className="border-b border-line">
                <Link to={`/survey/${s.id}`} className="flex items-center gap-3 py-5 active:bg-sand">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-xl font-normal text-ink">{s.customer_name || '（未填姓名）'}</span>
                      <span className="shrink-0 text-xs tracking-wider text-sub">{formatDate(s.survey_date)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-4 text-[13px] text-[#555]">
                      <span className="shrink-0">{s.product_model || '未填型號'}</span>
                      {s.customer_address && <span className="truncate text-sub">{s.customer_address}</span>}
                    </div>
                    {(s._dirty || s._syncError || conflictIds?.has(s.id)) && (
                      <div className="mt-2">
                        <RowSync row={s} hasConflict={conflictIds?.has(s.id)} />
                      </div>
                    )}
                  </div>
                  <span className="text-[#c4c4c4]">{Icon.chevron}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <BottomBar>
        <Button className="h-14 w-full" onClick={() => nav('/survey/new')}>
          {Icon.plus} 新增場勘
        </Button>
      </BottomBar>
    </div>
  )
}
