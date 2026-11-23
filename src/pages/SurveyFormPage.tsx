import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { addSurveyProduct, createSurvey, emptySurveyInput, updateSurvey, type SurveyInput } from '../db/repo'
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
          <section className="space-y-5 border-t border-ink py-6">
            <h2 className="text-xs font-medium tracking-[0.18em] text-sub">客戶資料</h2>
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
          <section className="space-y-5 border-t border-line py-6">
            <h2 className="text-xs font-medium tracking-[0.18em] text-sub">預計安裝產品</h2>
            {isNew && (
              <div>
                {picked.length > 0 && (
                  <ul className="mb-3 border-t border-ink" aria-label="已選擇的產品">
                    {picked.map((p) => (
                      <li key={p.id} className="flex items-center justify-between border-b border-line py-2.5">
                        <span className="min-w-0">
                          <span className="block text-[16px]">{p.model_code}</span>
                          <span className="block truncate text-xs text-sub">{p.width_cm != null ? `寬 ${p.width_cm}・高 ${p.height_cm ?? '—'}・深 ${p.depth_cm ?? '—'} cm` : '試算表未提供安裝尺寸'}</span>
                        </span>
                        <button type="button" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="h-9 shrink-0 px-1 text-[13px] text-red-700 underline underline-offset-4" aria-label={`取消選擇 ${p.model_code}`}>取消</button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button type="button" variant="secondary" className="w-full" onClick={() => setPicking(true)}>{Icon.plus} 從 LG 產品知識庫選擇</Button>
                <p className="mt-1.5 text-xs text-sub">選擇後會自動帶入安裝規格並保存在這筆場勘中</p>
              </div>
            )}
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
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
          <div className="mx-auto max-w-2xl">
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
