import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { appUrl, authErrorMessage, supabase } from '../lib/supabase'
import { Button, Card, ErrorBox, Field, InfoBox, TextInput } from '../components/ui'
import { useAuth } from '../auth/AuthProvider'

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center text-center">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mb-3 h-14 w-14" />
        <div className="text-sm font-medium tracking-wide text-brand-600">家電場勘助手 Pro</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <Card className="w-full max-w-sm p-5">{children}</Card>
    </div>
  )
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(authErrorMessage(error))
  }

  return (
    <AuthLayout title="登入" subtitle="登入後即可在手機、平板、電腦同步場勘紀錄">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密碼">
          <TextInput type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy} className="w-full">{busy ? '登入中…' : '登入'}</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/forgot" className="text-slate-500 underline-offset-2 hover:underline">忘記密碼？</Link>
        <Link to="/signup" className="font-medium text-brand-600">建立新帳號</Link>
      </div>
    </AuthLayout>
  )
}

export function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('密碼至少需要 8 碼')
    if (password !== confirm) return setError('兩次輸入的密碼不一致')
    setBusy(true)
    const { data, error } = await supabase!.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: appUrl() },
    })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
    // 若專案關閉 Email 驗證，會直接取得 session 並自動登入
    if (!data.session) setDone(true)
  }

  if (done)
    return (
      <AuthLayout title="請到信箱完成驗證">
        <InfoBox>
          驗證信已寄到 <b>{email}</b>。請用<b>這支手機的同一個瀏覽器</b>開啟信中的連結，完成後就會自動登入。
        </InfoBox>
        <Link to="/login" className="mt-4 block text-center text-sm text-brand-600">回到登入</Link>
      </AuthLayout>
    )

  return (
    <AuthLayout title="建立帳號">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密碼" hint="至少 8 碼">
          <TextInput type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="再次輸入密碼">
          <TextInput type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy} className="w-full">{busy ? '建立中…' : '註冊'}</Button>
      </form>
      <Link to="/login" className="mt-4 block text-center text-sm text-slate-500">已有帳號？登入</Link>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('?reset=1') })
    setBusy(false)
    if (error) setError(authErrorMessage(error))
    else setSent(true)
  }

  return (
    <AuthLayout title="忘記密碼" subtitle="輸入註冊的 Email，我們會寄送重設密碼連結">
      {sent ? (
        <InfoBox>
          若 <b>{email}</b> 已註冊，重設連結已寄出。請用<b>同一個瀏覽器</b>開啟信中的連結。
        </InfoBox>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" disabled={busy} className="w-full">{busy ? '寄送中…' : '寄送重設連結'}</Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-center text-sm text-slate-500">回到登入</Link>
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const { session, clearRecovery } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('密碼至少需要 8 碼')
    if (password !== confirm) return setError('兩次輸入的密碼不一致')
    setBusy(true)
    const { error } = await supabase!.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
    clearRecovery()
    nav('/', { replace: true })
  }

  if (!session)
    return (
      <AuthLayout title="重設密碼">
        <ErrorBox>重設連結已失效，或不是在送出申請的同一個瀏覽器開啟。請重新申請一次。</ErrorBox>
        <Link to="/forgot" onClick={clearRecovery} className="mt-4 block text-center text-sm text-brand-600">重新申請</Link>
      </AuthLayout>
    )

  return (
    <AuthLayout title="設定新密碼" subtitle={session.user.email}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="新密碼" hint="至少 8 碼">
          <TextInput type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="再次輸入新密碼">
          <TextInput type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy} className="w-full">{busy ? '更新中…' : '更新密碼'}</Button>
      </form>
    </AuthLayout>
  )
}

export function SetupNeededPage() {
  return (
    <AuthLayout title="尚未設定雲端服務">
      <div className="space-y-3 text-sm text-slate-600">
        <p>這個版本還沒有填入 Supabase 連線資訊，所以無法登入。</p>
        <p>
          請在專案根目錄建立 <code className="rounded bg-slate-100 px-1">.env.local</code>，填入
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> 與
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code>，或在 GitHub 設定 Repository Variables 後重新部署。
        </p>
        <p>詳細步驟請見 docs/SETUP.md。</p>
      </div>
    </AuthLayout>
  )
}
