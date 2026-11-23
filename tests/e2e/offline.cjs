const { chromium, devices } = require('playwright');
const URL = 'http://localhost:4174/';
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m); };
const seen = (p, t, n = 15000) => p.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[JS error]', e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.getByLabel('Email').fill('hsp-test-a@example.com'); await p.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW);
  await p.getByRole('button', { name: '登入' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  await p.getByText(/^雲端已同步・/).waitFor({ timeout: 30000 });
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
  await p.reload(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor(); await p.getByText(/^照片測試/).first().waitFor();
  const target = (await p.locator('main ul li a span.truncate').allInnerTexts()).find(t => t.startsWith('照片測試'));
  console.log('  目標場勘：', target);
  const stat = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { const t = r.result.transaction(['survey_photos', 'photoBlobs']); const a = t.objectStore('survey_photos').getAll(); const b = t.objectStore('photoBlobs').getAllKeys(); t.oncomplete = () => res({ live: a.result.filter(x => !x.deleted_at).length, remoteOnly: a.result.filter(x => !x.deleted_at && x._blobState === 'remote-only').length, blobs: b.result.length }); }; }));
  let st; for (let i = 0; i < 120; i++) { st = await stat(); if (st.remoteOnly === 0) break; await p.waitForTimeout(500); }
  console.log('  背景下載狀態：', JSON.stringify(st));
  check(st.remoteOnly === 0, '登入後照片在背景自動下載到本機');
  // 完全離線：關閉 App 後在沒有網路的情況重新開啟
  await ctx.setOffline(true); await p.close();
  const q = await ctx.newPage(); q.on('pageerror', (e) => console.log('[JS error offline]', e.message));
  await q.goto(URL).catch(e => console.log('  goto error', e.message));
  check(await seen(q, '場勘紀錄'), '沒有網路時重新開啟 App：畫面正常載入（Service Worker）');
  check(await seen(q, /離線中/), '顯示「離線中」狀態');
  check(await seen(q, target), '離線時可查看之前的場勘紀錄');
  await q.getByText(target).click(); await q.getByRole('region', { name: '區域 陽台' }).waitFor();
  await q.waitForFunction(() => { const i = [...document.querySelectorAll('section[aria-label="區域 陽台"] ul li img')]; return i.length > 0 && i.every(x => x.complete && x.naturalWidth > 0); }, null, { timeout: 15000 }).then(() => check(true, '離線時可查看已下載的照片'), () => check(false, '離線時可查看已下載的照片'));
  await q.getByRole('button', { name: '返回' }).click();
  await q.getByRole('button', { name: '新增場勘' }).click(); await q.getByLabel('客戶姓名').fill('完全離線新增');
  await q.getByRole('button', { name: '建立場勘' }).click();
  check(await seen(q, '已儲存到本機'), '完全離線（App 也是離線開啟）時可以新增場勘');
  await ctx.setOffline(false); await q.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await q.getByText(/^雲端已同步・/).waitFor({ timeout: 30000 }).then(() => true, () => false), '恢復網路後自動同步');
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
