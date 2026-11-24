import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { templateRowId } from '../db/repo'
import { TEMPLATES, type TemplateDef } from '../templates'
import { allStepStatus, loadField } from '../pages/FieldPage'
import { Icon } from './ui'

const RING = 2 * Math.PI * 28

/** 場勘頁最上方：現場拍攝進度與「開始／繼續」按鈕（只在該模板已啟用時顯示） */
function FieldCard({ def, surveyId }: { def: TemplateDef; surveyId: string }) {
  const nav = useNavigate()
  const [tplId, setTplId] = useState<string | null>(null)
  useEffect(() => void templateRowId(surveyId, def.id).then(setTplId), [surveyId, def.id])
  const data = useLiveQuery(() => (tplId ? loadField(def, surveyId, tplId) : undefined), [def, surveyId, tplId])
  if (!data?.active) return null
  const st = allStepStatus(def, data)
  const done = st.filter((s) => s.done).length
  const total = def.steps.length
  const nextIdx = st.findIndex((s) => !s.done)
  const next = nextIdx >= 0 ? def.steps[nextIdx] : null
  const noPhoto = st.filter((s) => s.photoMissing).length
  const shortTitle = def.title.replace('現場檢查', '')
  return (
    <section className="glass-card my-3 p-5" aria-label={`${shortTitle}現場拍攝`}>
      <div className="flex items-center gap-4">
        {/* 進度圈：數值變化時平滑轉到新位置 */}
        <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0" role="img" aria-label={`進度 ${done} / ${total}`}>
          <circle cx="34" cy="34" r="28" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="6" />
          <circle
            cx="34" cy="34" r="28" fill="none" stroke="#67e8f9" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={RING} strokeDashoffset={RING * (1 - done / total)} transform="rotate(-90 34 34)"
            style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(.2,.8,.2,1)', filter: 'drop-shadow(0 0 6px rgb(103 232 249 / 0.7))', opacity: done ? 1 : 0 }}
          />
          <text x="34" y="39" textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="500">{done}/{total}</text>
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] tracking-[0.14em] text-sub">{next ? `${shortTitle}・下一步` : `${shortTitle}・現場拍攝`}</div>
          <div className="mt-0.5 text-[20px]" data-testid={`${def.id}-field-next`}>{next ? next.title : '全部完成'}</div>
          <div className="mt-0.5 truncate text-[13px] text-ink/75">{next ? next.hint : noPhoto ? `還有 ${noPhoto} 步沒拍照` : '量測與照片都完成了'}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => nav(`/survey/${surveyId}/field/${def.id}?step=${next ? nextIdx : 'done'}`)}
        className="glass-dark mt-4 flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full text-[17px] tracking-[0.06em]"
      >
        {Icon.camera}
        {done === 0 ? '開始現場拍攝' : next ? '繼續現場拍攝' : '檢視現場拍攝'}
      </button>
    </section>
  )
}

export function FieldCards({ surveyId }: { surveyId: string }) {
  return (
    <>
      {TEMPLATES.map((d) => (
        <FieldCard key={d.id} def={d} surveyId={surveyId} />
      ))}
    </>
  )
}
