/**
 * Phase 3：場勘選擇產品、規格快照
 * 產品知識庫使用 catalog-fixtures.mts 產生的測試資料（攔截 catalog_* 請求），場勘資料走真實 Supabase。
 * 用法：node tests/e2e/products.cjs <工作資料夾>（需先產生 <工作資料夾>/p2/fixtures.json）
 */
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path')
const S = process.argv[2]; const URL = 'http://localhost:4174/'
const FX = JSON.parse(fs.readFileSync(S + '/p2/fixtures.json', 'utf8'))
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m) }
const waitCount = async (loc, n, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await loc.count() === n) return true; await new Promise((r) => setTimeout(r, 200)) } return false }
const seen = (p, t, n = 15000) => p.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false)
const synced = async (p) => {
  try { await p.getByText(/^雲端已同步・/).first().waitFor({ timeout: 60000 }) } catch (e) {
    const out = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => res(q.result.map((x) => [x.table, x.attempts, x.lastError])) } }))
    console.log('  [同步未完成] 狀態：', (await p.locator('main').innerText()).slice(0, 200).replace(/\n+/g, ' | '))
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
const snapWidth = (p, name, model) => p.evaluate(([n, m]) => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const t = r.result.transaction(['surveys', 'survey_products']); const s = t.objectStore('surveys').getAll(); const sp = t.objectStore('survey_products').getAll(); t.oncomplete = () => { const sv = s.result.find((x) => x.customer_name === n); res(sp.result.filter((x) => x.survey_id === sv?.id && !x.deleted_at && x.model_code === m).map((x) => x.spec_snapshot.width_cm)) } } }), [name, model])

;(async () => {
  const browser = await chromium.launch()
  const catalog = { products: JSON.parse(JSON.stringify(FX.products)), runs: FX.runs }
  // 產品 ID 對應到正式產品知識庫中同型號的真實 ID（survey_products 有外鍵指向 catalog_products）
  {
    const tmp = await browser.newContext(); const tp = await tmp.newPage(); await tp.goto(URL)
    const live = await tp.evaluate(async ([KEY, PW]) => {
      const SB = 'https://kmcnowfjzrppntgktyjq.supabase.co'
      const tok = (await (await fetch(SB + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'hsp-test-a@example.com', password: PW }) })).json()).access_token
      return await (await fetch(SB + '/rest/v1/catalog_products?select=id,model_code', { headers: { apikey: KEY, Authorization: 'Bearer ' + tok } })).json()
    }, [process.env.HSP_ANON_KEY, process.env.HSP_TEST_A_PW])
    await tmp.close()
    const byModel = new Map(live.map((x) => [x.model_code, x.id]))
    for (const x of catalog.products) if (byModel.has(x.model_code)) x.id = byModel.get(x.model_code)
    console.log('  對應到正式產品 ID：', catalog.products.filter((x) => byModel.has(x.model_code)).length, '/', catalog.products.length)
  }
  const a = await device(browser, catalog); const p = a.page
  const warns = []; p.on('console', (m) => warns.push(m.text()))
  const name = '產品選擇測試-' + Date.now().toString().slice(-5)

  console.log('— 建立場勘時選擇產品')
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s2220b')
  await p.getByRole('button', { name: '選擇 WD-S2220B' }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('25N')
  check(await waitCount(p.getByRole('dialog').getByRole('button', { name: /^選擇 / }), 0), '搜尋不到的型號沒有結果')
  await p.getByLabel('搜尋要選擇的產品').fill('sd250')
  await p.getByRole('button', { name: '選擇 WT-SD250HB' }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  check((await p.getByLabel('已選擇的產品').innerText()).includes('WD-S2220B') && (await p.getByLabel('已選擇的產品').innerText()).includes('寬 70・高 189・深 83'), '表單中顯示已選產品與尺寸')
  check(await p.getByLabel('產品型號').inputValue() === 'WD-S2220B', '自動帶入產品型號文字')
  await p.screenshot({ path: S + '/p3-1-form.png', fullPage: true })
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()
  const sec = p.getByRole('region', { name: '安裝產品' })
  check(await sec.getByRole('listitem', { name: '安裝產品 WD-S2220B' }).count() === 1 && await sec.getByRole('listitem', { name: '安裝產品 WT-SD250HB' }).count() === 1, '場勘頁顯示 2 個安裝產品')
  const card = await sec.getByRole('listitem', { name: '安裝產品 WD-S2220B' }).innerText()
  check(/寬\s*70/.test(card) && /高\s*189/.test(card) && /深\s*83/.test(card) && card.includes('規格快照'), '自動帶入規格（寬 70、高 189、深 83）並標示規格快照時間')
  await sec.getByRole('listitem', { name: '安裝產品 WD-S2220B' }).getByRole('button', { name: '完整規格' }).click()
  check((await sec.innerText()).includes('門開 90 度總深') && (await sec.innerText()).includes('146 cm'), '可展開完整規格')

  console.log('— 在場勘頁追加與移除產品')
  await sec.getByRole('button', { name: /從產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('lsu22')
  await p.getByRole('button', { name: '選擇 LSU22DHST/LSN22DDHST' }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s2220b')
  check(await p.getByRole('button', { name: '選擇 WD-S2220B' }).innerText().then((t) => t.includes('已選')), '已選過的產品標示「已選」，不會重複加入')
  await p.getByRole('button', { name: '完成', exact: true }).click()
  check(await sec.getByText('此產品在試算表中沒有安裝尺寸').count() === 1, '缺少安裝資料的產品：明確提示，不顯示 0')
  await sec.getByRole('button', { name: '移除產品 WT-SD250HB' }).click(); await p.waitForTimeout(300)
  check(await sec.getByRole('listitem', { name: '安裝產品 WT-SD250HB' }).count() === 0, '移除產品')
  await synced(p)
  await p.screenshot({ path: S + '/p3-2-detail.png', fullPage: true })

  console.log('— 另一台裝置同步看到快照')
  const b = await device(browser, catalog); const q = b.page
  await synced(q); await q.getByText(name).first().click(); await q.getByRole('heading', { name }).waitFor()
  const qs = q.getByRole('region', { name: '安裝產品' })
  await qs.getByRole('listitem', { name: '安裝產品 WD-S2220B' }).waitFor({ timeout: 20000 })
  check(await qs.getByRole('listitem').count() === 2 && /寬\s*70/.test(await qs.getByRole('listitem', { name: '安裝產品 WD-S2220B' }).innerText()), '第二台裝置看到 2 個產品與快照規格')
  await b.ctx.close()

  console.log('— Google Sheets 更新尺寸：舊案件快照不變，新案件用新規格')
  const w = catalog.products.find((x) => x.model_code === 'WD-S2220B')
  w.width_cm = 71; w.spec_hash = 'changed-hash'; w.spec_updated_at = '2026-11-24T08:00:00Z'
  catalog.runs = [{ id: 'run-new', status: 'success', trigger: 'edit', finished_at: '2026-11-24T08:00:00Z', error: null, counts: {} }]
  await p.goto(URL + '#/catalog'); await p.getByRole('heading', { name: 'LG 產品知識庫' }).waitFor()
  await p.getByRole('button', { name: '重新整理' }).click(); await p.waitForTimeout(1500)
  await p.getByLabel('搜尋產品型號').fill('S2220B'); await p.getByText('WD-S2220B', { exact: true }).first().click()
  check(/寬\s*71/.test(await p.getByLabel('安裝資訊').innerText()), '產品知識庫已更新為寬 71')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('region', { name: '安裝產品' }).getByRole('listitem', { name: '安裝產品 WD-S2220B' }).waitFor({ timeout: 15000 })
  // 「產品資料已更新」提示要等本機產品知識庫載入後才出現，先等它再讀取
  await p.getByRole('region', { name: '安裝產品' }).getByRole('listitem', { name: '安裝產品 WD-S2220B' }).getByText(/產品資料已於/).waitFor({ timeout: 15000 }).catch(() => {})
  const old = await p.getByRole('region', { name: '安裝產品' }).getByRole('listitem', { name: '安裝產品 WD-S2220B' }).innerText()
  check(/寬\s*70/.test(old) && !/寬\s*71/.test(old), '舊案件仍是選擇當時的寬 70（快照不變）')
  check(old.includes('產品資料已於') && old.includes('此案件保留選擇當時的規格'), '舊案件提示「產品資料已更新，保留選擇當時的規格」')
  check(JSON.stringify(await snapWidth(p, name, 'WD-S2220B')) === '[70]', '本機資料庫中的快照仍是 70')
  const name2 = name + '-新'
  await p.goto(URL); await p.getByRole('button', { name: '新增場勘' }).click(); await p.getByLabel('客戶姓名').fill(name2)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click(); await p.getByLabel('搜尋要選擇的產品').fill('s2220b')
  await p.getByRole('button', { name: '選擇 WD-S2220B' }).click(); await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name: name2 }).waitFor()
  await p.getByRole('region', { name: '安裝產品' }).getByRole('listitem', { name: '安裝產品 WD-S2220B' }).waitFor({ timeout: 15000 })
  check(/寬\s*71/.test(await p.getByRole('region', { name: '安裝產品' }).innerText()), '新案件選擇同一產品 → 帶入新規格寬 71')
  await synced(p)
  // 雲端也保持各自的快照
  const cloud = await p.evaluate(async ([n1, n2, KEY]) => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const t = JSON.parse(localStorage.getItem(k)).access_token
    const r = await fetch('https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1/survey_products?select=model_code,spec_snapshot,surveys(customer_name)&model_code=eq.WD-S2220B&deleted_at=is.null', { headers: { apikey: KEY, Authorization: 'Bearer ' + t } })
    const rows = await r.json(); return rows.filter((x) => [n1, n2].includes(x.surveys.customer_name)).map((x) => [x.surveys.customer_name === n1 ? 'old' : 'new', x.spec_snapshot.width_cm])
  }, [name, name2, process.env.HSP_ANON_KEY])
  check(JSON.stringify(cloud.sort()) === JSON.stringify([['new', 71], ['old', 70]]), '雲端：舊案件快照 70、新案件快照 71 ' + JSON.stringify(cloud))

  console.log('— 報告與備份')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('button', { name: '產生場勘報告' }).click()
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 })
  await p.locator('main ul li img').first().screenshot({ path: S + '/p3-3-report-p1.png' })
  check(!warns.some((w) => w.includes('[report]')), '報告各頁沒有內容超出版面' + (warns.length ? ' ' + warns.join(';') : ''))
  const src = await p.locator('main ul li img').first().getAttribute('src')
  const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
  fs.writeFileSync(S + '/p3-report-page1.png', Buffer.from(b64, 'base64'))
  check(true, '報告第 1 頁已輸出（含安裝產品規格，見截圖）')
  await p.goto(URL + '#/settings'); await p.getByRole('heading', { name: '設定' }).waitFor()
  const dl = p.waitForEvent('download', { timeout: 120000 }); await p.getByRole('button', { name: /只匯出資料/ }).click()
  const jf = S + '/p3-backup.json'; await (await dl).saveAs(jf)
  const bj = JSON.parse(fs.readFileSync(jf, 'utf8'))
  const mine = bj.products.filter((x) => x.model_code === 'WD-S2220B').map((x) => x.spec_snapshot.width_cm)
  check(bj.version >= 2 && mine.includes(70) && mine.includes(71), '備份包含產品快照（70 與 71 各自保存）')
  await p.getByTestId('restore-input').setInputFiles(jf); await p.getByRole('dialog', { name: '確認還原' }).waitFor()
  check(await seen(p, '備份中的資料都已存在'), '重複還原：產品快照不重複建立')
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
