# 端對端測試（Playwright，對真實 Supabase 執行）

需要先建置測試版並啟動本機伺服器：

```bash
export HSP_ANON_KEY=...        # Supabase publishable key
export HSP_TEST_A_PW=...       # 測試帳號 hsp-test-a@example.com 的密碼
export HSP_TEST_B_PW=...       # 測試帳號 hsp-test-b@example.com 的密碼
VITE_SUPABASE_URL=https://kmcnowfjzrppntgktyjq.supabase.co VITE_SUPABASE_ANON_KEY=$HSP_ANON_KEY \
  npx vite build --minify false --outDir /tmp/hsp-e2e/dist-s2
(cd /tmp/hsp-e2e/dist-s2 && python3 -m http.server 4174 &)
node tests/e2e/sync.cjs /tmp/hsp-e2e     # 參數 = 存放截圖、測試照片的工作資料夾
```

| 檔案 | 內容 |
|---|---|
| sync.cjs | 跨裝置同步、離線、衝突、刪除、帳號隔離（RLS） |
| areas.cjs | 場勘頁直接輸入尺寸、照片、區域管理 |
| photos.cjs | 照片壓縮、私有 Storage、上傳失敗重試 |
| offline.cjs | 完全離線開啟 App、背景下載照片 |
| report.cjs | 多頁 PNG 報告、分享、ZIP |
| backup.cjs | 備份、還原、不重複匯入、跨帳號還原 |
| catalog.cjs | 產品知識庫搜尋、詳細、一對多、離線、同步失敗（使用 catalog-fixtures.mts 產生的測試資料） |
| upgrade.cjs | 從上一版 App 升級：本機資料與未同步資料保留 |

測試照片：`<工作資料夾>/photos/p1.jpg…`（任意 JPEG 即可）。測試帳號與密碼不得提交到程式庫。
