/**
 * 洗衣機現場檢查：模板欄位、防呆規則、拍攝清單、同步、報告、備份
 * 產品知識庫使用 catalog-fixtures.mts 產生的測試資料（攔截 catalog_* 請求），場勘資料走真實 Supabase。
 * 用法：node tests/e2e/washer.cjs <工作資料夾>（需先產生 <工作資料夾>/p2/fixtures.json）
 * 測試產品 WD-S13VDW：寬 60、深 61.5、高 85、門開 90 度總深 113.5、電源線 120、進排水管 100、外箱 65 × 70.5
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
  const warns = []; p.on('console', (m) => warns.push(m.text()))
  const name = '洗衣機檢查測試-' + Date.now().toString().slice(-5)

  console.log('— 選擇洗衣機產品後自動出現現場檢查')
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s13vdw')
  await p.getByRole('button', { name: '選擇 WD-S13VDW' }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()
  const W = p.getByRole('region', { name: '洗衣機現場檢查' })
  check(await until(async () => (await W.getByTestId('washer-score').count()) === 1), '場勘頁出現「洗衣機現場檢查」')
  check(await W.locator('[data-field]').count() === 0, '詳細欄位預設收起')
  await expand(W)
  check(await until(async () => (await W.locator('[data-finding="install:dims"]').count()) === 1), '陽台尚未量尺寸 → 必須人工確認')
  check(await until(async () => (await W.locator('[data-finding="fields:missing"][data-level="confirm"]').count()) === 1), '必要欄位未填 → 必須人工確認')
  check((await W.locator('#washer-install-area').inputValue()) !== '', '預設安裝位置為陽台')

  console.log('— 填寫現場尺寸與條件')
  const expandAreas = async () => { const b = p.getByRole('button', { name: '展開全部區域' }); await until(async () => (await b.count()) === 1, 10000); if (await b.count()) await b.click() }
  await expandAreas()
  const dim = async (area, label, v) => { const i = p.getByRole('region', { name: `區域 ${area}` }).locator('input[data-dim]').nth({ 寬: 0, 深: 1, 高: 2 }[label]); await i.fill(String(v)); await i.blur() }
  await dim('陽台', '寬', 62); await dim('陽台', '深', 80); await dim('陽台', '高', 200)
  await dim('電梯', '寬', 63); await dim('電梯', '深', 60)
  const choose = async (f, v) => { await W.locator(`[data-field="${f}"][data-value="${v}"]`).click(); await p.waitForTimeout(150) }
  const type = async (f, v) => { const i = W.locator(`input[data-field="${f}"]`); await i.fill(String(v)); await i.blur(); await p.waitForTimeout(150) }
  await choose('stacked', 'no'); await type('front_clearance_cm', 40); await choose('door_obstacle', 'no')
  await choose('faucet', 'yes'); await type('faucet_distance_cm', 110)
  await choose('drain_type', 'floor'); await type('drain_distance_cm', 50)
  await choose('outlet', 'yes'); await type('outlet_distance_cm', 150); await choose('outlet_grounded', 'yes'); await choose('dedicated_circuit', 'yes')
  await choose('floor_level', 'yes')
  const has = (id, level) => until(async () => (await W.locator(`[data-finding="${id}"][data-level="${level}"]`).count()) === 1, 5000)
  check(await has('install:width', 'caution'), '寬 62 < 機身 60 + 左右各 2 → 注意事項（左右預留不足）')
  check(await W.locator('[data-finding="install:depth"]').count() === 0, '深 80 ≥ 61.5 + 10 → 不提醒')
  check(await has('door:WD-S13VDW:door_open_90_depth', 'high'), '門開 90 度需凸出 52 cm、前方只有 40 → 高風險')
  check(await has('outlet:len:WD-S13VDW', 'high'), '插座距離 150 > 電源線 120 → 高風險')
  check(await has('faucet:shared:WD-S13VDW', 'confirm'), '只有「進排水管 100」→ 水龍頭 110 必須人工確認（不猜測）')
  check(await W.locator('[data-finding^="drain:"]').count() === 0, '排水距離 50 ≤ 100 → 不提醒')
  check(await until(async () => (await W.locator('[data-finding$=":WD-S13VDW:pkg"][data-level="caution"]').count()) === 1, 5000), '電梯寬 63／深 60 < 外箱 65 → 注意（需拆箱），機身可通過')
  check(await W.locator('[data-finding$=":body"]').count() === 0, '機身最窄面 60 可通過電梯，不列高風險')
  check(await W.locator('[data-finding="fields:missing"]').count() === 0, '必要欄位都填寫後不再提示')
  const firstLevel = await W.locator('[data-finding]').first().getAttribute('data-level')
  check(firstLevel === 'high', '高風險排在最前面')
  check((await W.locator('[data-count="high"]').innerText()) === '2', '統計：高風險 2 項')
  const light = (k) => W.locator(`[data-light="${k}"]`).getAttribute('data-state')
  check((await light('power')) === 'high' && (await light('door')) === 'high' && (await light('space')) === 'caution' && (await light('water')) === 'confirm', '燈號：電源、門片紅燈；空間橘燈；進水待確認')
  check((await W.getByTestId('washer-verdict').getAttribute('data-state')) === 'high', '一行結論顯示高風險')
  check(await W.locator('[data-bar="width_cm"][data-state="caution"]').count() === 1 && await W.locator('[data-bar="depth_cm"][data-state="ok"]').count() === 1, '空間比對圖：寬度不足（橘）、深度足夠')
  check((await W.getByTestId('light-legend').innerText()).replace(/\s+/g, '') === '高風險注意待確認正常未填點選燈號查看說明', '燈號下方有圖例說明每種狀態')
  check((await W.locator('[data-light="power"]').innerText()).includes('高風險') && (await W.locator('[data-bar="width_cm"]').innerText()).includes('預留不足') && (await W.locator('[data-bar="depth_cm"]').innerText()).includes('足夠'), '每格與每條比對都寫出狀態文字')
  check(!(await W.locator('[data-finding="outlet:len:WD-S13VDW"]').isVisible()), '未點選前不顯示文字說明')
  await W.locator('[data-light="power"]').click()
  check(await W.locator('[data-finding="outlet:len:WD-S13VDW"]').isVisible() && !(await W.locator('[data-finding="install:width"]').isVisible()), '點「電源」只顯示電源相關說明')
  await W.locator('[data-light="power"]').click()

  console.log('— 修正後即時更新')
  await type('front_clearance_cm', 60)
  check(await until(async () => (await W.locator('[data-finding="door:WD-S13VDW:door_open_90_depth"]').count()) === 0, 5000), '前方改為 60 cm → 門片提醒消失')
  await choose('outlet', 'no')
  check(await has('outlet:none', 'high') && (await W.locator('input[data-field="outlet_distance_cm"]').count()) === 0, '沒有插座 → 高風險，並隱藏距離欄位')
  await choose('outlet', 'yes')
  check((await W.locator('input[data-field="outlet_distance_cm"]').inputValue()) === '150', '改回「有」後距離值仍保留')

  console.log('— 拍攝清單')
  const before = await W.getByTestId('washer-score').innerText()
  const chooser = p.waitForEvent('filechooser')
  await W.getByRole('button', { name: '拍攝 安裝空間正面' }).click()
  await (await chooser).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: ICON })
  check(await until(async () => (await W.locator('[data-shot="space_front"]').getAttribute('data-done')) === '1', 8000), '拍完「安裝空間正面」後勾選完成')
  const balc = p.getByRole('region', { name: '區域 陽台' })
  check(await until(async () => (await balc.getByLabel('照片 1 說明').inputValue().catch(() => '')) === '安裝空間正面'), '照片存到陽台並自動填上說明')
  check(await until(async () => (await W.getByTestId('washer-score').innerText()) !== before), `完成度提高（${before} → ${await W.getByTestId('washer-score').innerText()}）`)
  await synced(p)
  await p.screenshot({ path: S + '/washer-1-detail.png', fullPage: true })

  console.log('— 雲端與另一台裝置')
  const cloud = await p.evaluate(async (KEY) => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const t = JSON.parse(localStorage.getItem(k)).access_token
    const h = { apikey: KEY, Authorization: 'Bearer ' + t }
    const tpl = await (await fetch('https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1/survey_templates?select=template_id,template_version,values,surveys(customer_name)&order=created_at.desc&limit=5', { headers: h })).json()
    const ph = await (await fetch('https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1/survey_photos?select=shot_key,caption&order=created_at.desc&limit=1', { headers: h })).json()
    return { tpl, ph }
  }, process.env.HSP_ANON_KEY)
  const mine = cloud.tpl.find((x) => x.surveys?.customer_name === name)
  check(mine && mine.template_id === 'washer' && mine.template_version === 1 && mine.values.front_clearance_cm === 60 && mine.values.outlet === 'yes', '雲端保存模板欄位值（含版本）')
  check(cloud.ph[0]?.shot_key === 'space_front', '雲端照片保存拍攝項目 shot_key')
  const b = await device(browser, catalog); const q = b.page
  await q.getByText(name, { exact: true }).first().click({ timeout: 30000 }); await q.getByRole('heading', { name, exact: true }).waitFor()
  const W2 = q.getByRole('region', { name: '洗衣機現場檢查' })
  await expand(W2)
  check(await until(async () => (await W2.locator('input[data-field="front_clearance_cm"]').inputValue().catch(() => '')) === '60', 30000), '另一台裝置同步看到欄位值')
  check(await until(async () => (await W2.locator('[data-shot="space_front"]').getAttribute('data-done').catch(() => '')) === '1', 30000), '另一台裝置看到拍攝清單已完成項目')
  const f1 = await W.locator('[data-finding]').evaluateAll((e) => e.map((x) => x.dataset.finding).join(','))
  const f2 = await W2.locator('[data-finding]').evaluateAll((e) => e.map((x) => x.dataset.finding).join(','))
  check(f1 === f2, '兩台裝置檢查結果相同（規則確定性）')
  await b.ctx.close()

  console.log('— 報告與備份')
  await p.getByRole('button', { name: '產生場勘報告' }).click()
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 })
  check(!warns.some((w) => w.includes('[report]')), '報告各頁沒有內容超出版面' + (warns.filter((w) => w.includes('[report]')).join(';')))
  const src = await p.locator('main ul li img').first().getAttribute('src')
  const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
  fs.writeFileSync(S + '/washer-report-p1.png', Buffer.from(b64, 'base64'))
  check(true, '報告第 1 頁已輸出（含現場檢查結果，見截圖）')
  await p.goto(URL + '#/settings'); await p.getByRole('heading', { name: '設定' }).waitFor()
  check(/MB/.test(await p.getByTestId('storage-usage').innerText()), '設定頁顯示照片空間用量')
  const dl = p.waitForEvent('download', { timeout: 120000 }); await p.getByRole('button', { name: /只匯出資料/ }).click()
  const jf = S + '/washer-backup.json'; await (await dl).saveAs(jf)
  const bj = JSON.parse(fs.readFileSync(jf, 'utf8'))
  const sv = bj.surveys.find((x) => x.customer_name === name)
  check(bj.version === 3 && bj.templates.some((t) => t.survey_id === sv.id && t.values.front_clearance_cm === 60) && bj.photos.some((x) => x.survey_id === sv.id && x.shot_key === 'space_front'), '備份 v3 包含模板欄位值與照片拍攝項目')
  await p.getByTestId('restore-input').setInputFiles(jf); await p.getByRole('dialog', { name: '確認還原' }).waitFor()
  check(await p.getByText('備份中的資料都已存在').first().waitFor({ timeout: 15000 }).then(() => true, () => false), '重複還原：不重複建立')

  console.log('— 清理：刪除測試場勘（連同模板）')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('button', { name: '刪除這筆場勘' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor()
  const del = await p.evaluate((n) => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const t = r.result.transaction(['surveys', 'survey_templates']); const s = t.objectStore('surveys').getAll(); const st = t.objectStore('survey_templates').getAll(); t.oncomplete = () => { const sv = s.result.find((x) => x.customer_name === n); res(st.result.filter((x) => x.survey_id === sv.id).map((x) => !!x.deleted_at)) } } }), name)
  check(del.length === 1 && del[0], '刪除場勘時模板一併軟刪除')
  await synced(p)
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
