/**
 * 現場拍攝模式：一步一步量測、回答、拍照；跳過與補填；完成頁；資料與詳細頁面一致
 * 產品知識庫使用 catalog-fixtures.mts 產生的測試資料（攔截 catalog_* 請求），場勘資料走真實 Supabase。
 * 用法：node tests/e2e/washer.cjs <工作資料夾>（需先產生 <工作資料夾>/p2/fixtures.json）
 * 測試產品 WD-S13VDW（洗衣機）
 */
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path')
const S = process.argv[2]; const URL = 'http://localhost:4174/'
const FX = JSON.parse(fs.readFileSync(S + '/p2/fixtures.json', 'utf8'))
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m) }
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)) } return false }
const expand = async (R) => { const b = R.getByRole('button', { name: /展開全部欄位/ }); await until(async () => (await b.count()) === 1, 15000); await b.click() }
const synced = async (p) => {
  try { await p.getByText(/^雲端已同步・/).first().waitFor({ timeout: 60000 }) } catch (e) {
    const out = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => res(q.result.map((x) => [x.table, x.attempts, x.lastError])) } }))
    console.log('  [outbox]', JSON.stringify(out).slice(0, 800))
    throw e
  }
}
const ICON = fs.readFileSync(path.join(__dirname, '../../public/icon-192.png'))

async function device(browser, catalog) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  await ctx.route('**/rest/v1/catalog_sync_runs*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog.runs) }))
  await ctx.route('**/rest/v1/catalog_products*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog.products) }))
  await ctx.route('**/rest/v1/catalog_multi_split_systems*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(FX.systems) }))
  await ctx.route('https://i.ibb.co/**', (r) => r.fulfill({ contentType: 'image/png', body: ICON }))
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('[JS error]', e.message)); page.on('dialog', (d) => d.accept())
  await page.goto(URL); await page.getByLabel('Email').fill('hsp-test-a@example.com'); await page.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW)
  await page.getByRole('button', { name: '登入' }).click(); await page.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 })
  return { ctx, page }
}

;(async () => {
  const browser = await chromium.launch()
  const catalog = { products: JSON.parse(JSON.stringify(FX.products)), runs: FX.runs }
  {
    // 產品 ID 對應到正式產品知識庫中同型號的真實 ID（survey_products 有外鍵）
    const tmp = await browser.newContext(); const tp = await tmp.newPage(); await tp.goto(URL)
    const live = await tp.evaluate(async ([KEY, PW]) => {
      const SB = 'https://kmcnowfjzrppntgktyjq.supabase.co'
      const tok = (await (await fetch(SB + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'hsp-test-a@example.com', password: PW }) })).json()).access_token
      return await (await fetch(SB + '/rest/v1/catalog_products?select=id,model_code', { headers: { apikey: KEY, Authorization: 'Bearer ' + tok } })).json()
    }, [process.env.HSP_ANON_KEY, process.env.HSP_TEST_A_PW])
    await tmp.close()
    const byModel = new Map(live.map((x) => [x.model_code, x.id]))
    for (const x of catalog.products) if (byModel.has(x.model_code)) x.id = byModel.get(x.model_code)
  }
  const a = await device(browser, catalog); const p = a.page
  const name = '現場拍攝測試-' + Date.now().toString().slice(-5)
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s13vdw'); await p.getByRole('button', { name: '選擇 WD-S13VDW' }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()

  console.log('— 場勘頁的現場拍攝卡片')
  const card = p.getByRole('region', { name: '洗衣機現場拍攝' })
  check(await until(async () => (await card.getByTestId('washer-field-next').innerText().catch(() => '')) === '安裝位置'), '顯示下一步：安裝位置')
  await card.getByRole('button', { name: '開始現場拍攝' }).click()
  const main = p.getByRole('main')
  const title = () => p.locator('h1').first().innerText()
  check(await until(async () => (await title()) === '安裝位置') && (await p.getByTestId('field-progress').innerText()) === '第 1 / 10 步', '進入第 1 步：安裝位置')

  console.log('— 第 1 步：先量測，再拍照')
  const sec = (n) => p.getByRole('region', { name: n })
  const firstSection = await main.locator('section').first().getAttribute('aria-label')
  check(firstSection === '量測與問題', '量測區塊在拍照區塊之前')
  const dim = async (k, v) => { const i = p.locator(`input[data-field-dim="${k}"]`); await i.fill(String(v)); await i.blur(); await p.waitForTimeout(200) }
  await dim('width_cm', 62); await dim('depth_cm', 80); await dim('height_cm', 200)
  const pick = async (f, v) => { await p.locator(`[data-field="${f}"][data-value="${v}"]`).click(); await p.waitForTimeout(200) }
  const type = async (f, v) => { const i = p.locator(`input[data-field="${f}"]`); await i.fill(String(v)); await i.blur(); await p.waitForTimeout(200) }
  await pick('stacked', 'no')
  check(await until(async () => (await p.locator('[data-finding="install:width"][data-level="caution"]').count()) === 1), '這一步直接提醒：左右預留空間不足')
  const shoot = async (label) => { const c = p.waitForEvent('filechooser'); await p.getByRole('button', { name: `拍攝 ${label}` }).click(); await (await c).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: ICON }) }
  await shoot('安裝空間正面')
  check(await until(async () => (await p.locator('[data-shot="space_front"]').getAttribute('data-done')) === '1'), '拍照後顯示已拍')
  check((await p.locator('[data-step-state]').first().getAttribute('data-step-state')) === 'current', '進度條標示目前步驟')
  await p.getByRole('button', { name: /^下一步：左右兩側/ }).click()

  console.log('— 第 2～9 步')
  check(await until(async () => (await title()) === '左右兩側'), '第 2 步：左右兩側')
  await shoot('安裝空間左側'); await until(async () => (await p.locator('[data-shot="space_left"]').getAttribute('data-done')) === '1')
  await p.getByRole('button', { name: /^下一步：上方空間/ }).click()
  check(await until(async () => (await title()) === '上方空間'), '第 3 步：上方空間')
  check(await p.getByRole('button', { name: '跳過' }).count() === 1, '未完成的步驟有「跳過」')
  await p.getByRole('button', { name: '跳過' }).click()
  check(await until(async () => (await title()) === '門片前方'), '跳過後到第 4 步：門片前方')
  check(await p.locator('[data-shot]').count() === 0, '門片前方沒有拍照區塊（不需要照片）')
  await type('front_clearance_cm', 80); await pick('door_obstacle', 'no')
  await p.getByRole('button', { name: /^下一步：水龍頭/ }).click()
  check(await until(async () => (await title()) === '水龍頭'), '第 5 步：水龍頭')
  check(await p.locator('input[data-field="faucet_distance_cm"]').count() === 0, '還沒回答前不顯示距離')
  await pick('faucet', 'yes')
  check(await until(async () => (await p.locator('input[data-field="faucet_distance_cm"]').count()) === 1), '選「有」才出現距離')
  await type('faucet_distance_cm', 50); await shoot('水龍頭（進水）')
  await until(async () => (await p.locator('[data-shot="faucet"]').getAttribute('data-done')) === '1')
  await p.getByRole('button', { name: /^下一步：排水/ }).click()
  await until(async () => (await title()) === '排水'); await pick('drain_type', 'floor'); await type('drain_distance_cm', 40)
  await p.getByRole('button', { name: /^下一步：插座/ }).click()
  await until(async () => (await title()) === '插座'); await pick('outlet', 'no')
  check(await until(async () => (await p.locator('[data-finding="outlet:none"][data-level="high"]').count()) === 1), '沒有插座 → 這一步直接顯示高風險')
  await p.getByRole('button', { name: /^下一步：地面與周邊/ }).click()
  await until(async () => (await title()) === '地面與周邊'); await pick('floor_level', 'yes')
  check(await until(async () => (await p.getByTestId('step-ok').count()) === 1), '完成且沒有問題時顯示「這一步沒有發現問題」')
  await p.getByRole('button', { name: /^下一步：大門與走道/ }).click()

  console.log('— 第 9～10 步：自動新增大門、量電梯')
  check(await until(async () => (await title()) === '大門與走道'), '第 9 步：大門與走道')
  await p.getByRole('button', { name: /新增「大門」並開始量測/ }).click()
  check(await until(async () => (await p.locator('input[data-field-dim="width_cm"]').count()) === 1), '一鍵新增「大門」區域後可直接量測')
  await dim('width_cm', 90)
  await p.getByRole('button', { name: /^下一步：電梯或樓梯/ }).click()
  check(await until(async () => (await title()) === '電梯或樓梯') && (await p.getByText('區域：電梯').count()) === 1, '第 10 步：預設量電梯')
  await dim('width_cm', 100); await dim('depth_cm', 150); await dim('height_cm', 210)
  await p.getByRole('button', { name: /^完成/ }).click()

  console.log('— 完成頁')
  check(await until(async () => (await p.getByTestId('field-done-title').innerText().catch(() => '')) === '現場拍攝完成 9 / 10'), '完成 9 / 10（上方空間被跳過）')
  check(await p.getByRole('button', { name: '補填 上方空間' }).count() === 1, '列出跳過的步驟並可補填')
  check(await p.getByRole('button', { name: '補拍 左右兩側' }).count() === 1 && await p.getByRole('button', { name: '補拍 排水' }).count() === 1, '列出量測完成但還沒拍照的步驟')
  check(await p.locator('[data-finding="outlet:none"]').count() === 1, '完成頁列出檢查結果（高風險：沒有插座）')
  await p.getByRole('button', { name: '補填 上方空間' }).click()
  check(await until(async () => (await title()) === '上方空間'), '補填回到該步驟')
  await pick('top_obstacle', 'no')
  check(await until(async () => (await p.locator('[data-step-state="done"]').count()) === 9 && (await p.getByRole('button', { name: '第 3 步 上方空間（已完成）' }).count()) === 1), '補填後 10 步都完成（目前這一步也標示已完成）')
  await p.getByRole('button', { name: '結束現場拍攝' }).click()

  console.log('— 回到場勘頁：資料一致')
  await p.getByRole('heading', { name, exact: true }).waitFor()
  check(await until(async () => (await card.getByTestId('washer-field-next').innerText().catch(() => '')) === '全部完成'), '場勘頁卡片顯示全部完成')
  check((await card.getByRole('button').innerText()).includes('檢視現場拍攝'), '按鈕改為「檢視現場拍攝」')
  const balc = p.getByRole('region', { name: '區域 陽台' })
  check((await balc.locator('input[data-dim]').nth(0).inputValue()) === '62' && (await balc.getByLabel('照片 1 說明').inputValue()) === '安裝空間正面', '陽台的尺寸與照片（含說明）與現場拍攝一致')
  check(await p.getByRole('region', { name: '區域 大門' }).count() === 1, '新增的「大門」區域出現在場勘頁')
  const W = p.getByRole('region', { name: '洗衣機現場檢查' })
  const b = W.getByRole('button', { name: /展開全部欄位/ }); await b.click()
  check((await W.locator('input[data-field="front_clearance_cm"]').inputValue()) === '80' && (await W.locator('[data-field="outlet"][data-value="no"]').getAttribute('aria-checked')) === 'true', '詳細欄位與現場拍攝填寫的值相同')
  await synced(p)
  await p.screenshot({ path: S + '/field-detail.png' })

  console.log('— 清理')
  await p.getByRole('button', { name: '刪除這筆場勘' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor()
  await synced(p)
  check(true, '已刪除測試場勘')
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
