import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useUserId } from '../auth/AuthProvider'
import { surveySummary } from '../lib/completeness'
import { AreaList, CompletenessCard, useHasFieldMode } from '../components/AreaList'
import { SurveyProducts } from '../components/SurveyProducts'
import { TemplateChecks } from '../components/TemplateCheck'
import { FieldCards } from '../components/FieldCard'
import { BottomBar, Button, Icon, IconButton, PageTitle, TextButton, TopBar } from '../components/ui'
import { SyncStatusBar } from '../components/SyncStatusBar'

/** 「產品與資料」展開狀態：同一筆場勘在這次開啟 App 期間記住 */
function useMoreOpen(id: string) {
  const key = `hsp-more-${id}`
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(key) === '1' } catch { return false } })
  const set = (v: boolean) => { setOpen(v); try { sessionStorage.setItem(key, v ? '1' : '0') } catch { /* 無法儲存時只影響記憶 */ } }
  return [open, set] as const
}

export function SurveyDetailPage() {
  const { id } = useParams()
  const userId = useUserId()
  const nav = useNavigate()
  const fieldMode = useHasFieldMode(id!)
  const [more, setMore] = useMoreOpen(id!)

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
    const products = (await db.survey_products.where('survey_id').equals(id!).toArray()).filter((p) => !p.deleted_at)
    return { survey, areas, conflict, products, sum: surveySummary(areas, photos, !!survey._dirty) }
  }, [id, userId])

  if (data === undefined) return null
  if (data === null)
    return (
      <div className="min-h-dvh">
        <TopBar title="場勘" left={<IconButton label="返回" onClick={() => nav('/')}>{Icon.back}</IconButton>} />
        <p className="p-8 text-center text-sub">這筆場勘不存在或已刪除</p>
      </div>
    )

  const { survey: s, conflict, sum, products } = data

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
              {s.customer_phone && <a href={`tel:${s.customer_phone.replace(/[^\d+]/g, '')}`} className="text-accent underline-offset-4 active:underline" aria-label={`撥打 ${s.customer_phone}`}>📞 {s.customer_phone}</a>}
              {s.customer_address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.customer_address)}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent underline-offset-4 active:underline" aria-label={`地圖 ${s.customer_address}`}>📍 {s.customer_address}</a>}
              <SyncStatusBar compact />
            </>
          }
        />
        <div className="space-y-2 pb-4">
          <SyncStatusBar alertsOnly />
          {conflict && <p className="text-sm text-red-700">此場勘有版本衝突待處理</p>}
          {s.notes && <p className="whitespace-pre-wrap break-words text-[14px] text-ink/75" aria-label="場勘備註">{s.notes}</p>}
        </div>
        {fieldMode ? (
          <>
            <FieldCards surveyId={s.id} />
            <TemplateChecks surveyId={s.id} show="active" />
            {/* 不常用的：產品規格、區域列表、其他檢查 → 收在一起 */}
            <section className="glass-card my-3" aria-label="產品與資料">
              <button
                type="button"
                onClick={() => setMore(!more)}
                aria-expanded={more}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] text-ink">產品與資料</span>
                  <span className="mt-0.5 block truncate text-[13px] text-sub">
                    {[products.map((p) => p.model_code).join('、') || '未選產品', `區域 ${sum.areas.length}`, `照片 ${sum.areas.reduce((n, a) => n + a.photos, 0)} 張`].join('・')}
                  </span>
                </span>
                <span className={`shrink-0 text-sub transition duration-500 ${more ? 'rotate-90' : ''}`} aria-hidden>{Icon.chevron}</span>
              </button>
              {more && (
                <div className="hsp-reveal border-t border-line px-5 pb-5 pt-3">
                  <SurveyProducts surveyId={s.id} bare />
                  <AreaList surveyId={s.id} sum={sum} />
                  <TemplateChecks surveyId={s.id} show="inactive" />
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <CompletenessCard sum={sum} />
            <SurveyProducts surveyId={s.id} />
            <AreaList surveyId={s.id} sum={sum} />
            <TemplateChecks surveyId={s.id} show="inactive" />
          </>
        )}
      </main>
      <BottomBar>
        <Button className="h-14 w-full" onClick={() => nav(`/survey/${s.id}/report`)}>
          產生場勘報告
        </Button>
      </BottomBar>
    </div>
  )
}
