import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  loading: boolean
  session: Session | null
  user: User | null
  /** 從重設密碼信件連結進入 */
  recovery: boolean
  clearRecovery: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [recovery, setRecovery] = useState(() => new URLSearchParams(location.search).has('reset'))

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      setLoading(false)
    })
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      // 清掉網址上的 ?code=... 等參數（保留 hash 路由）
      if (location.search) history.replaceState(null, '', location.pathname + location.hash)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{ loading, session, user: session?.user ?? null, recovery, clearRecovery: () => setRecovery(false) }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}

/** 目前使用者 ID（已登入才會有） */
export function useUserId(): string {
  const { user } = useAuth()
  if (!user) throw new Error('尚未登入')
  return user.id
}
