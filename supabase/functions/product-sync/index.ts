// Supabase Edge Function 進入點（Deno）。邏輯在 handler.ts。
// 部署時需關閉 JWT 驗證（verify_jwt = false）：來源驗證改由 HMAC 簽章負責，一般使用者的 JWT 不被接受。
import { handle } from './handler.ts'

Deno.serve((req) =>
  handle(req, {
    PRODUCT_SYNC_SECRET: Deno.env.get('PRODUCT_SYNC_SECRET'),
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }),
)
