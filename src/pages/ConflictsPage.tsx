import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useUserId } from '../auth/AuthProvider'
import { COLUMNS, resolveConflict } from '../sync/engine'
import { Button, Card, Icon, IconButton, TopBar, PageTitle } from '../components/ui'
import { useToast } from '../components/Toast'
import type { ConflictItem } from '../db/types'

const TABLE_LABEL = { surveys: '場勘資料', survey_areas: '場勘區域', survey_photos: '照片' } as const
const FIELD_LABEL: Record<string, string> = {
  customer_name: '客戶姓名', customer_phone: '聯絡電話', survey_date: '場勘日期', customer_address: '客戶地址',
  product: '安裝產品', product_model: '產品型號', notes: '備註', deleted_at: '狀態', name: '區域名稱', kind: '區域類型',
  width_cm: '寬度 (cm)', depth_cm: '深度 (cm)', height_cm: '高度 (cm)', sort_order: '排序', caption: '照片說明',
}

function show(field: string, v: unknown): string {
  if (field === 'deleted_at') return v ? '已刪除' : '存在'
  if (v === null || v === undefined || v === '') return field.endsWith('_cm') ? '尚未測量' : '（空白）'
  return String(v)
}

function ConflictCard({ c }: { c: ConflictItem }) {
  const toast = useToast()
  const fields = COLUMNS[c.table].filter(
    (f) => FIELD_LABEL[f] && String(c.local[f] ?? '') !== String(c.remote[f] ?? '') && !(f === 'deleted_at' && !!c.local[f] === !!c.remote[f]),
  )
  const title = (c.local.customer_name ?? c.local.name ?? c.local.caption ?? '') as string
  const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString('zh-TW') : '')

  async function choose(choice: 'local' | 'remote') {
    await resolveConflict(c.key, choice)
    toast(choice === 'local' ? '已採用此裝置版本' : '已採用雲端版本')
  }

  return (
    <Card>
      <div className="text-xs font-medium tracking-[0.18em] text-sub">{TABLE_LABEL[c.table]}</div>
      <div className="mt-0.5 text-xl font-light text-ink">{title || '（未命名）'}</div>
      <div className="mt-3 border-t border-ink">
        <div className="grid grid-cols-[5.5rem_1fr_1fr] border-b border-line text-xs text-sub">
          <div className="px-2 py-2">欄位</div>
          <div className="px-2 py-2">此裝置<div className="font-normal">{when(c.local.updated_at)}</div></div>
          <div className="px-2 py-2">雲端（其他裝置）<div className="font-normal">{when(c.remote.updated_at)}</div></div>
        </div>
        {fields.map((f) => (
          <div key={f} className="grid grid-cols-[5.5rem_1fr_1fr] border-t border-line text-sm">
            <div className="px-2 py-2 text-sub">{FIELD_LABEL[f]}</div>
            <div className="break-words px-2 py-2 text-ink">{show(f, c.local[f])}</div>
            <div className="break-words px-2 py-2 text-ink">{show(f, c.remote[f])}</div>
          </div>
        ))}
        {fields.length === 0 && <div className="border-t border-line px-2 py-2 text-sm text-sub">內容相同（僅排序等欄位不同）</div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void choose('local')}>採用此裝置</Button>
        <Button variant="secondary" onClick={() => void choose('remote')}>採用雲端</Button>
      </div>
    </Card>
  )
}

export function ConflictsPage() {
  const userId = useUserId()
  const nav = useNavigate()
  const list = useLiveQuery(() => db.conflicts.where('userId').equals(userId).sortBy('detectedAt'), [userId])

  return (
    <div className="min-h-dvh pb-10">
      <TopBar left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}返回</IconButton>} />
      <main className="mx-auto max-w-2xl space-y-4 px-6">
        <PageTitle eyebrow="SYNC CONFLICTS" title="版本衝突" />
        <p className="text-sm text-sub">以下資料在這台裝置與其他裝置都被修改過。系統沒有自動覆蓋任何一邊，請逐筆選擇要保留的版本。</p>
        {list?.length === 0 && <p className="py-10 text-center text-sub">沒有待處理的衝突 👍</p>}
        {list?.map((c) => <ConflictCard key={c.key} c={c} />)}
      </main>
    </div>
  )
}
