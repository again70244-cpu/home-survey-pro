# 家電場勘助手 Pro

家電銷售人員的現場場勘工具：尺寸測量、拍照、離線保存、雲端同步、產生多頁場勘報告圖片。

* 架構：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
* 設定步驟：[docs/SETUP.md](docs/SETUP.md)
* 資料庫：[supabase/migrations](supabase/migrations)
* RLS 測試：`supabase/tests/`（在本機 Postgres 先執行 supabase_stub.sql、migration，再執行 rls_test.sql）

## 開發進度
- [x] 第一階段：專案、登入系統、首頁、場勘基本 UI
- [x] 第二階段：Supabase 雲端同步
- [x] 第三階段：尺寸紀錄與區域管理
- [x] 第四階段：照片上傳
- [x] 第五階段：離線同步與衝突處理
- [x] 第六階段：多頁 PNG 報告與分享
- [x] 第七階段：PWA、備份與還原
- [ ] 第八階段：Android 實機測試
