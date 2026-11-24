/**
 * 報告施工版與客戶版：內容差異（電話地址、內部項目、現場欄位、改寫後的客戶說明、照片範圍）
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
  await ctx.route('https://i.ibb.co/**', (r) => r.fulfill({ contentType: 'image/png', body: ICON, headers: { 'access-control-allow-origin': '*' } }))
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
  const name = '報告版本測試-' + Date.now().toString().slice(-5)
  const PHONE = '0912345678', ADDR = '台北市測試路1號', NOTE = '內部備註ABC'

  console.log('— 準備場勘資料')
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name); await p.getByLabel('聯絡電話').fill(PHONE); await p.getByLabel('客戶地址').fill(ADDR); await p.getByLabel('備註').fill(NOTE)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s13vdw'); await p.getByRole('button', { name: '選擇 WD-S13VDW' }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()
  const W = p.getByRole('region', { name: '洗衣機現場檢查' })
  await until(async () => (await W.getByTestId('washer-score').count()) === 1)
  await expand(W)
  const expandAreas = async () => { const b = p.getByRole('button', { name: '展開全部區域' }); await until(async () => (await b.count()) === 1, 10000); if (await b.count()) await b.click() }
  await expandAreas()
  const dim = async (area, k, v) => { const i = p.getByRole('region', { name: `區域 ${area}` }).locator('input[data-dim]').nth(k); await i.fill(String(v)); await i.blur() }
  await dim('陽台', 0, 62); await dim('陽台', 1, 80); await dim('陽台', 2, 200)
  const choose = async (f, v) => { await W.locator(`[data-field="${f}"][data-value="${v}"]`).click(); await p.waitForTimeout(150) }
  const type = async (f, v) => { const i = W.locator(`input[data-field="${f}"]`); await i.fill(String(v)); await i.blur(); await p.waitForTimeout(150) }
  await choose('stacked', 'no'); await type('front_clearance_cm', 80); await choose('door_obstacle', 'unsure')
  await choose('faucet', 'yes'); await type('faucet_distance_cm', 50); await choose('drain_type', 'floor'); await type('drain_distance_cm', 40)
  await choose('outlet', 'no'); await choose('floor_level', 'no')
  check(await until(async () => (await W.locator('[data-finding="outlet:none"][data-level="high"]').count()) === 1 && (await W.locator('[data-finding="door:obstacle"][data-level="confirm"]').count()) === 1), '檢查結果：高風險（沒有插座）＋必須人工確認（門片障礙物）')
  const chooser = p.waitForEvent('filechooser')
  await W.getByRole('button', { name: '拍攝 安裝空間正面' }).click()
  await (await chooser).setFiles({ name: 'a.png', mimeType: 'image/png', buffer: ICON })
  await until(async () => (await W.locator('[data-shot="space_front"]').getAttribute('data-done')) === '1', 8000)

  const reportText = async () => { await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 }); return { text: await p.locator('[data-report-pages]').innerText(), n: Number((await p.getByText(/已產生 \d+ 張報告圖片/).innerText()).match(/已產生 (\d+)/)[1]) } }

  console.log('— 施工版（預設）')
  await p.getByRole('button', { name: '產生場勘報告' }).click()
  const ins = await reportText()
  check((await p.getByRole('tab', { name: /施工版/ }).getAttribute('aria-selected')) === 'true', '預設產生施工版')
  check(ins.text.includes('施工場勘單') && ins.text.includes('家電場勘紀錄・施工版'), '封面與頁首標示施工版')
  check(ins.text.includes(PHONE) && ins.text.includes(ADDR), '施工版有聯絡電話與地址')
  check(ins.text.includes('施工前待處理（') && ins.text.includes('附近沒有插座') && ins.text.includes('不確定門片開啟範圍是否有障礙物'), '最前面列出「施工前待處理」（高風險與必須人工確認）')
  check(ins.text.includes('洗衣機現場條件') && ins.text.includes('安裝位置：陽台') && /地面平整\s*不平整/.test(ins.text) && /水龍頭到機器位置的距離\s*50 cm/.test(ins.text), '列出現場欄位與填寫值')
  check(!ins.text.includes('插座到機器位置的距離'), '不適用的欄位（沒有插座時的距離）不列出')
  check(ins.text.includes('拍攝清單（1 / 9）') && ins.text.includes('✓ 安裝空間正面') && ins.text.includes('未拍 插座'), '列出拍攝清單完成狀況')
  check(ins.text.includes('規則版本 washer v1') && ins.text.includes('依據：'), '保留規則版本與依據')
  check(ins.text.includes(NOTE) && ins.text.includes('樓梯'), '保留整體備註與所有區域')
  const pos = (t) => ins.text.indexOf(t)
  check(pos('施工前待處理') < pos('洗衣機現場檢查') && pos('洗衣機現場檢查') < pos('洗衣機現場條件'), '順序：待處理 → 檢查結果 → 現場條件')
  check(!warns.some((w) => w.includes('[report]')), '施工版各頁沒有內容超出版面')
  // 記錄 App 設定的下載檔名（無頭瀏覽器下載 blob 時會忽略檔名，實機不會）
  await p.evaluate(() => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = this.download; return orig.call(this) } })
  await p.getByRole('button', { name: '下載 ZIP' }).click()
  await until(async () => !!(await p.evaluate(() => window.__dl)))
  const fname = await p.evaluate(() => window.__dl)
  check(fname.startsWith('場勘報告_施工版_') && fname.endsWith('.zip'), '下載檔名標示施工版：' + fname)

  console.log('— 客戶版')
  await p.getByRole('tab', { name: /客戶版/ }).click()
  const cu = await reportText()
  check(p.url().includes('v=customer'), '網址記住客戶版')
  check(cu.text.includes('家電場勘紀錄・客戶版') && !cu.text.includes('施工場勘單'), '封面與頁首標示客戶版')
  check(!cu.text.includes(PHONE) && !cu.text.includes(ADDR), '客戶版沒有電話與地址')
  check(!cu.text.includes(NOTE), '客戶版沒有內部備註')
  check(cu.text.includes('洗衣機安裝評估') && cu.text.includes('有 1 個地方需要調整後才能安裝'), '結論：有 1 個地方需要調整')
  check(cu.text.includes('安裝前請先請水電師傅加裝插座') && cu.text.includes('地面不太平整') && cu.text.includes('安裝位置左右空間較緊'), '改寫成客戶看得懂的說明與建議')
  check(cu.text.includes('安裝人員會在安裝前與您確認'), '有待確認項目時，只說明會再確認')
  check(!cu.text.includes('必須人工確認') && !cu.text.includes('不確定門片開啟範圍') && !cu.text.includes('規則版本') && !cu.text.includes('依據：') && !cu.text.includes('施工前待處理'), '客戶版沒有內部檢查明細')
  check(!cu.text.includes('洗衣機現場條件') && !cu.text.includes('拍攝清單'), '客戶版沒有現場欄位與拍攝清單')
  check(!cu.text.includes('樓梯') && !cu.text.includes('電梯') && cu.text.includes('陽台'), '客戶版只放安裝位置（陽台），不放未測量的區域')
  check(!cu.text.includes('門開 90 度總深') && cu.text.includes('產品寬 W'), '產品規格只放主要尺寸')
  check(cu.n < ins.n, `客戶版頁數較少（${cu.n} 頁 < 施工版 ${ins.n} 頁）`)
  check(!warns.some((w) => w.includes('[report]')), '客戶版各頁沒有內容超出版面')
  const imgs = p.locator('main ul li img')
  for (let i = 0; i < Math.min(await imgs.count(), 3); i++) {
    const src = await imgs.nth(i).getAttribute('src')
    const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
    fs.writeFileSync(S + `/customer-report-p${i + 1}.png`, Buffer.from(b64, 'base64'))
  }
  await p.reload()
  check(await until(async () => (await p.getByRole('tab', { name: /客戶版/ }).getAttribute('aria-selected').catch(() => '')) === 'true', 30000), '重新整理後仍是客戶版')
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 })
  await p.getByRole('tab', { name: /施工版/ }).click()
  const ins2 = await reportText()
  check(ins2.text.includes(PHONE) && ins2.n === ins.n, '切回施工版內容與頁數相同')
  for (let i = 0; i < Math.min(await imgs.count(), 3); i++) {
    const src = await imgs.nth(i).getAttribute('src')
    const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
    fs.writeFileSync(S + `/installer-report-p${i + 1}.png`, Buffer.from(b64, 'base64'))
  }

  console.log('— 清理：刪除測試場勘')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('button', { name: '刪除這筆場勘' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor()
  await synced(p)
  check(true, '已刪除測試場勘')
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
