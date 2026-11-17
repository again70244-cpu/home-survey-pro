# 家電場勘助手 Pro — 架構規劃

## 1. 核心原則：本機優先（Local-first）

```
 UI (React)
   │  讀：useLiveQuery 直接讀 IndexedDB（永遠秒開、離線可用）
   │  寫：repo.* → 單一 Dexie transaction 同時寫入「資料」與「同步佇列」
   ▼
 IndexedDB (Dexie)  ── surveys / areas / photos / photoBlobs / outbox / conflicts / meta
   ▲            │
   │ pull       │ push（佇列依序）
   │            ▼
 Sync Engine ──► Supabase  (PostgREST + Storage，全部受 RLS 保護)
```

* **畫面只讀本機資料庫**，「已儲存」只在 IndexedDB transaction 成功後才顯示。
* 雲端是同步目標，不是畫面的資料來源。斷網、關 App、重開都不會遺失。
* 報告圖片直接用本機資料產生，不受同步狀態影響。
* 第一階段起就使用這個資料層，因此第五階段（離線同步）是「接上同步引擎」，不需要重寫畫面。

## 2. 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 8 | 指定 |
| 樣式 | Tailwind CSS 4 | 指定 |
| 路由 | React Router（HashRouter） | GitHub Pages 無伺服器端路由，Hash 模式不會 404；重設密碼連結也能正確回到 App |
| 本機 DB | Dexie 4 + dexie-react-hooks | 指定；liveQuery 讓畫面自動跟著資料更新 |
| PWA | vite-plugin-pwa（Workbox） | 自動產生 Service Worker 與 manifest |
| 雲端 | Supabase Auth / Postgres / Storage | 指定；免費方案足夠個人使用 |
| 圖片壓縮 | Canvas → JPEG（長邊 2560px、品質 0.85） | 保留尺寸刻度可辨識度，單張約 0.5–1.2 MB |
| 報告輸出 | html-to-image（toPng，pixelRatio 2） | A4 直式 1240×1754 CSS px → 輸出 2480×3508 PNG |
| ZIP | fflate | 小、快、純前端 |
| 部署 | GitHub Pages + GitHub Actions | 免費；也可改 Vercel |

## 3. 金鑰安全

* 前端只會使用 **Project URL** 與 **anon / publishable key**。這把金鑰設計上就是公開的（任何 Supabase 前端都會帶著它），真正的保護靠 **RLS**：沒有登入、或不是資料擁有者，資料庫一律拒絕。
* **service_role / secret key 絕不出現在本專案任何地方**（前端、.env、GitHub）。本專案不需要它。
* 本機開發的 `.env.local` 已列入 `.gitignore`；部署時金鑰放在 GitHub Actions 的 Repository Variables，build 時注入。

## 4. 資料模型

每筆資料都有：`id (UUID，前端產生)`、`user_id`、`revision`、`created_at`、`updated_at`、`server_updated_at`、`deleted_at`。

```
auth.users 1─1 profiles
auth.users 1─n surveys 1─n survey_areas 1─n survey_photos ──► Storage: survey-photos/{user_id}/{survey_id}/{photo_id}.jpg
teams 1─n team_members（預留，v1 不使用；surveys.team_id 可為 NULL）
```

* **尺寸 NULL = 尚未測量**；報告顯示「尚未測量」，絕不顯示 0。
* 照片以 `area_id` 關聯，與區域名稱無關，改名不會失聯。
* 照片本體在 Storage（私有 Bucket），資料庫只存 `storage_path`。顯示時用 Signed URL 或帶權杖下載。
* 不開放 SQL DELETE，一律軟刪除（`deleted_at`），避免離線刪除後被舊資料復活。
* 權限判斷集中在 `can_access_survey()`；未來團隊協作只需擴充此函式與 policy。

完整 SQL：`supabase/migrations/20261117000000_init.sql`

## 5. 同步機制

### 5.1 寫入
`repo.updateSurvey()` 在 **同一個 Dexie transaction** 內：
1. 更新本機資料列，標記 `_dirty = 1`
2. 寫入 / 合併 `outbox`（同一筆資料只保留一個待送項目）

### 5.2 Push（樂觀鎖）
每筆本機資料記住 `_baseRevision`（最後一次與雲端一致時的 revision）。

* 新資料（base = 0）：`INSERT … ON CONFLICT DO NOTHING`
* 修改 / 刪除：`UPDATE … WHERE id = ? AND revision = base`
  * 成功 → 伺服器 trigger 將 revision +1，本機更新 base，清除 dirty
  * 0 筆 → 讀取雲端版本 → **寫入 conflicts 表，不覆蓋任何一邊**，等使用者選擇
* 推送順序：surveys → areas → 照片檔案上傳 → photos（外鍵順序）
* 照片：先上傳 Storage，成功後才寫入 photo 資料列；本機 Blob 在雲端確認成功前絕不刪除。

### 5.3 Pull（增量）
`SELECT * WHERE server_updated_at > cursor - 2 分鐘`（重疊視窗避免交易提交順序造成漏抓）。合併規則：
* 本機沒有 → 寫入
* 本機不髒、雲端 revision 較新 → 覆蓋
* 本機有未送修改、雲端 revision 也變了 → 衝突

### 5.4 觸發時機
App 啟動、登入、`online` 事件、資料寫入後（debounce 1.5 秒）、回到前景（`visibilitychange`）、每 60 秒。

### 5.5 狀態
每筆資料與全域都顯示：本機已保存 / 雲端同步中 / 雲端已同步 / 等待網路同步 / 同步失敗（含錯誤訊息與重試）/ 有衝突待處理。

### 5.6 衝突處理
衝突頁並排顯示「此裝置版本」與「雲端版本」的差異欄位，使用者選一邊：
* 採用此裝置 → base 設為雲端 revision 後重新推送
* 採用雲端 → 以雲端資料覆蓋本機

## 6. 完整度檢查
每個區域計算：尺寸（三項全填 / 部分 / 未填）、照片（有 / 無）、同步（是否有未同步資料或照片）。場勘整體只有在「所有區域尺寸完整 + 都有照片 + 全部已同步」才顯示「完整」。

## 7. 報告輸出
* 以隱藏的 1240×1754 A4 容器排版，**先量測每個區塊高度再分頁**（區域標題+尺寸為不可分割區塊；照片以 2 欄網格逐列放入，放不下就換頁並標示「（續）」）。
* 照片使用 `object-fit: contain`，不裁切。
* 每頁頁首/頁尾：客戶姓名、頁碼 / 總頁數。
* 輸出：Web Share API（`navigator.canShare({files})` 檢查多檔）→ 不支援則逐張下載或 ZIP。

## 8. 備份
`.zip` 內含 `backup.json`（surveys / areas / photos 中繼資料，含版本號）與 `photos/{photo_id}.jpg`。還原時以 UUID 比對：相同 ID 不重複建立，依 revision / 使用者選擇決定是否覆蓋。

## 9. 開發階段

| 階段 | 內容 | 驗收 |
|---|---|---|
| 1 | 專案、登入系統、首頁、場勘基本 UI（本機儲存） | 註冊/登入/忘記密碼；新增/搜尋/編輯/刪除場勘 |
| 2 | Supabase 資料表、RLS、雲端 CRUD | A 裝置建立 → B 裝置看見；不同帳號互不可見 |
| 3 | 區域管理與尺寸 | 新增/改名/排序/刪除區域；空白顯示尚未測量 |
| 4 | 照片拍攝、壓縮、上傳 Storage | A 上傳 → B 看見；失敗可重傳 |
| 5 | 離線佇列、雙向同步、衝突處理 | 飛航模式新增修改 → 恢復網路自動同步 |
| 6 | 多頁 PNG 報告與分享 | Android 一次分享全部頁面到 LINE |
| 7 | PWA 安裝、備份與還原 | 安裝到主畫面；備份 ZIP 還原不重複 |
| 8 | Android 實機完整測試 | 第十四節 10 項驗收 |
