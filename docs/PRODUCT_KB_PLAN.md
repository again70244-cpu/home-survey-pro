# LG 產品知識庫與 Google Sheets 自動同步：Phase 0 檢查報告與實作計畫

> 狀態：**Phase 0（僅檢查，未修改任何程式或資料庫）**。等確認決策後才開始 Phase 1。

---

## 1. 現況檢查結果

### 1.1 專案與部署
| 項目 | 現況 |
|---|---|
| 程式庫 | `again70244-cpu/home-survey-pro`，`main` 為正式版（GitHub Pages 自動部署） |
| 前端 | React 19 + TypeScript 5.9 + Vite 8 + Tailwind 4 + vite-plugin-pwa |
| 後端 | Supabase 專案 `kmcnowfjzrppntgktyjq`；**尚未使用 Edge Functions**（`/functions/v1/*` 目前回 404） |
| 金鑰 | 前端只有 publishable key；service_role 從未出現在程式庫或前端 |

### 1.2 資料庫（`supabase/migrations/20261117000000_init.sql` + `patches/2026-11-17_revoke_delete.sql`）
| 資料表 | 用途 | RLS |
|---|---|---|
| `profiles` | 使用者資料 | 只能讀改自己 |
| `teams` / `team_members` | 預留團隊 | 成員可讀 |
| `surveys` | 場勘主檔（含 `product_model` 文字欄位；`product` 欄位前端已隱藏、資料保留） | 只能存取自己；**無 DELETE 權限**（軟刪除） |
| `survey_areas` | 區域尺寸 | 同上，且需屬於自己的場勘 |
| `survey_photos` | 照片中繼資料 | 同上；Storage 私有 bucket `survey-photos/{user_id}/…` |

- 所有表都有 `revision`、`server_updated_at`、`deleted_at`，由 trigger 維護。
- **目前沒有任何產品資料表**；場勘的產品只有自由輸入的 `product_model` 文字。

### 1.3 同步機制（`src/sync/engine.ts`）
- 本機優先：Dexie（IndexedDB）→ outbox → Supabase；revision 樂觀鎖、衝突保留雙版本。
- 同步的資料表由兩個設定決定：`COLUMNS`（第 16 行）、`TABLE_ORDER`（第 23 行）。
- 同步只處理「使用者自己的資料」（`user_id` 篩選）。產品知識庫是**共用、唯讀**資料，性質不同 → 不放進這套 outbox 流程，另建唯讀下載模組，**不改動核心同步邏輯**。

### 1.4 本機資料庫與 PWA
- Dexie schema `version(1)`（`src/db/db.ts:23`）：surveys / survey_areas / survey_photos / photoBlobs / outbox / conflicts / meta。新增表需以 `version(2)` **只新增、不改動**既有表（Dexie 會保留舊資料）。
- Service Worker 預快取 App 檔案；只對 Google Fonts 做執行期快取。產品圖片在 `i.ibb.co`，需要新增圖片快取規則才能離線看圖。

### 1.5 備份還原（`src/backup/backup.ts`）
- 格式 `version 1`：surveys / areas / photos + 照片檔。新增的「場勘產品快照」需納入備份 → 升為 `version 2`，**仍可讀取 version 1 舊備份**。

### 1.6 測試
- 程式庫內：`supabase/tests/`（RLS SQL 測試）。
- 端對端測試（Playwright，92 項）目前只存在工作暫存區，**未收進程式庫** → Phase 1 一併收進 `tests/e2e/`（帳密改由環境變數提供，不寫入程式碼）。
- 沒有單元測試框架 → 新增 `vitest` 給解析器使用（只用於開發，不影響 App）。

---

## 2. Google Sheets 實際資料分析

以下依實際讀取內容。**數量不寫死**，同步時每次重新計算。

### 2.1 「報價」工作表（目前範圍 A1:M134，約 133 筆）
| 欄 | 標題 | 處理 |
|---|---|---|
| A | 產品型號 | ✅ 同步（需拆解，見下） |
| B | 產品原價 | ❌ 禁止 |
| C | 周年慶低售(6期) | ❌ 禁止 |
| D | 促銷/備註 | ❌ 禁止（含贈品、檔期、低售申請等） |
| E | 分類 | ✅ |
| F–I | 圖片網址 1–4 | ✅（F 欄可能用全形「，」放多個網址；H 欄有前置空白） |
| J | 安裝尺寸 | ✅ 原文保留 + 解析 |
| K | 連結 | ✅ |
| L | 影片網址 | ✅ |
| M | 保養說明 | ✅ |

**A 欄「產品型號」實際上是「型號 + 多個空白 + 描述」**，例如：
- `WD-S2220B␣␣␣…AI智控洗乾衣機/22洗20乾/尊爵黑`
- 冷氣是「室外機/室內機」成對：`LSU72DHST/LSN72DDHST 極淨(新) 7.2KW`
- 同一台室外機 `LSU72DHST` 會搭配不同室內機（`LSN72DDHST` 極淨、`LSN72IDHST` 極適）→ **不能只用室外機當唯一鍵**。
- 部分描述含通路資訊，例如「網購禁售」「網購+集盛禁售」，以及前綴「C/」。

**J 欄安裝尺寸**實際出現的格式（多行文字、無單位）：
```
寬70;高189;深83
門開90度總深146
電源線長度120
進排水管長度100
外箱尺寸寬75;高200;深86
```
另有：
- `全開總深125(搭S22FHDB)`：迷你洗衣機、抽屜櫃，**附帶搭配條件**
- `全開總高138`：直立式洗衣機上蓋全開高度
- 部分內容在讀取預覽中被截斷（「…」），可能還有其他行 → 解析器必須保留無法辨識的行

**其他觀察**
- 多個不同型號共用同一張圖片網址，例如 `WD-S1310*` 使用 S2220 的圖片。這屬於資料本身的狀況，系統照實同步，不自行修正。
- 冷氣類目前都沒有安裝尺寸。

### 2.2 「一對多報價」工作表（目前 A1:K4，3 筆）
| 欄 | 內容 | 處理 |
|---|---|---|
| A | `一對二 室外機 LM2U50(5.2KW)`、`一對二;一對三室外機LM3U90(8.8KW)` | ✅ 拆出室外機型號、容量、搭配方式（一對二／一對三） |
| B、C | 室外機價格 | ❌ 禁止 |
| D–J | `LSN22DDHST極淨2.2KW $11900` | ✅ 只取型號、系列、容量；**`$11900` 室內機價格必須去除** |
| K | `搭配室內機2.2~4.1(相加總合不得超過6.3;相加總合不得低於4.2)` | ✅ 原文保留（去除任何金額），另解析為「容量範圍、總和上下限」規則 |

### 2.3 「白名單」「LG業績」
完全不讀取。Apps Script 只會讀取「報價」「一對多報價」兩張表，而且**只讀白名單中的欄位標題**。

---

## 3. 架構評估

```
Google Sheets ──(Apps Script：只讀白名單欄位，計算雜湊)──▶ Supabase Edge Function（驗證簽章、清洗、解析）
                                                           │ 單一交易 RPC
                                                           ▼
                                            產品資料表 + 同步紀錄（Postgres）
                                                           ▼
                                            App（唯讀下載 → IndexedDB 快取 → 離線可用）
```

**結論：架構適合，建議採用。**
- Google 端不需要任何服務帳號金鑰：Apps Script 以你的 Google 帳號執行，GitHub 和 Supabase 都不會有 Google 憑證。
- 價格欄位在**來源端**就不讀取（白名單欄位）；Edge Function 再做第二道過濾，拒絕任何非白名單欄位，並刪除 `$數字` 等價格字樣。
- 資料量小（目前 133 + 3 筆），每次送**完整快照**最簡單也最可靠。差異由伺服器計算，天然具備冪等性，也能做完整重新同步。
- 另一個方案「Edge Function 定時去讀 Sheets API」需要 Google 服務帳號金鑰，而且做不到「修改後立即同步」，因此不採用。

### 3.1 觸發與防抖
- **變更觸發**（可安裝的 onChange／onEdit 觸發器）：只在「報價」「一對多報價」被修改時，排一個 **2 分鐘後**執行的單次觸發；2 分鐘內的連續修改合併成一次同步。
- **定期觸發**：每 15 分鐘一次。若資料雜湊和上次成功同步相同，就直接略過，不呼叫伺服器。
- **LockService**：同一時間只允許一個同步執行。
- **手動同步**：試算表上方選單「LG 產品同步」提供三個功能：
  - 立即同步
  - 完整重新同步（忽略雜湊、強制送出）
  - 差異檢查（只預覽、不寫入）

### 3.2 安全
- Edge Function `product-sync` **不接受一般使用者的 JWT**，只接受帶 HMAC-SHA256 簽章的請求：
  - 簽章內容：`時間戳 + 本文雜湊`，密鑰為 `PRODUCT_SYNC_SECRET`。
  - 時間戳必須在 ±5 分鐘內（防止重放）。
  - 同一個請求 ID 只能用一次。
- 密鑰只存在兩個地方：Apps Script 的 Script Properties、Supabase Edge Function Secrets。**不進 GitHub、不進前端。**
- Edge Function 在伺服器端使用 Supabase 自動提供的 service role 寫入資料；前端完全沒有寫入產品資料的權限（RLS 只開放讀取）。

### 3.3 失敗保護（同步錯誤不破壞既有資料）
- 寫入在**單一 Postgres 交易**（RPC 函式）內完成：任何一步失敗就整批回復，App 繼續使用上一次成功的資料。
- **異常保護**：快照筆數為 0，或比上次成功同步的有效產品少超過 30%（例如誤刪整片資料、讀取不完整）→ 拒絕套用並記錄為「已拒絕」。若確定是刻意刪除，可用「完整重新同步（強制）」套用。
- 每次執行都寫入同步紀錄：觸發方式、狀態、筆數、新增／更新／停用清單、錯誤與警告。

---

## 4. 唯一鍵與資料規則

- **產品唯一鍵** = `來源工作表` + `正規化型號`
  - 正規化型號 = A 欄第一個空白前的內容，全形轉半形、去除所有空白、轉大寫。
  - 例：`LSU72DHST/LSN72DDHST`、`WD-S2220B`。
- **同一張表內出現重複型號**：保留第一筆，其餘列入警告「重複型號（第 N 列）」，標記為「待人工確認」。
- **型號被修改**：系統無法分辨「改名」或「刪除後新增」，因此舊型號會停用、新型號會新增，差異報告會一併列出兩者，方便人工核對。
- **刪除**：只做軟刪除，標記 `is_active = false`、記錄 `deactivated_at`，**不實際刪除資料**。之後若在試算表中重新出現，會自動恢復啟用。
- **規格快照**：場勘選擇產品時，會把當下的完整規格複製一份存進案件。之後產品資料怎麼更新，都不會影響舊案件。

---

## 5. 資料庫遷移計畫（只新增，不修改既有表）

新檔案：`supabase/migrations/20261120000000_product_catalog.sql`（可重複執行）

| 新資料表 | 內容 |
|---|---|
| `catalog_products` | 型號（正規化／原始）、描述、分類（原始／正規化）、圖片網址陣列、連結陣列、影片網址陣列、保養說明；安裝規格欄位（numeric，NULL＝未提供）；`install_text_raw`；`install_extra`（jsonb：附條件或無法歸類的項目）；`parse_issues`（jsonb）；`data_quality`；`is_active`／`deactivated_at`；`source`、`source_row`；`content_hash`、`spec_hash`；`first_seen_at`、`last_synced_at`、`spec_updated_at`（規格雜湊有變才更新） |
| `catalog_multi_split_systems` | 室外機型號、原始文字、容量 kW、搭配方式陣列、備註原文（已去除金額）、解析後規則（jsonb）、啟用狀態、同步時間 |
| `catalog_multi_split_indoor_units` | 所屬室外機、室內機型號、系列、容量 kW、順序（**一個室內機一列**，不塞在同一欄） |
| `catalog_sync_runs` | 同步紀錄：觸發方式、狀態（success／unchanged／rejected／failed／preview）、來源雜湊、筆數統計、差異、錯誤、警告、時間 |
| `catalog_sync_nonces` | 已使用的請求 ID（防重放，自動清理） |
| `survey_products` | 場勘選擇的產品（**每筆場勘可選多個**，例如洗衣機加抽屜櫃）：`survey_id`、`user_id`、`catalog_product_id`（可為 NULL，產品停用也不影響）、`model_code`、**`spec_snapshot` jsonb**、`snapshot_at`、`sort_order`；與其他場勘資料表一樣有 `revision`、軟刪除和 RLS |

**安裝規格欄位（全部可為 NULL，不補 0）**

| 欄位 | 對應原文 |
|---|---|
| `width_cm`、`height_cm`、`depth_cm` | 寬、高、深 |
| `door_open_90_depth_cm` | 門開90度總深 |
| `full_open_depth_cm` | 全開總深（附帶的搭配條件存在 `install_extra`） |
| `full_open_height_cm` | 全開總高 |
| `door_clearance_cm` | 開門所需空間（目前資料沒有，先預留） |
| `power_cable_cm` | 電源線長度 |
| `water_inlet_hose_cm`、`drain_hose_cm` | 進水管、排水管長度（**只有原文明確寫出時才填**） |
| `inlet_drain_hose_cm` | 「進排水管長度」：原文含義不明確，**單獨存放，不拆成兩個值**（見決策 1） |
| `package_width_cm`、`package_height_cm`、`package_depth_cm` | 外箱尺寸寬、高、深 |

**`data_quality` 資料品質分級**

| 值 | 意義 |
|---|---|
| `complete` | 有寬、高、深，且全部內容都能解析 |
| `missing` | 沒有安裝尺寸 |
| `invalid` | 有文字但完全無法解析 |
| `needs_review` | 有部分內容無法辨識，或有重複型號、含義不明確的項目 |

**權限（RLS）**
- `catalog_*`：登入使用者**只能讀取**；只有伺服器（service role）能寫入；匿名使用者完全無法存取。
- `survey_products`：與 `surveys` 相同，只能存取自己的資料，且沒有 DELETE 權限。

**回復方式**：所有變更都是新增的表，不更動既有資料。萬一要撤回，只需刪除這幾張新表，原有場勘資料完全不受影響。遷移前請先在 App「設定」頁匯出一次完整備份。

---

## 6. 預計新增／修改的檔案

**新增**
- `supabase/migrations/20261120000000_product_catalog.sql`：資料表、RLS、交易式套用快照的 RPC 函式
- `supabase/functions/product-sync/index.ts`：Edge Function，負責驗證簽章、清洗資料、計算差異、呼叫 RPC
- `shared/catalog/parseInstallText.ts`：安裝尺寸解析器（Edge Function 與前端共用）
- `shared/catalog/normalize.ts`：型號正規化、價格字樣清除、一對多規則解析
- `shared/catalog/*.test.ts`：解析與正規化的測試案例
- `integrations/google-apps-script/ProductSync.gs`：給你貼進試算表的 Apps Script（**不含任何密鑰**）
- `src/catalog/`：唯讀下載與本機快取、搜尋功能
- `src/pages/CatalogPage.tsx`、`src/pages/CatalogProductPage.tsx`：產品搜尋頁、產品詳細頁、同步狀態
- `src/components/ProductPicker.tsx`：場勘選擇產品的元件
- `tests/e2e/*`：把現有 92 項端對端測試收進程式庫，並新增產品知識庫相關測試

**小幅修改（只新增設定或欄位，不改動既有邏輯）**
- `src/db/db.ts`：新增 Dexie `version(2)`，只加新表
- `src/db/types.ts`：新增型別
- `src/sync/engine.ts`：在 `COLUMNS`、`TABLE_ORDER` 註冊 `survey_products`，沿用現有同步流程
- `src/pages/SurveyDetailPage.tsx`：加入「安裝產品」區塊
- `src/backup/backup.ts`：備份格式升為 v2（加入 survey_products），仍相容 v1
- `src/report/*`：報告封面加上所選產品的規格（以快照為準）
- `src/App.tsx`：新增路由
- `vite.config.ts`：新增產品圖片離線快取規則
- `package.json`：開發用加入 vitest

---

## 7. 測試計畫重點
- 新增／修改／刪除產品的測試在**試算表副本**上進行，不動正式資料：
  - 同步資料帶 `dataset = 'staging'` 標記。
  - App 只讀取 `production` 資料。
  - 測試結束後清除 staging 資料。
- 「同步中斷」與「失敗重試」：模擬 RPC 中途出錯，確認整批回復、舊資料完整保留；之後重試能成功。
- 「舊案件快照不變」：先選擇產品，再修改試算表尺寸並同步，確認舊案件規格不變、新選的產品帶入新規格。
- 回歸測試：重跑現有 92 項，確認照片、報告、備份等既有功能正常。

---

## 8. 需要確認的決策

1. **「進排水管長度100」**：建議存成獨立欄位 `inlet_drain_hose_cm = 100`，畫面顯示「進排水管長度：100 cm（原文未區分進水／排水）」，`water_inlet_hose_cm` 和 `drain_hose_cm` 保持空白。（任務說明的範例把 100 放進 `water_pipe_cm`，但這和「不得拆成兩個確定數值」的規則衝突，所以建議改用獨立欄位。）
2. **單位**：原文沒有寫單位，數值看起來是公分。建議預設為 cm，並在每筆資料記錄「來源未標示單位，依預設 cm」。若原文明確寫 mm 或 m，則換算並記錄。
3. **描述中的通路資訊**（例如「網購禁售」「網購+集盛禁售」「C/」前綴）：這不是價格，但屬於銷售資訊。建議**保留原始描述**，另外產生一個去除這些字樣的「顯示名稱」。也可以選擇完全去除。
4. **一筆場勘可以選幾個產品**：建議可以選多個，例如滾筒洗衣機加抽屜櫃、或冷氣的室內機加室外機。
5. **手動同步的位置**：建議第一版只放在**試算表選單**（只有能編輯試算表的人才能觸發）。App 只顯示同步狀態，一般使用者無法觸發同步。

## 9. 需要你協助的設定（Phase 1 時提供詳細步驟）
1. **部署 Edge Function**，二選一：
   - (a) 我用 Supabase 個人存取權杖（Personal Access Token）自動部署。權杖透過安全表單提供，不會出現在對話中。
   - (b) 你在 Supabase 網頁的 Edge Functions 編輯器貼上程式碼部署。
2. 在 Supabase 設定 `PRODUCT_SYNC_SECRET`（我會產生隨機密鑰，請你分別貼到 Supabase 和 Apps Script）。
3. 在試算表的「擴充功能 → Apps Script」貼上程式碼，並執行一次 `setup()` 來授權和安裝觸發器。
4. 建立一份試算表副本，給測試使用。
