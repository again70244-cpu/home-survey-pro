const { chromium, devices } = require('playwright');
const S = process.argv[2]; const URL = 'http://localhost:4174/';
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m); };
const seen = (p, t, n = 15000) => p.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false);
const synced = (p) => p.getByText(/^雲端已同步・/).first().waitFor({ timeout: 60000 });
const waitCount = async (loc, n, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await loc.count() === n) return true; await new Promise(r => setTimeout(r, 300)); } return false; };
async function device(browser, label) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${label} JS error]`, e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(URL); await page.getByLabel('Email').fill('hsp-test-a@example.com'); await page.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW);
  await page.getByRole('button', { name: '登入' }).click(); await page.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  return { ctx, page };
}
const areaNames = (p) => p.locator('section[aria-label^="區域 "] h3').evaluateAll(hs => hs.map(h => h.childNodes[1].textContent));
(async () => {
  const browser = await chromium.launch();
  const { page: p } = await device(browser, 'A');
  const name = `直接輸入測試-${Date.now().toString().slice(-5)}`;
  await p.getByRole('button', { name: '新增場勘' }).click(); await p.getByLabel('客戶姓名').fill(name);
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor();
  const urlBefore = p.url();

  console.log('— 在場勘頁直接輸入尺寸（不用點進區域）');
  await p.getByLabel('陽台 寬（公分）').fill('120');
  await p.getByLabel('陽台 寬（公分）').press('Enter');
  check(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '陽台 深（公分）', '按鍵盤「下一個」自動跳到深度欄位');
  await p.keyboard.type('５５．５');
  await p.getByLabel('陽台 高（公分）').fill('abc');
  check(await seen(p, '請輸入數字'), '非數字顯示錯誤');
  await p.getByLabel('陽台 高（公分）').fill('');
  await p.getByLabel('電梯 寬（公分）').fill('90'); await p.getByLabel('電梯 深（公分）').fill('140'); await p.getByLabel('電梯 高（公分）').fill('210');
  await p.getByLabel('電梯 區域備註').fill('電梯門寬 85cm');
  await p.getByLabel('電梯 區域備註').blur(); await p.waitForTimeout(800);
  check(p.url() === urlBefore, '全程停留在場勘頁，沒有換頁');
  const sec = (n) => p.getByRole('region', { name: `區域 ${n}` });
  check(await sec('陽台').getByText('尺寸 2/3').count() === 1, '陽台顯示「尺寸 2/3」');
  check(await sec('電梯').getByText('✓ 尺寸已完成').count() === 1, '電梯顯示「✓ 尺寸已完成」');

  console.log('— 在場勘頁直接上傳照片');
  await sec('陽台').getByTestId('gallery-input').setInputFiles([S + '/photos/p1.jpg', S + '/photos/p2.jpg']);
  await seen(p, '已儲存 2 張照片到本機', 30000);
  check(await waitCount(sec('陽台').locator('ul li img'), 2), '陽台卡片直接顯示 2 張照片');
  await sec('電梯').getByTestId('camera-input').setInputFiles(S + '/photos/p3.jpg');
  check(await waitCount(sec('電梯').locator('ul li img'), 1), '電梯卡片「拍照」後直接顯示照片');
  check(await sec('陽台').locator('ul li img').count() === 2, '照片放在正確的區域，沒有混到其他區域');
  await sec('陽台').getByLabel('照片 1 說明').fill('陽台門'); await sec('陽台').getByLabel('照片 1 說明').press('Enter');
  check(p.url() === urlBefore, '上傳照片也不用換頁');
  check(await sec('電梯').getByText('✓ 已拍照 1 張').count() === 1, '電梯顯示「✓ 已拍照 1 張」');

  console.log('— 區域管理仍正常');
  await p.getByRole('button', { name: '新增區域' }).click(); await p.getByRole('button', { name: '大門', exact: true }).click();
  await sec('大門').waitFor(); await p.waitForTimeout(600);
  console.log('  focus:', await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  check(await p.evaluate(() => document.activeElement?.getAttribute('aria-label')) === '大門 寬（公分）', '新增區域後自動捲到該區並聚焦寬度欄位');
  await p.keyboard.type('95');
  await p.getByRole('button', { name: '大門 改名' }).click(); await p.getByLabel('區域名稱').fill('大門（含門框）'); await p.getByLabel('區域名稱').press('Enter');
  await sec('大門（含門框）').waitFor();
  await p.getByRole('button', { name: '調整排序' }).click();
  for (let i = 0; i < 3; i++) { await p.getByRole('button', { name: '大門（含門框） 上移' }).click(); await p.waitForTimeout(200); }
  await p.getByRole('button', { name: '完成排序' }).click();
  await p.getByRole('button', { name: '刪除區域 樓梯' }).click(); await p.waitForTimeout(400);
  check(JSON.stringify(await areaNames(p)) === JSON.stringify(['大門（含門框）', '陽台', '電梯']), '改名、排序、刪除正常：' + JSON.stringify(await areaNames(p)));
  check(await sec('大門（含門框）').getByLabel('大門（含門框） 寬（公分）').inputValue() === '95', '改名後尺寸沒有遺失');
  await synced(p); await p.screenshot({ path: `${S}/s8-inline.png`, fullPage: true });

  console.log('— 重新開啟與另一台裝置');
  await p.reload(); await p.getByRole('heading', { name }).waitFor();
  check(await p.getByLabel('陽台 寬（公分）').inputValue() === '120' && await p.getByLabel('陽台 深（公分）').inputValue() === '55.5' && await p.getByLabel('陽台 高（公分）').inputValue() === '', '重新開啟後尺寸仍在（高度保持空白＝尚未測量）');
  const { page: q } = await device(browser, 'A2'); await synced(q);
  await q.getByText(name).click(); await q.getByRole('heading', { name }).waitFor();
  await q.waitForTimeout(1500);
  check(await q.getByLabel('電梯 高（公分）').inputValue() === '210' && await q.getByLabel('電梯 區域備註').inputValue() === '電梯門寬 85cm', '第二台裝置看到尺寸與備註');
  check(await waitCount(q.getByRole('region', { name: '區域 陽台' }).locator('ul li img'), 2), '第二台裝置看到照片');
  await q.getByLabel('電梯 高（公分）').fill('215'); await q.getByLabel('電梯 高（公分）').blur(); await synced(q); await q.waitForTimeout(1500); await synced(q);
  await p.reload(); await p.getByRole('heading', { name }).waitFor(); await synced(p); await p.waitForTimeout(1000);
  check(await p.getByLabel('電梯 高（公分）').inputValue() === '215', 'A 手機看到第二台修改的高度 215');
  console.log(`\n結果：${ok} 通過，${bad} 失敗`); await browser.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
