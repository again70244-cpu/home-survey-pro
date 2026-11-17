# 設定步驟（請依序完成）

## A. 建立 GitHub Repository
1. 開啟 https://github.com/new
2. Repository name：`home-survey-pro`
3. 選 **Public**（GitHub Pages 免費方案需要公開 repo；程式碼中沒有任何機密）
4. **不要**勾選 README / .gitignore / License（保持空白）
5. 按 Create repository

## B. 建立 Supabase 專案
1. 開啟 https://supabase.com/dashboard → New project
2. 名稱：`home-survey-pro`，Region 選 **Northeast Asia (Tokyo)** 或 Singapore
3. 設定資料庫密碼（自己保存即可，App 不需要）
4. 建立完成後：左側 **SQL Editor** → New query → 貼上 `supabase/migrations/20261117000000_init.sql` 全文 → **Run**，應顯示 Success
5. 左側 **Storage** 確認有 `survey-photos`，且標示為 **Private**

## C. 設定登入網址
Supabase → **Authentication → URL Configuration**
* Site URL：`https://<你的GitHub帳號>.github.io/home-survey-pro/`
* Redirect URLs 新增：
  * `https://<你的GitHub帳號>.github.io/home-survey-pro/**`
  * `http://localhost:5173/**`（本機開發用）

## D. 取得連線資訊（只需要這兩項）
Supabase → **Project Settings → API**（或 API Keys）
* **Project URL**：`https://xxxx.supabase.co`
* **anon public**（或 **Publishable key**，`sb_publishable_...`）

> ⚠️ 不要提供 **service_role** / **Secret key**，本專案完全不需要。
> anon / publishable key 本來就會出現在網頁中，安全性由資料庫 RLS 保障（已測試：不同帳號互相看不到資料）。

## E. 設定 GitHub 部署
GitHub repo → **Settings → Secrets and variables → Actions → Variables 分頁 → New repository variable**
* `VITE_SUPABASE_URL` = Project URL
* `VITE_SUPABASE_ANON_KEY` = anon / publishable key

GitHub repo → **Settings → Pages → Build and deployment → Source：GitHub Actions**

推送程式碼後，Actions 會自動建置，網址為 `https://<帳號>.github.io/home-survey-pro/`

## F. 本機開發（選用）
```bash
cp .env.example .env.local   # 填入 D 的兩個值
npm install
npm run dev
```
