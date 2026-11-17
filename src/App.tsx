import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { isSupabaseConfigured } from './lib/supabase'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupNeededPage, SignupPage } from './pages/AuthPages'
import { HomePage } from './pages/HomePage'
import { SurveyFormPage } from './pages/SurveyFormPage'
import { SurveyDetailPage } from './pages/SurveyDetailPage'
import { ToastProvider } from './components/Toast'
import { ConflictsPage } from './pages/ConflictsPage'
import { useEffect } from 'react'
import { startSync } from './sync/engine'

function AppRoutes() {
  const { loading, session, recovery } = useAuth()
  const userId = session?.user.id
  useEffect(() => (userId ? startSync(userId) : undefined), [userId])
  if (loading)
    return <div className="flex min-h-dvh items-center justify-center text-slate-400">載入中…</div>

  if (recovery) return <ResetPasswordPage />

  if (!session)
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/survey/new" element={<SurveyFormPage />} />
      <Route path="/survey/:id" element={<SurveyDetailPage />} />
      <Route path="/survey/:id/edit" element={<SurveyFormPage />} />
      <Route path="/conflicts" element={<ConflictsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeededPage />
  return (
    <AuthProvider>
      <ToastProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
