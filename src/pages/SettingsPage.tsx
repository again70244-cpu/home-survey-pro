import { useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth, useUserId } from '../auth/AuthProvider'
import { applyRestore, exportJson, exportZip, readBackup, type RestorePlan } from '../backup/backup'
import { db } from '../db/db'
import { supabase } from '../lib/supabase'
import { pwaStore, promptInstall } from '../lib/pwa'
import { downloadBlob } from '../report/share'
import { retrySync, syncNow } from '../sync/engine'
import { useSyncState } from '../sync/useSync'
import { Button, Card, ErrorBox, Icon, IconButton, InfoBox, TopBar, PageTitle } from '../components/ui'
import { useToast } from '../components/Toast'

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

export function SettingsPage() {
  const userId = useUserId()
  const { user } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const sync = useSyncState()
  const pwa = useSyncExternalStore(pwaStore.subscribe, pwaStore.get)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  // 照片空間用量（以本機紀錄的檔案大小估算；Supabase 免費方案 Storage 上限 1 GB）
  const usage = useLiveQuery(async () => {
    const ps = (await db.survey_photos.where('user_id').equals(userId).toArray()).filter((p) => !p.deleted_at)
    return { count: ps.length, bytes: ps.reduce((s, p) => s + (p.size_bytes ?? 0), 0) }
  }, [userId])

  async function run(label: string, fn: () => Promise<void>) {
    setError('')
    setInfo('')
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onZip = () =>
    run('準備備份中…', async () => {
      const { blob, json } = await exportZip(userId, user?.email ?? null, (d, t) => setBusy(`準備照片 ${d}/${t}`))
      downloadBlob(blob, `場勘備份_${stamp()}.zip`)
      setInfo(`已匯出 ${json.counts.surveys} 筆場勘、${json.counts.areas} 個區域、${json.counts.products ?? 0} 個安裝產品、${json.counts.photoFiles} 張原始照片。${json.missingPhotoFiles.length ? `（${json.missingPhotoFiles.length} 張照片因離線且未下載而未包含）` : ''}`)
    })
  const onJson = () =>
    run('匯出中…', async () => {
      downloadBlob(await exportJson(userId, user?.email ?? null), `場勘資料_${stamp()}.json`)
      setInfo('已匯出 JSON（不含照片檔案）')
    })
  const onPick = (f: File | undefined) => f && run('讀取備份檔…', async () => setPlan(await readBackup(f, userId)))
  const onRestore = () =>
    run('還原中…', async () => {
      const r = await applyRestore(plan!, userId)
      setPlan(null)
      setInfo(`還原完成：新增 ${r.surveys} 筆場勘、${r.areas} 個區域、${r.products} 個安裝產品、${r.templates} 份現場檢查、${r.photos} 張照片，將自動同步到雲端。`)
      toast('還原完成')
      void syncNow()
    })

  async function logout() {
    const pending = await db.outbox.where('userId').equals(userId).count()
    if (pending > 0 && !confirm(`還有 ${pending} 筆資料尚未同步到雲端。\n登出後資料仍保留在這台裝置，重新登入會繼續同步。\n\n確定要登出嗎？`)) return
    await supabase!.auth.signOut({ scope: 'local' })
  }

  const nothingNew = plan && !plan.newSurveys.length && !plan.newAreas.length && !plan.newPhotos.length && !plan.newProducts.length && !plan.newTemplates.length

  return (
    <div className="min-h-dvh pb-10">
      <TopBar left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}紀錄</IconButton>} />
      <main className="mx-auto max-w-2xl space-y-4 px-6">
        <PageTitle eyebrow="SETTINGS" title="設定" />
        <ErrorBox>{error}</ErrorBox>
        <InfoBox>{info}</InfoBox>
        {busy && <div className="border-l-2 border-ink bg-sand px-3.5 py-3 text-sm text-ink">{busy}</div>}

        <Card>
          <h2 className="text-xs font-medium tracking-[0.18em] text-sub">帳號</h2>
          <p className="mt-1 break-all text-lg font-light text-ink">{user?.email}</p>
          {pwa.canInstall && !pwa.installed && (
            <Button className="mt-3 w-full" onClick={() => void promptInstall()}>安裝到主畫面</Button>
          )}
          {pwa.installed && <p className="mt-2 text-sm text-ink/75">✓ 已安裝為 App</p>}
        </Card>

        <Card>
          <h2 className="text-xs font-medium tracking-[0.18em] text-sub">同步狀態</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-sub">狀態</dt><dd className="font-medium">{{ idle: '正常', syncing: '同步中', offline: '離線（等待網路）', error: '同步失敗' }[sync.phase]}</dd></div>
            <div className="flex justify-between"><dt className="text-sub">尚未同步</dt><dd className="font-medium">{sync.pending} 筆</dd></div>
            <div className="flex justify-between"><dt className="text-sub">衝突待處理</dt><dd className="font-medium">{sync.conflicts} 筆</dd></div>
            <div className="flex justify-between"><dt className="text-sub">最後同步</dt><dd className="font-medium">{sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString('zh-TW') : '—'}</dd></div>
            {sync.lastError && <div className="break-words text-red-600">錯誤：{sync.lastError}</div>}
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void retrySync()}>立即同步／重試</Button>
            <Button variant="secondary" disabled={!sync.conflicts} onClick={() => nav('/conflicts')}>處理衝突</Button>
          </div>
        </Card>

        {usage && (
          <Card>
            <h2 className="text-xs font-medium tracking-[0.18em] text-sub">照片空間</h2>
            {(() => {
              const LIMIT = 1024 ** 3
              const pct = Math.min(100, (usage.bytes / LIMIT) * 100)
              return (
                <div data-testid="storage-usage">
                  <p className="mt-1 text-lg font-light tabular-nums text-ink">
                    {(usage.bytes / 1024 ** 2).toFixed(1)} MB <span className="text-sm text-sub">/ 1 GB・{usage.count} 張照片</span>
                  </p>
                  <div className="mt-2 h-1.5 w-full bg-sand-2" aria-hidden><div className={`h-full ${pct > 80 ? 'bg-red-700' : 'bg-ink'}`} style={{ width: `${Math.max(pct, 0.5)}%` }} /></div>
                  <p className="mt-2 text-xs text-sub">
                    免費方案的雲端照片空間上限為 1 GB{usage.count > 0 && usage.bytes > 0 ? `（依目前平均大小約可存 ${Math.floor(LIMIT / (usage.bytes / usage.count)).toLocaleString()} 張）` : ''}。{pct > 80 ? '空間即將用完，請匯出完整備份後刪除舊案件。' : ''}
                  </p>
                </div>
              )
            })()}
          </Card>
        )}

        <Card>
          <h2 className="text-xs font-medium tracking-[0.18em] text-sub">資料備份</h2>
          <p className="mt-1 text-sm text-sub">雲端同步之外的完整備份，建議定期保存一份到電腦或雲端硬碟。</p>
          <div className="mt-3 space-y-2">
            <Button className="w-full" disabled={!!busy} onClick={() => void onZip()}>匯出完整備份（ZIP，含原始照片）</Button>
            <Button variant="secondary" className="w-full" disabled={!!busy} onClick={() => void onJson()}>只匯出資料（JSON）</Button>
            <Button variant="secondary" className="w-full" disabled={!!busy} onClick={() => fileRef.current?.click()}>從備份還原…</Button>
            <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" className="hidden" data-testid="restore-input" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </Card>

        <Button variant="danger" className="w-full" onClick={() => void logout()}>登出</Button>
        <p className="text-center text-xs text-sub">家電場勘助手 Pro・版本 {__APP_VERSION__}</p>
      </main>

      {plan && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/30">
          <div className="w-full rounded-t-[28px] bg-[#121724]/95 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-6 backdrop-blur-xl" role="dialog" aria-label="確認還原">
            <h3 className="text-2xl font-light text-ink">確認從備份還原</h3>
            <p className="mt-1 text-sm text-sub">備份時間：{new Date(plan.json.exportedAt).toLocaleString('zh-TW')}{plan.json.account?.email ? `・${plan.json.account.email}` : ''}</p>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              {([['場勘', plan.newSurveys.length, plan.skipped.surveys], ['區域', plan.newAreas.length, plan.skipped.areas], ['照片', plan.newPhotos.length, plan.skipped.photos], ['產品', plan.newProducts.length, plan.skipped.products], ['現場檢查', plan.newTemplates.length, plan.skipped.templates]] as const).map(([l, n, sk]) => (
                <div key={l} className="border-t border-ink pt-3">
                  <div className="text-xs text-sub">{l}</div>
                  <div className="text-3xl font-light text-ink">+{n}</div>
                  <div className="text-xs text-sub">已存在 {sk}（略過）</div>
                </div>
              ))}
            </div>
            {plan.otherAccount && <p className="mt-3 border-l-2 border-oak bg-sand p-3 text-sm text-ink">此備份來自其他帳號，還原後資料會屬於目前登入的帳號。</p>}
            {plan.photosWithoutFile > 0 && <p className="mt-3 text-sm text-amber-700">{plan.photosWithoutFile} 張照片在備份中沒有檔案（JSON 備份），將不會還原。</p>}
            <p className="mt-3 text-sm text-ink/75">{nothingNew ? '備份中的資料都已存在，不需要還原。' : '已存在的資料不會被覆蓋，也不會重複建立。'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setPlan(null)}>取消</Button>
              <Button disabled={!!nothingNew || !!busy} onClick={() => void onRestore()}>確認還原</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
