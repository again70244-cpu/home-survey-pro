/**
 * 冰箱現場檢查：模板欄位、防呆規則、一鍵新增安裝位置、條件式拍攝項目、同步、報告、備份
 * 產品知識庫使用 catalog-fixtures.mts 產生的測試資料（攔截 catalog_* 請求），場勘資料走真實 Supabase。
 * 用法：node tests/e2e/washer.cjs <工作資料夾>（需先產生 <工作資料夾>/p2/fixtures.json）
 * 測試產品 GR-AQC82BS：寬 91.2、深 73.5、高 179、門開 90 度總深 126、總寬 144.2、拆門總深 76.4、抽屜全開總深 140.6
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
    console.log('  GR-AQC82BS 在正式產品知識庫：', byModel.has('GR-AQC82BS'))
  }
  const a = await device(browser, catalog); const p = a.page
  const warns = []; p.on('console', (m) => warns.push(m.text()))
  const name = '冰箱檢查測試-' + Date.now().toString().slice(-5)
  const M = 'GR-AQC82BS'

  console.log('— 選擇冰箱後自動出現冰箱檢查')
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('aqc82')
  await p.getByRole('button', { name: '選擇 ' + M }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()
  const F = p.getByRole('region', { name: '冰箱現場檢查' })
  check(await until(async () => (await F.getByTestId('fridge-score').count()) === 1), '場勘頁出現「冰箱現場檢查」')
  await expand(F)
  check(await p.getByRole('region', { name: '洗衣機現場檢查' }).getByTestId('washer-score').count() === 0 && await p.getByRole('button', { name: '啟用洗衣機／洗衣塔現場檢查' }).count() === 1, '沒選洗衣機：洗衣機檢查只顯示啟用連結')
  check(await F.locator('[data-finding="install:none"][data-level="confirm"]').count() === 1, '不會預設用陽台當冰箱位置 → 必須人工確認')

  console.log('— 一鍵新增「冰箱安裝位置」')
  await F.getByRole('button', { name: /新增「冰箱安裝位置」區域/ }).click()
  check(await until(async () => (await p.getByRole('region', { name: '區域 冰箱安裝位置' }).count()) === 1), '新增區域「冰箱安裝位置」')
  check(await until(async () => (await F.locator('#fridge-install-area option:checked').innerText()).startsWith('冰箱安裝位置')), '自動設為冰箱的安裝位置')
  check(await until(async () => (await F.locator('[data-finding="install:dims"]').count()) === 1), '尚未量寬深高 → 必須人工確認')

  console.log('— 填寫尺寸與條件')
  const dim = async (area, label, v) => { const i = p.getByRole('region', { name: `區域 ${area}` }).locator('input[data-dim]').nth({ 寬: 0, 深: 1, 高: 2 }[label]); await i.fill(String(v)); await i.blur() }
  await dim('冰箱安裝位置', '寬', 100); await dim('冰箱安裝位置', '深', 85); await dim('冰箱安裝位置', '高', 182)
  await dim('電梯', '寬', 100); await dim('電梯', '深', 150); await dim('電梯', '高', 170)
  const choose = async (f, v) => { await F.locator(`[data-field="${f}"][data-value="${v}"]`).click(); await p.waitForTimeout(150) }
  const type = async (f, v) => { const i = F.locator(`input[data-field="${f}"]`); await i.fill(String(v)); await i.blur(); await p.waitForTimeout(150) }
  check(await F.locator('input[data-field="water_source_distance_cm"]').count() === 0 && await F.locator('[data-shot="fridge_water"]').count() === 0, '不需要進水管時，不顯示水源距離與水源照片')
  await choose('side_walls', 'both'); await type('front_clearance_cm', 50); await choose('door_obstacle', 'no')
  await choose('outlet', 'yes'); await type('outlet_distance_cm', 80); await choose('outlet_grounded', 'yes'); await choose('dedicated_circuit', 'yes')
  await choose('water_line', 'yes')
  check(await F.locator('input[data-field="water_source_distance_cm"]').count() === 1 && await F.locator('[data-shot="fridge_water"]').count() === 1, '選「需要」進水管 → 出現水源距離與水源照片')
  await type('water_source_distance_cm', 150)
  await choose('floor_level', 'yes'); await choose('heat_source', 'no')
  const has = (id, level) => until(async () => (await F.locator(`[data-finding="${id}"][data-level="${level}"]`).count()) === 1, 5000)
  check(await has(`install:width:${M}`, 'caution'), '寬 100 < 91.2 + 左右各 5 → 注意事項')
  check(await F.locator(`[data-finding="install:depth:${M}"]`).count() === 0, '深 85 ≥ 73.5 + 5 → 不提醒')
  check(await has(`install:height:${M}`, 'caution'), '高 182 < 179 + 上方 5 → 注意事項')
  check(await has(`door:width:${M}`, 'caution'), '嵌入寬 100 < 門開 90 度總寬 144.2 → 注意（抽屜可能拿不出來）')
  check(await has(`door:${M}:door_open_90_depth`, 'high'), '門開 90 度需凸出 52.5、前方只有 50 → 高風險')
  check(await has(`door:${M}:drawer_open_depth`, 'caution'), '抽屜全開需凸出 67.1 → 注意')
  check(await has(`water:nospec:${M}`, 'confirm'), '產品沒有進水管長度 → 必須人工確認')
  check(await until(async () => (await F.locator(`[data-finding$=":${M}:h"][data-level="high"]`).count()) === 1, 5000), '電梯高 170 < 機身 179 → 高風險（冰箱需直立搬運）')
  check(await F.locator('[data-finding="fields:missing"]').count() === 0, '必要欄位都填寫後不再提示')
  check((await F.locator('[data-finding]').first().getAttribute('data-level')) === 'high', '高風險排在最前面')

  console.log('— 修正後即時更新')
  await type('front_clearance_cm', 70)
  check(await until(async () => (await F.locator('[data-finding^="door:GR-AQC82BS:"]').count()) === 0, 5000), '前方改為 70 cm → 門片與抽屜提醒消失')

  console.log('— 拍攝清單')
  const before = await F.getByTestId('fridge-score').innerText()
  const chooser = p.waitForEvent('filechooser')
  await F.getByRole('button', { name: '拍攝 安裝空間正面' }).click()
  await (await chooser).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: ICON })
  check(await until(async () => (await F.locator('[data-shot="fridge_space_front"]').getAttribute('data-done')) === '1', 8000), '拍完「安裝空間正面」後勾選完成')
  const fa = p.getByRole('region', { name: '區域 冰箱安裝位置' })
  check(await until(async () => (await fa.getByLabel('照片 1 說明').inputValue().catch(() => '')) === '安裝空間正面'), '照片存到「冰箱安裝位置」並自動填上說明')
  check(await p.getByRole('region', { name: '區域 陽台' }).getByLabel('照片 1 說明').count() === 0, '照片沒有誤存到陽台')
  check(await until(async () => (await F.getByTestId('fridge-score').innerText()) !== before), `完成度提高（${before} → ${await F.getByTestId('fridge-score').innerText()}）`)
  await synced(p)
  await p.screenshot({ path: S + '/fridge-1-detail.png', fullPage: true })

  console.log('— 雲端與另一台裝置')
  const cloud = await p.evaluate(async (KEY) => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const t = JSON.parse(localStorage.getItem(k)).access_token
    const h = { apikey: KEY, Authorization: 'Bearer ' + t }
    return await (await fetch('https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1/survey_templates?select=template_id,template_version,install_area_id,values,surveys(customer_name)&order=created_at.desc&limit=5', { headers: h })).json()
  }, process.env.HSP_ANON_KEY)
  const mine = cloud.find((x) => x.surveys?.customer_name === name)
  check(mine && mine.template_id === 'fridge' && mine.install_area_id && mine.values.side_walls === 'both' && mine.values.water_line === 'yes', '雲端保存冰箱模板欄位值與安裝位置')
  const b = await device(browser, catalog); const q = b.page
  await q.getByText(name, { exact: true }).first().click({ timeout: 30000 }); await q.getByRole('heading', { name, exact: true }).waitFor()
  const F2 = q.getByRole('region', { name: '冰箱現場檢查' })
  await expand(F2)
  check(await until(async () => (await F2.locator('input[data-field="front_clearance_cm"]').inputValue().catch(() => '')) === '70', 30000), '另一台裝置同步看到欄位值')
  check(await until(async () => (await F2.locator('#fridge-install-area option:checked').innerText().catch(() => '')).startsWith('冰箱安裝位置'), 30000), '另一台裝置使用相同的安裝位置')
  const f1 = await F.locator('[data-finding]').evaluateAll((e) => e.map((x) => x.dataset.finding.replace(/route:[^:]+:/, 'route:')).join(','))
  const f2 = await F2.locator('[data-finding]').evaluateAll((e) => e.map((x) => x.dataset.finding.replace(/route:[^:]+:/, 'route:')).join(','))
  check(f1 === f2, '兩台裝置檢查結果相同')
  await b.ctx.close()

  console.log('— 報告與備份')
  await p.getByRole('button', { name: '產生場勘報告' }).click()
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 })
  check(!warns.some((w) => w.includes('[report]')), '報告各頁沒有內容超出版面' + (warns.filter((w) => w.includes('[report]')).join(';')))
  const src = await p.locator('main ul li img').first().getAttribute('src')
  const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
  fs.writeFileSync(S + '/fridge-report-p1.png', Buffer.from(b64, 'base64'))
  check(true, '報告第 1 頁已輸出（含冰箱檢查結果，見截圖）')
  await p.goto(URL + '#/settings'); await p.getByRole('heading', { name: '設定' }).waitFor()
  const dl = p.waitForEvent('download', { timeout: 120000 }); await p.getByRole('button', { name: /只匯出資料/ }).click()
  const jf = S + '/fridge-backup.json'; await (await dl).saveAs(jf)
  const bj = JSON.parse(fs.readFileSync(jf, 'utf8'))
  const sv = bj.surveys.find((x) => x.customer_name === name)
  check(bj.templates.some((t) => t.survey_id === sv.id && t.template_id === 'fridge' && t.values.front_clearance_cm === 70) && bj.photos.some((x) => x.survey_id === sv.id && x.shot_key === 'fridge_space_front'), '備份包含冰箱模板欄位值與照片拍攝項目')

  console.log('— 清理：刪除測試場勘')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('button', { name: '刪除這筆場勘' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor()
  await synced(p)
  check(true, '已刪除測試場勘')
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
