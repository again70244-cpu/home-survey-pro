// 把 product-sync Edge Function 打包成單一檔案（方便在 Supabase 網頁編輯器直接貼上部署）
import { build } from 'esbuild'

export const BANNER = `// product-sync Edge Function（單檔版，由 npm run bundle:sync 產生；請勿手動修改）
// 部署：Supabase → Edge Functions → Deploy a new function → Via Editor → 名稱 product-sync → 全部貼上 → Deploy
// 部署後務必關閉 Enforce JWT verification（來源驗證改用 HMAC 簽章，一般使用者 JWT 不被接受）`

export async function bundle(write = true) {
  const r = await build({
    entryPoints: ['supabase/functions/product-sync/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    banner: { js: BANNER },
    write,
    outfile: 'supabase/functions/product-sync/dist/product-sync.bundle.ts',
  })
  return write ? null : r.outputFiles[0].text
}

if (import.meta.url === `file://${process.argv[1]}`) await bundle(true)
