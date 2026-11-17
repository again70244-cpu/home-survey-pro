import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { deleteSurvey } from '../db/repo'
import { useUserId } from '../auth/AuthProvider'
import { formatCm, formatDate } from '../lib/format'
import { Button, Card, Icon, IconButton, TopBar } from '../components/ui'
import { SyncBadge, rowSyncState } from '../components/SyncBadge'
import { useToast } from '../components/Toast'

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-20 shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className={`flex-1 break-words text-base ${value ? 'text-slate-900' : 'text-slate-400'}`}>{value || '未填寫'}</dd>
    </div>
  )
}

export function SurveyDetailPage() {
  const { id } = useParams()
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()

  const data = useLiveQuery(async () => {
    const survey = await db.surveys.get(id!)
    if (!survey || survey.user_id !== userId || survey.deleted_at) return null
    const areas = (await db.survey_areas.where('survey_id').equals(id!).toArray())
      .filter((a) => !a.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order)
    return { survey, areas }
  }, [id, userId])

  if (data === undefined) return null
  if (data === null)
    return (
      <div className="min-h-dvh">
        <TopBar title="場勘" left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}</IconButton>} />
        <p className="p-8 text-center text-slate-500">這筆場勘不存在或已刪除</p>
      </div>
    )

  const { survey: s, areas } = data

  async function onDelete() {
    if (!confirm(`確定要刪除「${s.customer_name}」的場勘紀錄？\n所有區域與照片都會一起刪除，其他裝置同步後也會刪除。`)) return
    await deleteSurvey(s.id)
    toast('已刪除')
    nav('/', { replace: true })
  }

  return (
    <div className="min-h-dvh pb-10">
      <TopBar
        title={s.customer_name || '場勘'}
        left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}</IconButton>}
        right={
          <IconButton label="編輯" onClick={() => nav(`/survey/${s.id}/edit`)}>
            {Icon.edit}
          </IconButton>
        }
      />
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500">場勘資料</h2>
            <SyncBadge state={rowSyncState(s)} />
          </div>
          <dl className="divide-y divide-slate-100">
            <Row label="客戶姓名" value={s.customer_name} />
            <Row label="聯絡電話" value={s.customer_phone} />
            <Row label="場勘日期" value={formatDate(s.survey_date)} />
            <Row label="客戶地址" value={s.customer_address} />
            <Row label="安裝產品" value={s.product} />
            <Row label="產品型號" value={s.product_model} />
            <Row label="備註" value={s.notes} />
          </dl>
          <Link to={`/survey/${s.id}/edit`} className="mt-3 block">
            <Button variant="secondary" className="w-full">{Icon.edit} 編輯場勘資料</Button>
          </Link>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500">場勘區域</h2>
          <p className="mb-3 text-xs text-slate-400">尺寸輸入、拍照與區域管理將在第三、四階段開放</p>
          <ul className="divide-y divide-slate-100">
            {areas.map((a) => (
              <li key={a.id} className="py-3">
                <div className="font-medium text-slate-900">{a.name}</div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
                  {(['寬', '深', '高'] as const).map((l, i) => {
                    const v = [a.width_cm, a.depth_cm, a.height_cm][i]
                    return (
                      <div key={l} className={v === null ? 'text-slate-400' : 'text-slate-800'}>
                        {l} {formatCm(v)}
                      </div>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Button variant="danger" className="w-full" onClick={onDelete}>
          刪除這筆場勘
        </Button>
      </main>
    </div>
  )
}
