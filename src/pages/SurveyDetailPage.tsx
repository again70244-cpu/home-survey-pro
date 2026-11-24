import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { deleteSurvey } from '../db/repo'
import { useUserId } from '../auth/AuthProvider'
import { formatDate } from '../lib/format'
import { surveySummary } from '../lib/completeness'
import { AreaList, CompletenessCard } from '../components/AreaList'
import { SurveyProducts } from '../components/SurveyProducts'
import { TemplateChecks } from '../components/TemplateCheck'
import { FieldCards } from '../components/FieldCard'
import { BottomBar, Button, Card, Icon, IconButton, PageTitle, SectionLabel, TextButton, TopBar } from '../components/ui'
import { RowSync } from '../components/SyncBadge'
import { SyncStatusBar } from '../components/SyncStatusBar'
import { useToast } from '../components/Toast'

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-4 border-b border-line py-3">
      <dt className="w-20 shrink-0 text-[13px] text-sub">{label}</dt>
      <dd className={`flex-1 whitespace-pre-wrap break-words text-[15px] ${value ? 'text-ink' : 'text-ink/40'}`}>{value || '未填寫'}</dd>
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
    const conflict = (await db.conflicts.where('userId').equals(userId).toArray()).some(
      (c) => c.rowId === survey.id || c.local.survey_id === survey.id,
    )
    const photos = await db.survey_photos.where('survey_id').equals(id!).toArray()
    return { survey, areas, conflict, sum: surveySummary(areas, photos, !!survey._dirty) }
  }, [id, userId])

  if (data === undefined) return null
  if (data === null)
    return (
      <div className="min-h-dvh">
        <TopBar title="場勘" left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}</IconButton>} />
        <p className="p-8 text-center text-sub">這筆場勘不存在或已刪除</p>
      </div>
    )

  const { survey: s, conflict, sum } = data

  async function onDelete() {
    if (!confirm(`確定要刪除「${s.customer_name}」的場勘紀錄？\n所有區域與照片都會一起刪除，其他裝置同步後也會刪除。`)) return
    await deleteSurvey(s.id)
    toast('已刪除')
    nav('/', { replace: true })
  }

  const d = s.survey_date ? s.survey_date.slice(5).replace('-', '.') : ''
  return (
    <div className="min-h-dvh pb-28">
      <TopBar
        left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}紀錄</IconButton>}
        right={<TextButton onClick={() => nav(`/survey/${s.id}/edit`)} aria-label="編輯">編輯</TextButton>}
      />
      <main className="mx-auto max-w-2xl px-6">
        <PageTitle
          eyebrow={`SITE SURVEY${d ? ` ・ ${d}` : ''}`}
          title={s.customer_name || '（未填姓名）'}
          meta={
            <>
              <span>{s.product_model || '未填型號'}</span>
              <span>{sum.completeAreas} / {sum.areas.length} 區完成</span>
              <SyncStatusBar compact />
            </>
          }
        />
        <div className="space-y-2 pb-4">
          <SyncStatusBar alertsOnly />
          {conflict && <p className="text-sm text-red-700">此場勘有版本衝突待處理</p>}
        </div>
        <FieldCards surveyId={s.id} />
        <CompletenessCard sum={sum} />
        <SurveyProducts surveyId={s.id} />
        <TemplateChecks surveyId={s.id} />
        <AreaList surveyId={s.id} sum={sum} />
        <Card className="mt-6">
          <SectionLabel right={<RowSync row={s} hasConflict={conflict} />}>場勘資料</SectionLabel>
          <dl className="border-t border-ink">
            <Row label="客戶姓名" value={s.customer_name} />
            <Row label="聯絡電話" value={s.customer_phone} />
            <Row label="場勘日期" value={formatDate(s.survey_date)} />
            <Row label="客戶地址" value={s.customer_address} />
            <Row label="產品型號" value={s.product_model} />
            <Row label="備註" value={s.notes} />
          </dl>
          <Link to={`/survey/${s.id}/edit`} className="mt-4 block">
            <Button variant="secondary" className="w-full">編輯場勘資料</Button>
          </Link>
        </Card>
        <div className="pb-8">
          <button onClick={onDelete} className="glass h-12 w-full rounded-full text-sm text-red-700">
            刪除這筆場勘
          </button>
        </div>
      </main>
      <BottomBar>
        <Button className="h-14 w-full" onClick={() => nav(`/survey/${s.id}/report`)}>
          產生場勘報告
        </Button>
      </BottomBar>
    </div>
  )
}
