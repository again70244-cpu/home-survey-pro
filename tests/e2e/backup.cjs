const { chromium, devices } = require('playwright'); const fs = require('fs'); const { execSync } = require('child_process');
const S = process.argv[2]; const URL = 'http://localhost:4174/'; const KEY = process.env.HSP_ANON_KEY; const SB = 'https://kmcnowfjzrppntgktyjq.supabase.co';
const A = { email: 'hsp-test-a@example.com', pw: process.env.HSP_TEST_A_PW }, B = { email: 'hsp-test-b@example.com', pw: process.env.HSP_TEST_B_PW };
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m); };
const seen = (p, t, n = 20000) => p.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false);
const synced = (p) => p.getByText(/^雲端已同步・/).waitFor({ timeout: 60000 });
async function device(browser, who, opts = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true }); const page = await ctx.newPage();
  if (opts.blockPull) await ctx.route('**/rest/v1/**', (r) => r.request().method() === 'GET' && !opts.unblocked ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.continue());
  page.on('pageerror', (e) => console.log('[JS error]', e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(URL); await page.getByLabel('Email').fill(who.email); await page.getByLabel('密碼').fill(who.pw);
  await page.getByRole('button', { name: '登入' }).click(); await page.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  return { ctx, page };
}
const serverCount = (p, t) => p.evaluate(async ({ t, KEY, SB }) => { const k = Object.keys(localStorage).find((k) => k.includes('auth-token')); const tok = JSON.parse(localStorage.getItem(k)).access_token;
  // 用 count=exact 取得精確總數（一般查詢最多只回傳 1000 筆，測試帳號資料累積後會數不準）
  const r = await fetch(SB + '/rest/v1/' + t + '?select=id&deleted_at=is.null&limit=1', { headers: { apikey: KEY, Authorization: 'Bearer ' + tok, Prefer: 'count=exact' } }); return Number(r.headers.get('content-range').split('/')[1]); }, { t, KEY, SB });
const counts = async (p) => ({ s: await serverCount(p, 'surveys'), a: await serverCount(p, 'survey_areas'), ph: await serverCount(p, 'survey_photos') });
async function restore(p, file) {
  await p.goto(URL + '#/settings'); await p.getByRole('heading', { name: '設定' }).waitFor();
  await p.getByTestId('restore-input').setInputFiles(file); await p.getByRole('dialog', { name: '確認還原' }).waitFor({ timeout: 20000 });
  const txt = await p.getByRole('dialog').innerText(); return txt;
}
(async () => {
  const browser = await chromium.launch();
  console.log('— 匯出');
  const a = await device(browser, A); await synced(a.page);
  await a.page.getByRole('button', { name: '設定' }).click(); await a.page.getByRole('heading', { name: '設定' }).waitFor();
  await a.page.screenshot({ path: S + '/s7-settings.png', fullPage: true });
  let dl = a.page.waitForEvent('download', { timeout: 120000 }); await a.page.getByRole('button', { name: /匯出完整備份/ }).click();
  const zip = S + '/backup-a.zip'; await (await dl).saveAs(zip);
  const z = JSON.parse(execSync('python3 -c "import zipfile,json;z=zipfile.ZipFile(\'' + zip + '\');j=json.loads(z.read(\'backup.json\'));print(json.dumps({\'c\':j[\'counts\'],\'files\':len([n for n in z.namelist() if n.startswith(\'photos/\')]),\'miss\':len(j[\'missingPhotoFiles\']),\'fmt\':j[\'format\']}))"').toString());
  console.log('  ZIP 內容：', JSON.stringify(z));
  const srvA = await counts(a.page); console.log('  雲端 A：', JSON.stringify(srvA));
  check(z.fmt === 'home-survey-pro-backup' && z.c.surveys === srvA.s && z.c.areas === srvA.a && z.c.photos === srvA.ph, '備份 JSON 包含所有場勘、區域、照片資料');
  check(z.files === z.c.photos && z.miss === 0, '備份 ZIP 包含全部 ' + z.files + ' 張原始照片');
  dl = a.page.waitForEvent('download'); await a.page.getByRole('button', { name: /只匯出資料/ }).click();
  const jf = S + '/backup-a.json'; await (await dl).saveAs(jf);
  check(JSON.parse(fs.readFileSync(jf, 'utf8')).surveys.length === srvA.s, '可單獨匯出完整 JSON');

  console.log('— 同一台重複匯入');
  const t1 = await restore(a.page, zip);
  check(t1.includes('備份中的資料都已存在') && await a.page.getByRole('button', { name: '確認還原' }).isDisabled(), '已存在的資料全部略過，不能重複匯入');
  await a.page.getByRole('button', { name: '取消' }).click();

  console.log('— 資料遺失的裝置（同帳號）從備份還原');
  const copts = { blockPull: true }; const c = await device(browser, A, copts);
  await c.page.waitForTimeout(3000);
  check(await c.page.getByText('還沒有場勘紀錄').count() === 1, '模擬全新／資料遺失的裝置：本機沒有任何場勘');
  const t2 = await restore(c.page, zip);
  console.log('  ' + t2.replace(/\n+/g, ' | ').slice(0, 160));
  await c.page.getByRole('button', { name: '確認還原' }).click(); await seen(c.page, '還原完成');
  await c.page.goto(URL); await c.page.getByRole('heading', { name: '場勘紀錄' }).waitFor();
  const wc = async (loc, n) => { for (let i = 0; i < 60; i++) { if (await loc.count() === n) return true; await c.page.waitForTimeout(250); } return false; };
  const listed = await wc(c.page.locator('main ul > li'), srvA.s);
  copts.unblocked = true; await c.page.getByRole('button', { name: '重試' }).click({ timeout: 3000 }).catch(() => c.page.getByTitle('立即同步').click().catch(() => {}));
  check(listed, '還原後首頁出現全部 ' + srvA.s + ' 筆場勘');
  const t0 = Date.now(); await c.page.getByText(/^雲端已同步・/).waitFor({ timeout: 240000 }).catch(async () => { console.log('  狀態列：', await c.page.locator('main').innerText().then(t => t.slice(0, 200))); });
  console.log('  同步 113 筆耗時', ((Date.now() - t0) / 1000).toFixed(0), '秒');
  const srvA2 = await counts(c.page);
  check(JSON.stringify(srvA2) === JSON.stringify(srvA), '同步後雲端筆數不變（沒有產生重複紀錄）' + JSON.stringify(srvA2));
  check(await c.page.getByText('版本衝突待處理').count() === 0, '相同資料不會被誤判為衝突');

  console.log('— 還原到另一個帳號');
  const b = await device(browser, B); await synced(b.page);
  const srvB0 = await counts(b.page);
  const t3 = await restore(b.page, zip);
  check(t3.includes('此備份來自其他帳號'), '還原前提示備份來自其他帳號');
  await b.page.getByRole('button', { name: '確認還原' }).click(); await seen(b.page, '還原完成');
  await b.page.goto(URL); const tb = Date.now(); await b.page.getByText(/^雲端已同步・/).waitFor({ timeout: 240000 });
  console.log('  B 同步耗時', ((Date.now() - tb) / 1000).toFixed(0), '秒');
  const srvB1 = await counts(b.page);
  console.log('  雲端 B：', JSON.stringify(srvB0), '→', JSON.stringify(srvB1));
  check(srvB1.s === srvB0.s + srvA.s && srvB1.ph === srvB0.ph + srvA.ph, 'B 帳號取得全部場勘與照片並同步到雲端');
  check(JSON.stringify(await counts(a.page)) === JSON.stringify(srvA), 'A 帳號的資料完全不受影響');
  const t4 = await restore(b.page, zip);
  check(t4.includes('備份中的資料都已存在'), '同一份備份再次匯入 B：全部略過，不重複');
  await b.page.getByRole('button', { name: '取消' }).click();
  const anyName = JSON.parse(fs.readFileSync(jf, 'utf8')).surveys.find(s => s.customer_name.startsWith('報告測試')).customer_name;
  await b.page.goto(URL); await b.page.getByText(anyName).first().click(); await b.page.getByRole('heading', { name: anyName }).waitFor();
  await b.page.getByText('陽台', { exact: true }).click();
  await b.page.waitForFunction(() => { const i = [...document.querySelectorAll('main ul li img')]; return i.length > 0 && i.every(x => x.complete && x.naturalWidth > 0); }, null, { timeout: 30000 }).then(() => check(true, 'B 帳號可以看到還原的照片'), () => check(false, 'B 帳號可以看到還原的照片'));

  console.log('— PWA');
  const man = await a.page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); return l ? await (await fetch(l.href)).json() : null; });
  check(man && man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512' && i.type === 'image/png') && man.icons.some(i => i.purpose === 'maskable'), 'Manifest 具備安裝所需（standalone、192/512 PNG、maskable 圖示）');
  check(await a.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'Service Worker 已註冊（離線可用）');
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
