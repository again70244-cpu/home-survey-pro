/**
 * 產品類型對應與手動修正規格：適用檢查選擇、修正規格編輯、檢查與報告使用修正值、同步
 * 產品知識庫使用 catalog-fixtures.mts 產生的測試資料（攔截 catalog_* 請求），場勘資料走真實 Supabase。
 * 用法：node tests/e2e/washer.cjs <工作資料夾>（需先產生 <工作資料夾>/p2/fixtures.json）
 * 測試產品 WD-S13VDW（洗衣機，寬 60）與 LSU22DHST/LSN22DDHST（冷氣，產品知識庫沒有安裝尺寸）
 */
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path')
const S = process.argv[2]; const URL = 'http://localhost:4174/'
const FX = JSON.parse(fs.readFileSync(S + '/p2/fixtures.json', 'utf8'))
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m) }
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)) } return false }
const openData = async (R) => { const t = R.locator('[data-light="data"]'); await t.waitFor({ timeout: 15000 }); if ((await t.getAttribute('aria-selected')) !== 'true') await t.click() }
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
  const name = '規格修正測試-' + Date.now().toString().slice(-5)
  const WM = 'WD-S13VDW', AC = 'LSU22DHST/LSN22DDHST'

  console.log('— 適用檢查：自動判斷與手動指定')
  await p.getByRole('button', { name: '新增場勘' }).click()
  await p.getByLabel('客戶姓名').fill(name)
  await p.getByRole('button', { name: /從 LG 產品知識庫選擇/ }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('s13vdw'); await p.getByRole('button', { name: '選擇 ' + WM }).click()
  await p.getByLabel('搜尋要選擇的產品').fill('lsu22'); await p.getByRole('button', { name: '選擇 ' + AC }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor()
  await p.getByRole('button', { name: /^產品與資料/ }).click() // 產品規格收在「產品與資料」
  const sel = (m) => p.getByLabel(`${m} 適用檢查`)
  const W = p.getByRole('region', { name: '洗衣機現場檢查' }), F = p.getByRole('region', { name: '冰箱現場檢查' })
  check(await until(async () => (await sel(WM).locator('option:checked').innerText()) === '自動（洗衣機）'), '洗衣機產品：自動對應洗衣機檢查')
  check((await sel(AC).locator('option:checked').innerText()) === '自動（不檢查）', '冷氣：目前沒有對應的檢查')
  check(await until(async () => (await W.getByTestId('washer-score').count()) === 1), '洗衣機檢查自動出現')
  await sel(WM).selectOption('none')
  check(await until(async () => (await W.getByTestId('washer-score').count()) === 0 && (await p.getByRole('button', { name: '啟用洗衣機／洗衣塔現場檢查' }).count()) === 1), '改為「不檢查」→ 洗衣機檢查收起')
  await sel(WM).selectOption('')
  check(await until(async () => (await W.getByTestId('washer-score').count()) === 1), '改回自動 → 洗衣機檢查恢復')
  await sel(AC).selectOption('fridge')
  check(await until(async () => (await F.getByTestId('fridge-score').count()) === 1), '冷氣指定為冰箱檢查 → 冰箱檢查出現（測試手動指定）')
  check(await until(async () => (await F.locator(`[data-finding="spec:${AC}"][data-level="confirm"]`).count()) === 1), '產品沒有機身尺寸 → 必須人工確認，並建議修正規格')
  await openData(F)
  check((await F.locator(`[data-finding="spec:${AC}"]`).innerText()).includes('修正規格'), '建議文字提到「修正規格」')

  console.log('— 手動修正規格')
  const card = (m) => p.getByRole('listitem', { name: `安裝產品 ${m}` })
  const showInfo = openData
  check((await card(AC).innerText()).includes('可按「修正規格」輸入'), '沒有尺寸的產品提示可手動輸入')
  await p.getByRole('button', { name: `修正 ${AC} 規格` }).click()
  const ed = p.getByRole('group', { name: `修正 ${AC} 規格` })
  await ed.locator('[data-override="width_cm"]').fill('83'); await ed.locator('[data-override="depth_cm"]').fill('75'); await ed.locator('[data-override="height_cm"]').fill('179')
  await ed.getByLabel('修正資料來源').fill('現場實測')
  await ed.getByRole('button', { name: '儲存修正' }).click()
  check(await until(async () => (await card(AC).locator('[data-spec="width_cm"][data-manual="1"]').innerText().catch(() => '')).includes('83')), '產品卡片顯示修正後寬 83，並標示「手動」')
  check((await card(AC).getByTestId('manual-note').innerText()).includes('現場實測'), '顯示修正來源')
  check(await until(async () => (await F.locator(`[data-finding="spec:${AC}"]`).count()) === 0), '修正後不再提示缺少尺寸')
  await showInfo(F)
  check(await until(async () => (await F.locator(`[data-finding="manual:${AC}"][data-level="info"]`).count()) === 1), '檢查結果標示「部分規格為手動修正」（一般提醒）')

  console.log('— 修正值會改變檢查結果（洗衣機寬度）')
  const expandAreas = async () => { const b = p.getByRole('button', { name: '展開全部區域' }); await until(async () => (await b.count()) === 1, 10000); if (await b.count()) await b.click() }
  await p.getByRole('button', { name: '新增區域' }).click(); await p.getByRole('button', { name: '陽台', exact: true }).click(); await p.getByRole('region', { name: '區域 陽台' }).waitFor()
  const dim = async (area, k, v) => { const i = p.getByRole('region', { name: `區域 ${area}` }).locator('input[data-dim]').nth(k); await i.fill(String(v)); await i.blur() }
  await dim('陽台', 0, 66); await dim('陽台', 1, 80); await dim('陽台', 2, 200)
  check(await until(async () => (await W.locator('[data-finding="install:width"]').count()) === 0), '寬 66 ≥ 機身 60 + 4 → 不提醒')
  await p.getByRole('button', { name: `修正 ${WM} 規格` }).click()
  const ed2 = p.getByRole('group', { name: `修正 ${WM} 規格` })
  check((await ed2.locator('[data-override="width_cm"]').getAttribute('placeholder')) === '60', '編輯時顯示產品知識庫原值 60')
  await ed2.locator('[data-override="width_cm"]').fill('70'); await ed2.getByRole('button', { name: '儲存修正' }).click()
  check(await until(async () => (await W.locator('[data-finding="install:width"][data-level="high"]').count()) === 1), '寬改為 70 → 66 放不下，高風險')
  await showInfo(W)
  check(await until(async () => (await W.locator(`[data-finding="manual:${WM}"]`).innerText().catch(() => '')).includes('原 60 cm')), '提醒中列出原值 60')
  await p.getByRole('button', { name: `修正 ${WM} 規格` }).click()
  await p.getByRole('group', { name: `修正 ${WM} 規格` }).getByRole('button', { name: '清除所有手動修正' }).click()
  check(await until(async () => (await W.locator('[data-finding="install:width"]').count()) === 0 && (await W.locator(`[data-finding="manual:${WM}"]`).count()) === 0), '清除修正 → 回到知識庫數值，結果恢復')
  await p.getByRole('button', { name: `修正 ${AC} 規格` }).click()
  await p.getByRole('group', { name: `修正 ${AC} 規格` }).locator('[data-override="width_cm"]').fill('abc')
  await p.getByRole('group', { name: `修正 ${AC} 規格` }).getByRole('button', { name: '儲存修正' }).click()
  check(await p.getByText('請輸入 0～2000 的數字').count() === 1, '輸入非數字會提示，不會儲存')
  await p.getByRole('group', { name: `修正 ${AC} 規格` }).getByRole('button', { name: '取消' }).click()
  check(await until(async () => (await card(AC).locator('[data-spec="width_cm"]').innerText()).includes('83')), '取消後保留原本的修正值')
  await synced(p)
  await p.screenshot({ path: S + '/override-1-detail.png', fullPage: true })

  console.log('— 雲端與另一台裝置')
  const cloud = await p.evaluate(async ([KEY, n]) => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token')); const t = JSON.parse(localStorage.getItem(k)).access_token
    const r = await fetch('https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1/survey_products?select=model_code,template_type,spec_overrides,spec_snapshot,surveys!inner(customer_name)&surveys.customer_name=eq.' + encodeURIComponent(n), { headers: { apikey: KEY, Authorization: 'Bearer ' + t } })
    return await r.json()
  }, [process.env.HSP_ANON_KEY, name])
  const ac = cloud.find((x) => x.model_code === AC), wm = cloud.find((x) => x.model_code === WM)
  check(ac && ac.template_type === 'fridge' && ac.spec_overrides?.fields?.width_cm === 83 && ac.spec_overrides?.note === '現場實測', '雲端保存手動修正與適用檢查')
  check(ac && ac.spec_snapshot.width_cm == null && wm && wm.spec_overrides == null && wm.template_type == null, '雲端規格快照保持原樣；清除後為空')
  const b = await device(browser, catalog); const q = b.page
  await q.getByText(name, { exact: true }).first().click({ timeout: 30000 }); await q.getByRole('heading', { name, exact: true }).waitFor(); await q.getByRole('button', { name: /^產品與資料/ }).click()
  check(await until(async () => (await q.getByRole('listitem', { name: `安裝產品 ${AC}` }).locator('[data-spec="width_cm"][data-manual="1"]').innerText().catch(() => '')).includes('83'), 30000), '另一台裝置看到手動修正')
  check(await until(async () => (await q.getByRole('region', { name: '冰箱現場檢查' }).getByTestId('fridge-score').count()) === 1, 30000), '另一台裝置也套用「冰箱」檢查')
  await b.ctx.close()

  console.log('— 報告')
  await p.getByRole('button', { name: '產生場勘報告' }).click()
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 })
  check(!warns.some((w) => w.includes('[report]')), '報告各頁沒有內容超出版面' + (warns.filter((w) => w.includes('[report]')).join(';')))
  const imgs = p.locator('main ul li img'); const nImg = await imgs.count()
  for (let i = 0; i < Math.min(nImg, 2); i++) {
    const src = await imgs.nth(i).getAttribute('src')
    const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) }) }, src)
    fs.writeFileSync(S + `/override-report-p${i + 1}.png`, Buffer.from(b64, 'base64'))
  }
  check(nImg > 0, `報告已輸出 ${nImg} 頁（產品規格標示手動修正，見截圖）`)

  console.log('— 清理：刪除測試場勘')
  await p.goto(URL); await p.getByText(name, { exact: true }).first().click(); await p.getByRole('heading', { name, exact: true }).waitFor()
  await p.getByRole('button', { name: '編輯', exact: true }).click(); await p.getByRole('button', { name: '刪除這筆場勘' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor()
  await synced(p)
  check(true, '已刪除測試場勘')
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
