import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { isSupabaseConfigured } from './lib/supabase'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupNeededPage, SignupPage } from './pages/AuthPages'
import { HomePage } from './pages/HomePage'
import { SurveyFormPage } from './pages/SurveyFormPage'
import { SurveyDetailPage } from './pages/SurveyDetailPage'
import { ToastProvider } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'
import { ConflictsPage } from './pages/ConflictsPage'
import { AreaPage } from './pages/AreaPage'
import { ReportPage } from './pages/ReportPage'
import { SettingsPage } from './pages/SettingsPage'
import { CatalogPage } from './pages/CatalogPage'
import { CatalogProductPage } from './pages/CatalogProductPage'
import { MultiSplitPage } from './pages/MultiSplitPage'
import { startCatalogSync } from './catalog/catalogSync'
import { useEffect } from 'react'
import { startSync } from './sync/engine'

/** 換頁時回到頁面頂端 */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function AppRoutes() {
  const { loading, session, recovery } = useAuth()
  const userId = session?.user.id
  useEffect(() => (userId ? startSync(userId) : undefined), [userId])
  useEffect(() => (userId ? startCatalogSync() : undefined), [userId])
  if (loading)
    return <div className="flex min-h-dvh items-center justify-center text-sub">載入中…</div>

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
      <Route path="/survey/:id/area/:areaId" element={<AreaPage />} />
      <Route path="/survey/:id/report" element={<ReportPage />} />
      <Route path="/conflicts" element={<ConflictsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/catalog/multi-split" element={<MultiSplitPage />} />
      <Route path="/catalog/:productId" element={<CatalogProductPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeededPage />
  return (
    <AuthProvider>
      <ToastProvider>
        <UpdateBanner />
        <HashRouter>
          <ScrollToTop />
          <AppRoutes />
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
