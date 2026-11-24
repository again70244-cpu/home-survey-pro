import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { requestPersistentStorage } from './db/db'
import { initPwa } from './lib/pwa'
import { initPressFeedback } from './lib/motion'
import './index.css'

initPwa()
initPressFeedback()
requestPersistentStorage()
// 舊版產品圖片快取可能存了 imgbb 逾時時的錯誤圖（看不到真實狀態也照存），直接清掉，改用只存成功圖片的新快取
if ('caches' in window) void caches.delete('product-images').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
