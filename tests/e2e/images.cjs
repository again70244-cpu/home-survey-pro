/**
 * 產品圖片：imgbb 逾時時自動重試、只快取成功的圖片、清除舊版可能存了錯誤圖的快取
 * 使用正式產品知識庫（真實 imgbb 圖片，需要能連到 i.ibb.co）
 * 用法：node tests/e2e/images.cjs <工作資料夾>
 */
const { chromium, devices } = require('playwright')
const URL = 'http://localhost:4174/'
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m) }
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)) } return false }
async function login(p) {
  await p.goto(URL); await p.getByLabel('Email').fill('hsp-test-a@example.com'); await p.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW)
  await p.getByRole('button', { name: '登入' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 30000 })
}
async function openProduct(p, model) {
  await p.goto(URL + '#/catalog'); await p.getByLabel('搜尋產品型號').waitFor({ timeout: 30000 })
  await until(async () => (await p.getByText(model, { exact: true }).count()) > 0, 60000)
  await p.getByLabel('搜尋產品型號').fill(model.slice(-6)); await p.getByText(model, { exact: true }).first().click()
}
const imgs = (p) => p.locator('main img').evaluateAll((es) => es.map((e) => ({ src: e.src, w: e.naturalWidth, done: e.complete })))

;(async () => {
  const browser = await chromium.launch()

  console.log('— imgbb 逾時：自動重試後正常顯示（不經過 Service Worker）')
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' })
    let failed = 0
    await ctx.route('https://i.ibb.co/xtshnSJk/**', (r) => (failed++ === 0 ? r.fulfill({ status: 504, contentType: 'text/html', body: '<html>504 Gateway Time-out</html>' }) : r.continue()))
    const p = await ctx.newPage(); await login(p); await openProduct(p, 'WD-S2220B')
    check(await until(async () => (await imgs(p)).some((i) => i.src.includes('xtshnSJk') && i.w === 1339), 90000), '第一次 504，重試後顯示正常圖片（1339 px 寬）')
    check(failed >= 2, `確實重試了（請求 ${failed} 次）`)
    await ctx.close()
  }

  console.log('— Service Worker：清除舊快取、只快取成功的圖片')
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] })
    const p = await ctx.newPage(); await login(p)
    await until(async () => p.evaluate(() => !!navigator.serviceWorker.controller), 30000) || (await p.reload(), await until(async () => p.evaluate(() => !!navigator.serviceWorker.controller), 30000))
    // 模擬舊版：舊快取裡存了一張錯誤圖
    await p.evaluate(async () => { const c = await caches.open('product-images'); await c.put('https://i.ibb.co/xtshnSJk/LG-AI-WD-S2220-B.png', new Response('<html>504</html>', { headers: { 'content-type': 'text/html' } })) })
    check(await p.evaluate(() => caches.has('product-images')), '（模擬）舊快取存在')
    await p.reload(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 30000 })
    check(await until(async () => !(await p.evaluate(() => caches.has('product-images')))), '開啟 App 後自動刪除舊快取')
    await openProduct(p, 'WD-S2220B')
    check(await until(async () => (await imgs(p)).filter((i) => i.w > 0).length >= 2, 120000), '產品頁兩張圖片都正常顯示')
    const cached = await until(async () => p.evaluate(async () => { const c = await caches.open('product-images-v2'); return (await c.keys()).length >= 2 }), 30000)
    const entries = await p.evaluate(async () => { const c = await caches.open('product-images-v2'); return Promise.all((await c.keys()).map(async (k) => { const r = await c.match(k); return [k.url.split('/')[3], r.status, r.headers.get('content-type')] })) })
    check(cached && entries.every(([, s, t]) => s === 200 && /^image\//.test(t)), '新快取只存成功的圖片：' + JSON.stringify(entries))
    await ctx.close()
  }

  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1) })
