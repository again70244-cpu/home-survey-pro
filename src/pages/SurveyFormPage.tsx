import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { addSurveyProduct, createSurvey, deleteSurvey, emptySurveyInput, updateSurvey, type SurveyInput } from '../db/repo'
import { autoTemplate } from '../rules/common'
import { ProductPicker } from '../components/ProductPicker'
import type { CatalogProduct } from '../catalog/types'
import { useUserId } from '../auth/AuthProvider'
import { Button, ErrorBox, Field, Icon, IconButton, TextArea, TextInput, TopBar, PageTitle } from '../components/ui'
import { useToast } from '../components/Toast'

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function SurveyFormPage() {
  const { id } = useParams()
  const isNew = !id
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState<SurveyInput | null>(isNew ? emptySurveyInput() : null)
  const [picked, setPicked] = useState<CatalogProduct[]>([])
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 新增時：電話、地址、日期、型號、備註收起來，只留姓名與產品
  const [more, setMore] = useState(!isNew)

  useEffect(() => {
    if (isNew) return
    db.surveys.get(id!).then((s) => {
      if (!s || s.user_id !== userId || s.deleted_at) return setError('找不到這筆場勘')
      setForm({
        customer_name: s.customer_name,
        customer_phone: s.customer_phone,
        survey_date: s.survey_date,
        customer_address: s.customer_address,
        product: s.product,
        product_model: s.product_model,
        notes: s.notes,
      })
    })
  }, [id, isNew, userId])

  // 輸入過程保留原字串（含空白），送出時才整理
  const set = (k: keyof SurveyInput) => (e: { target: { value: string } }) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.customer_name.trim()) return setError('請填寫客戶姓名')
    setBusy(true)
    setError('')
    try {
      const clean: SurveyInput = {
        customer_name: form.customer_name.trim(),
        customer_phone: blankToNull(form.customer_phone ?? ''),
        survey_date: form.survey_date || null,
        customer_address: blankToNull(form.customer_address ?? ''),
        product: blankToNull(form.product ?? ''),
        product_model: blankToNull(form.product_model ?? ''),
        notes: blankToNull(form.notes ?? ''),
      }
      if (isNew) {
        // 有洗衣機／冰箱等現場拍攝的產品：不預先建立陽台／電梯／樓梯，由現場拍攝依需要建立
        const fieldMode = picked.some((p) => autoTemplate(p.category))
        const newId = await createSurvey(userId, clean, { defaultAreas: !fieldMode })
        for (const p of picked) await addSurveyProduct(newId, p) // 選擇的產品：保存當下規格快照
        toast('已儲存到本機')
        nav(`/survey/${newId}`, { replace: true })
      } else {
        await updateSurvey(id!, clean)
        toast('已儲存到本機')
        nav(-1)
      }
    } catch (err) {
      setError(`儲存失敗：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!form) return
    if (!confirm(`確定要刪除「${form.customer_name}」的場勘紀錄？\n所有區域與照片都會一起刪除，其他裝置同步後也會刪除。`)) return
    await deleteSurvey(id!)
    toast('已刪除')
    nav('/', { replace: true })
  }

  return (
    <div className="min-h-dvh pb-28">
      <TopBar
        left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}返回</IconButton>}
      />
      {!form ? (
        <main className="mx-auto max-w-2xl px-6">{error ? <ErrorBox>{error}</ErrorBox> : <p className="text-sub">讀取中…</p>}</main>
      ) : (
        <form id="survey-form" onSubmit={submit} className="mx-auto max-w-2xl px-6">
          <PageTitle eyebrow={isNew ? 'NEW SURVEY' : 'EDIT SURVEY'} title={isNew ? '新增場勘' : '編輯場勘'} />
          <section className="glass-card space-y-5 p-5">
            <Field label="客戶姓名">
              <TextInput required value={form.customer_name} onChange={set('customer_name')} placeholder="例如：王小明" />
            </Field>
            {isNew && (
              <div>
                <div className="mb-2 text-[13px] text-ink">安裝產品</div>
                {picked.length > 0 && (
                  <ul className="mb-3 border-t border-line" aria-label="已選擇的產品">
                    {picked.map((p) => (
                      <li key={p.id} className="flex items-center justify-between border-b border-line py-2.5">
                        <span className="min-w-0">
                          <span className="block text-[16px]">{p.model_code}</span>
                          <span className="block truncate text-xs text-sub">{p.width_cm != null ? `寬 ${p.width_cm}・高 ${p.height_cm ?? '—'}・深 ${p.depth_cm ?? '—'} cm` : '試算表未提供安裝尺寸'}</span>
                        </span>
                        <button type="button" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] shrink-0 text-red-700" aria-label={`取消選擇 ${p.model_code}`}>取消</button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button type="button" variant="secondary" className="w-full" onClick={() => setPicking(true)}>{Icon.plus} 從 LG 產品知識庫選擇</Button>
              </div>
            )}
            {!more && (
              <button type="button" onClick={() => setMore(true)} className="flex h-11 w-full items-center gap-1.5 text-[14px] text-sub" aria-expanded={false}>
                {Icon.plus} 電話、地址、日期、備註
              </button>
            )}
            {more && (
              <div className={`space-y-5 ${isNew ? 'hsp-reveal' : ''}`}>
                <Field label="聯絡電話" hint="選填">
                  <TextInput type="tel" inputMode="tel" value={form.customer_phone ?? ''} onChange={set('customer_phone')} />
                </Field>
                <Field label="客戶地址" hint="選填">
                  <TextInput value={form.customer_address ?? ''} onChange={set('customer_address')} />
                </Field>
                <Field label="場勘日期">
                  <TextInput type="date" value={form.survey_date ?? ''} onChange={set('survey_date')} />
                </Field>
                <Field label="產品型號" hint="型錄找不到時手動輸入">
                  <TextInput value={form.product_model ?? ''} onChange={set('product_model')} placeholder="例如：WD-S19VDW" />
                </Field>
                <Field label="備註">
                  <TextArea value={form.notes ?? ''} onChange={set('notes')} />
                </Field>
              </div>
            )}
          </section>
          {!isNew && (
            <button type="button" onClick={() => void onDelete()} className="glass mt-8 h-12 w-full rounded-full text-sm text-red-700">
              刪除這筆場勘
            </button>
          )}
          <ErrorBox>{error}</ErrorBox>
        </form>
      )}
      {form && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <div className="pointer-events-auto mx-auto max-w-2xl">
            <Button type="submit" form="survey-form" disabled={busy} className="h-14 w-full">
              {busy ? '儲存中…' : isNew ? '建立場勘' : '儲存修改'}
            </Button>
          </div>
        </div>
      )}
      {picking && (
        <ProductPicker
          selected={picked.map((p) => p.id)}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicked((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))
            setForm((f) => (f && !f.product_model?.trim() ? { ...f, product_model: p.model_code } : f))
          }}
        />
      )}
    </div>
  )
}
