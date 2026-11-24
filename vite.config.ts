import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署在 /<repo>/ 之下；用 BASE_PATH 環境變數設定
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '家電場勘助手 Pro',
        short_name: '場勘助手',
        description: '家電現場尺寸測量、拍照與場勘報告',
        lang: 'zh-Hant-TW',
        theme_color: '#090c13',
        background_color: '#090c13',
        display: 'standalone',
        start_url: base,
        scope: base,
        orientation: 'portrait',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Google 字型：第一次載入後快取，離線也能顯示同樣字體
        runtimeCaching: [
          {
            // 產品圖片（Google Sheets 中的圖片網址）：看過一次即可離線顯示
            // 圖片以 CORS 方式載入（imgbb 允許），只快取確定成功（200）的回應；
            // 不快取 status 0（看不到真實狀態，曾把 imgbb 逾時時的錯誤圖存起來一直顯示）
            urlPattern: /^https:\/\/i\.ibb\.co\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'product-images-v2', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
