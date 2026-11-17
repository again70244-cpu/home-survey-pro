import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('xxxxxxxx'))

/**
 * 前端只使用 anon / publishable key。資料保護完全依靠資料庫的 RLS。
 * service_role key 絕不可出現在前端。
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/** 寄信連結要導回的網址（GitHub Pages 子路徑也適用） */
export function appUrl(query = ''): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${query}`
}

/** Supabase 英文錯誤轉成中文提示 */
export function authErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const map: [RegExp, string][] = [
    [/invalid login credentials/i, 'Email 或密碼錯誤'],
    [/email not confirmed/i, '尚未完成 Email 驗證，請先到信箱點擊驗證連結'],
    [/user already registered/i, '這個 Email 已經註冊過，請直接登入'],
    [/password should be at least/i, '密碼長度不足（至少 8 碼）'],
    [/rate limit|too many/i, '操作太頻繁，請稍後再試'],
    [/failed to fetch|network/i, '無法連線到伺服器，請確認網路'],
    [/same.*password|different from the old/i, '新密碼不能與舊密碼相同'],
    [/code verifier|auth session missing|invalid.*(flow|grant)/i, '連結已失效或需要在送出申請的同一個瀏覽器開啟，請重新申請'],
  ]
  for (const [re, zh] of map) if (re.test(msg)) return zh
  return msg
}
