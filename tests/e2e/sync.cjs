const { chromium, devices } = require('playwright');
const S = process.argv[2];
const URL = 'http://localhost:4174/';
const A = { email: 'hsp-test-a@example.com', pw: process.env.HSP_TEST_A_PW };
const B = { email: 'hsp-test-b@example.com', pw: process.env.HSP_TEST_B_PW };
const stamp = Date.now().toString().slice(-5);
let ok = 0, bad = 0;
const check = (cond, msg) => { cond ? ok++ : bad++; console.log(cond ? '✅' : '❌', msg); };

async function device(browser, who, label) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${label} JS error]`, e.name, e.message, (e.stack||'').split('\n').slice(0,4).join(' | ')));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('密碼').fill(who.pw);
  await page.getByRole('button', { name: '登入' }).click();
  await page.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  return { ctx, page, label };
}
const seen = (page, t, n = 15000) => page.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false);
const gone = (page, t, n = 15000) => page.getByText(t).first().waitFor({ state: 'detached', timeout: n }).then(() => true, () => false);
const synced = (page) => page.getByText(/^雲端已同步・/).waitFor({ timeout: 30000 });
async function syncNow(page) { await page.getByTitle('立即同步').click().catch(() => {}); await page.waitForTimeout(500); await synced(page); }
async function goHome(page) { await page.goto(URL); await page.getByRole('heading', { name: '場勘紀錄' }).waitFor(); }
async function createSurvey(page, name, model) {
  await page.getByRole('button', { name: '新增場勘' }).click();
  await page.getByLabel('客戶姓名').fill(name);
  await page.getByLabel('產品型號').fill(model);
  await page.getByRole('button', { name: '建立場勘' }).click();
  await page.getByRole('heading', { name }).waitFor();
}
async function editModel(page, name, model) {
  await goHome(page); await page.getByText(name).first().click();
  await page.getByRole('button', { name: '編輯場勘資料' }).click();
  await page.getByLabel('產品型號').fill(model);
  await page.getByRole('button', { name: '儲存修改' }).click();
  await page.getByText(model).first().waitFor();
}

(async () => {
  const browser = await chromium.launch();
  const name1 = `同步測試-王先生-${stamp}`;
  console.log('— 1. A 手機建立場勘，B 裝置（同帳號）看得到');
  const a1 = await device(browser, A, 'A手機');
  await createSurvey(a1.page, name1, 'MODEL-1');
  await synced(a1.page);
  check(true, 'A 手機：建立後顯示「雲端已同步」');
  await a1.page.screenshot({ path: `${S}/s2-01-a-synced.png` });
  const a2 = await device(browser, A, 'A第二台');
  await synced(a2.page);
  check(await seen(a2.page, name1), '第二台裝置登入後看到 A 建立的場勘');

  console.log('— 2. 修改尺寸/資料後雲端同步更新');
  await editModel(a1.page, name1, 'MODEL-2');
  await synced(a1.page);
  await goHome(a2.page); await syncNow(a2.page);
  check(await seen(a2.page, 'MODEL-2'), '第二台裝置看到修改後的型號 MODEL-2');

  console.log('— 3. 關閉 App 再開啟，資料仍在');
  await a1.page.close(); a1.page = await a1.ctx.newPage(); a1.page.on('dialog', d => d.accept());
  await a1.page.goto(URL); await a1.page.getByRole('heading', { name: '場勘紀錄' }).waitFor();
  check(await seen(a1.page, name1), '重新開啟後不需重新登入，資料仍在');

  console.log('— 4. 離線新增與修改，恢復網路後同步');
  const name2 = `離線測試-陳小姐-${stamp}`;
  await a1.ctx.setOffline(true);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await createSurvey(a1.page, name2, 'OFF-1');
  await editModel(a1.page, name1, 'MODEL-3-OFFLINE');
  await goHome(a1.page);
  await a1.page.getByText(/離線中/).waitFor();
  console.log('  首頁：', (await a1.page.locator('main').innerText()).slice(0, 400).replace(/\n+/g, ' | '));
  check(await a1.page.getByText('等待網路同步').count() >= 2, '離線時兩筆都顯示「等待網路同步」');
  await a1.page.screenshot({ path: `${S}/s2-02-offline.png` });
  await a1.ctx.setOffline(false);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await synced(a1.page);
  check(true, '恢復網路後自動同步完成');
  await syncNow(a2.page);
  check(await seen(a2.page, name2) && await seen(a2.page, 'MODEL-3-OFFLINE'), '第二台裝置看到離線期間新增與修改的資料');

  console.log('— 5. 兩台同時修改同一筆 → 保留衝突讓使用者選擇');
  await a1.ctx.setOffline(true);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await editModel(a1.page, name1, 'FROM-PHONE');
  await editModel(a2.page, name1, 'FROM-TABLET');
  await synced(a2.page);
  await a1.ctx.setOffline(false);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await goHome(a1.page);
  await a1.page.getByText(/請選擇要保留的版本/).waitFor({ timeout: 30000 });
  check(true, 'A 手機出現衝突提示，沒有無聲覆蓋');
  check(await a1.page.getByText('版本衝突待處理').count() === 1, '該筆場勘標示「版本衝突待處理」');
  await a1.page.getByText(/請選擇要保留的版本/).click();
  await a1.page.getByText('FROM-TABLET').waitFor();
  check(await a1.page.getByText('FROM-PHONE').count() === 1, '衝突頁並排顯示兩個版本（FROM-PHONE / FROM-TABLET）');
  await a1.page.screenshot({ path: `${S}/s2-03-conflict.png`, fullPage: true });
  await a1.page.getByRole('button', { name: '採用此裝置' }).click();
  await a1.page.getByText('沒有待處理的衝突').waitFor();
  await goHome(a1.page); await synced(a1.page);
  await syncNow(a2.page);
  check(await seen(a2.page, 'FROM-PHONE'), '選擇「採用此裝置」後，另一台也更新為 FROM-PHONE');

  console.log('— 6. 離線刪除後不會被雲端舊資料救回');
  await a1.ctx.setOffline(true);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await a1.page.getByText(name2).click();
  await a1.page.getByRole('button', { name: '刪除這筆場勘' }).click();
  await a1.page.getByRole('heading', { name: '場勘紀錄' }).waitFor();
  await a1.ctx.setOffline(false);
  await a1.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await synced(a1.page); await syncNow(a1.page);
  check(await gone(a1.page, name2), 'A 手機：同步並重新下載後，刪除的資料沒有復活');
  await syncNow(a2.page);
  check(await gone(a2.page, name2), '第二台裝置也看不到已刪除的場勘');

  console.log('— 7. 不同使用者不能看到彼此的紀錄');
  const b = await device(browser, B, 'B帳號');
  await synced(b.page);
  check(!(await seen(b.page, name1, 4000)), 'B 帳號首頁看不到 A 的場勘');
  const probe = await b.page.evaluate(async ({ name }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const token = JSON.parse(localStorage.getItem(key)).access_token;
    const base = 'https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1';
    const apikey = document.querySelector('script') && null;
    return { token: !!token };
  }, { name: name1 });
  // 直接用 B 的權杖呼叫 API 嘗試讀取/修改 A 的資料
  const aRow = await a1.page.evaluate(async (name) => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const q = r.result.transaction('surveys').objectStore('surveys').getAll(); q.onsuccess = () => res(q.result.find((s) => s.customer_name === name)); }; }), name1);
  const api = await b.page.evaluate(async ({ id, uid }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const token = JSON.parse(localStorage.getItem(key)).access_token;
    const apikey = process.env.HSP_ANON_KEY;
    const h = { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const base = 'https://kmcnowfjzrppntgktyjq.supabase.co/rest/v1';
    const read = await (await fetch(`${base}/surveys?id=eq.${id}`, { headers: h })).json();
    const readAll = await (await fetch(`${base}/surveys?select=id,user_id`, { headers: h })).json();
    const upd = await (await fetch(`${base}/surveys?id=eq.${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ customer_name: 'hacked' }) })).json();
    const ins = await fetch(`${base}/survey_areas`, { method: 'POST', headers: h, body: JSON.stringify({ id: crypto.randomUUID(), survey_id: id, kind: 'other', name: 'B 塞入' }) });
    const fake = await fetch(`${base}/surveys`, { method: 'POST', headers: h, body: JSON.stringify({ id: crypto.randomUUID(), user_id: uid, customer_name: 'B 冒充 A' }) });
    const del = await fetch(`${base}/surveys?id=eq.${id}`, { method: 'DELETE', headers: h });
    return { read: read.length, readAll: Array.isArray(readAll) ? readAll.filter((r) => r.user_id === uid || r.id === id).length : readAll, bOwn: readAll.length, upd: upd.length, ins: ins.status, fake: fake.status, del: del.status };
  }, { id: aRow.id, uid: aRow.user_id });
  console.log('  B 直接呼叫 API：', JSON.stringify(api));
  check(api.read === 0, 'B 用 API 讀 A 的場勘 → 0 筆');
  check(api.readAll === 0, 'B 用 API 讀全部場勘 → 只有自己的，A 的 0 筆');
  check(api.upd === 0, 'B 用 API 修改 A 的場勘 → 0 筆被改');
  check(api.ins === 403, 'B 在 A 的場勘下新增區域 → 403 拒絕');
  check(api.fake === 403, 'B 冒充 A 建立場勘 → 403 拒絕');
  check(api.del >= 400, `B 刪除 A 的場勘 → 拒絕 (${api.del})`);
  await syncNow(a2.page);
  check(!(await seen(a2.page, 'hacked', 3000)) && await seen(a2.page, name1), 'A 的資料完好無損');
  await a2.page.screenshot({ path: `${S}/s2-04-device2.png` });

  console.log(`\n結果：${ok} 通過，${bad} 失敗`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
