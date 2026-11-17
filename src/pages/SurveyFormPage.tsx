import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { createSurvey, emptySurveyInput, updateSurvey, type SurveyInput } from '../db/repo'
import { useUserId } from '../auth/AuthProvider'
import { Button, ErrorBox, Field, Icon, IconButton, TextArea, TextInput, TopBar } from '../components/ui'
import { useToast } from '../components/Toast'

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function SurveyFormPage() {
  const { id } = useParams()
  const isNew = !id
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()
  const [form, setForm] = useState<SurveyInput | null>(isNew ? emptySurveyInput() : null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
        const newId = await createSurvey(userId, clean)
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

  return (
    <div className="min-h-dvh pb-28">
      <TopBar
        title={isNew ? '新增場勘' : '編輯場勘'}
        left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}</IconButton>}
      />
      {!form ? (
        <main className="mx-auto max-w-2xl p-4">{error ? <ErrorBox>{error}</ErrorBox> : <p className="text-slate-400">讀取中…</p>}</main>
      ) : (
        <form id="survey-form" onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500">客戶資料</h2>
            <Field label="客戶姓名">
              <TextInput required value={form.customer_name} onChange={set('customer_name')} placeholder="例如：王小明" />
            </Field>
            <Field label="聯絡電話" hint="選填">
              <TextInput type="tel" inputMode="tel" value={form.customer_phone ?? ''} onChange={set('customer_phone')} />
            </Field>
            <Field label="場勘日期">
              <TextInput type="date" value={form.survey_date ?? ''} onChange={set('survey_date')} />
            </Field>
            <Field label="客戶地址" hint="選填">
              <TextInput value={form.customer_address ?? ''} onChange={set('customer_address')} />
            </Field>
          </section>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500">預計安裝產品</h2>
            <Field label="產品型號">
              <TextInput value={form.product_model ?? ''} onChange={set('product_model')} placeholder="例如：WD-S19VDW" />
            </Field>
            <Field label="備註">
              <TextArea value={form.notes ?? ''} onChange={set('notes')} />
            </Field>
          </section>
          <ErrorBox>{error}</ErrorBox>
        </form>
      )}
      {form && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <Button type="submit" form="survey-form" disabled={busy} className="h-14 w-full text-lg">
              {busy ? '儲存中…' : isNew ? '建立場勘' : '儲存修改'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
