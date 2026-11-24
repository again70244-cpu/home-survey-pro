import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { Icon, IconButton, PageTitle, TopBar } from '../components/ui'

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function MultiSplitPage() {
  const nav = useNavigate()
  const systems = useLiveQuery(() => db.catalog_systems.toArray().then((s) => s.filter((x) => x.is_active)), [])
  return (
    <div className="min-h-dvh pb-12">
      <TopBar left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}產品</IconButton>} />
      <main className="mx-auto max-w-2xl px-6">
        <PageTitle eyebrow="MULTI-SPLIT" title="一對多冷氣搭配" />
        {systems?.length === 0 && <p className="py-10 text-center text-sub">尚未下載一對多搭配資料</p>}
        {systems?.map((s) => (
          <section key={s.id} className="glass-card my-3 p-5" aria-label={`室外機 ${s.model_code}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-2xl font-light">{s.model_code}</h2>
              <span className="text-sm text-[#555]">{s.capacity_kw ? `${s.capacity_kw} KW` : ''}</span>
            </div>
            <div className="mt-1 text-[13px] text-sub">{s.indoor_counts.map((n) => `一對${CN[n] ?? n}`).join('、') || '未標示搭配方式'}</div>

            <h3 className="mb-1 mt-4 text-[11px] tracking-[0.16em] text-sub">可搭配室內機（{s.indoor_units.length}）</h3>
            <ul className="border-t border-line">
              {s.indoor_units.map((u) => (
                <li key={u.position} className="flex justify-between border-b border-line py-2 text-[15px]">
                  <span>{u.model_code}</span>
                  <span className="text-[#555]">{[u.series, u.capacity_kw ? `${u.capacity_kw}KW` : ''].filter(Boolean).join(' ')}</span>
                </li>
              ))}
            </ul>

            {s.rules.length > 0 && (
              <>
                <h3 className="mb-1 mt-4 text-[11px] tracking-[0.16em] text-sub">容量規則</h3>
                <ul className="space-y-1.5 text-[14px]">
                  {s.rules.map((r, i) => (
                    <li key={i} className="bg-sand px-3 py-2">
                      <b className="font-medium">{r.indoor_count ? `一對${CN[r.indoor_count] ?? r.indoor_count}` : '全部搭配方式'}</b>
                      ：單台室內機 {r.unit_min_kw}～{r.unit_max_kw} KW
                      {r.total_min_kw !== null || r.total_max_kw !== null ? `；室內機合計 ${r.total_min_kw ?? '—'}～${r.total_max_kw ?? '—'} KW` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {s.notes && <p className="mt-3 whitespace-pre-wrap text-xs text-sub">原文備註：{s.notes}</p>}
            {s.issues.length > 0 && <p className="mt-2 text-xs text-red-700">待確認：{s.issues.join('；')}</p>}
          </section>
        ))}
      </main>
    </div>
  )
}
