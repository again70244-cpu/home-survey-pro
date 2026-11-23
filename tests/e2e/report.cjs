const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = process.argv[2]; const URL = 'http://localhost:4174/';
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m); };
const seen = (p, t, n = 15000) => p.getByText(t).first().waitFor({ timeout: n }).then(() => true, () => false);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  // 模擬 Android Chrome 的 Web Share（Level 2，支援多檔）
  await ctx.addInitScript(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => { window.__shared = { n: d.files.length, names: d.files.map(f => f.name), types: d.files.map(f => f.type) }; };
  });
  const p = await ctx.newPage();
  const warns = []; p.on('console', m => { if (m.text().includes('[report]')) warns.push(m.text()); });
  p.on('pageerror', (e) => console.log('[JS error]', e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.getByLabel('Email').fill('hsp-test-a@example.com'); await p.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW);
  await p.getByRole('button', { name: '登入' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  const name = '報告測試-黃大明-' + Date.now().toString().slice(-4);
  await p.getByRole('button', { name: '新增場勘' }).click();
  await p.getByLabel('客戶姓名').fill(name); await p.getByLabel(/聯絡電話/).fill('0912-345-678');
  await p.getByLabel(/客戶地址/).fill('新北市板橋區文化路一段 188 巷 25 號 7 樓之 3'); await p.getByLabel('產品型號').fill('WD-S19VDW');
  await p.getByLabel('備註').fill('客戶希望週末安裝。舊機需回收，請安排搬運人員兩位。');
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor();
  const fillArea = async (area, dims, files, note) => {
    const A = p.getByRole('region', { name: '區域 ' + area });
    const labels = ['寬', '深', '高'];
    for (let i = 0; i < 3; i++) if (dims[i] !== null) await A.getByLabel(area + ' ' + labels[i] + '（公分）').fill(String(dims[i]));
    if (note) await A.getByLabel(area + ' 區域備註').fill(note);
    if (files.length) { await A.getByTestId('gallery-input').setInputFiles(files.map(f => S + '/photos/' + f)); await seen(p, `已儲存 ${files.length} 張照片到本機`, 30000); }
    for (let i = 0; i < files.length; i++) { await A.getByLabel(`照片 ${i + 1} 說明`).fill(`${area} 照片 ${i + 1}：從門口往內拍攝，含捲尺刻度`); await A.getByLabel(`照片 ${i + 1} 說明`).press('Enter'); }
    await p.waitForTimeout(700);
  };
  await fillArea('陽台', [128, 62.5, 240], ['r1.jpg', 'r2.jpg', 'r3.jpg', 'r4.jpg', 'p1.jpg'], '陽台門檻高 3cm，落地窗可拆。');
  await fillArea('電梯', [90, 140, null], ['p2.jpg', 'r2.jpg'], null);
  await fillArea('樓梯', [null, null, null], [], null);
  await p.getByRole('button', { name: '新增區域' }).click(); await p.getByRole('button', { name: '安裝位置', exact: true }).click();
  await p.getByRole('region', { name: '區域 安裝位置' }).waitFor();
  await fillArea('安裝位置', [65, 70, 105], ['r1.jpg', 'r3.jpg', 'r4.jpg'], '洗衣機放置於後陽台，旁邊有水龍頭與排水孔。\n插座距離地面 120cm，需確認是否為獨立迴路。\n'.repeat(4));

  console.log('— 產生報告');
  const t0 = Date.now();
  await p.getByRole('button', { name: '產生場勘報告' }).click();
  await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 });
  console.log('  耗時', ((Date.now() - t0) / 1000).toFixed(1), '秒');
  const n = Number((await p.getByText(/已產生 \d+ 張報告圖片/).innerText()).match(/已產生 (\d+)/)[1]);
  const imgs = await p.locator('main ul li img').evaluateAll(a => a.map(i => [i.naturalWidth, i.naturalHeight]));
  console.log('  頁數：', n, ' 解析度：', JSON.stringify(imgs[0]));
  check(n >= 4 && n <= 8, `依內容自動分頁（${n} 頁，10 張照片不擠在同一張）`);
  check(imgs.every(([w, h]) => w === 2480 && h === 3508), '每頁都是 A4 直式 2480×3508 高解析度 PNG');
  check(warns.length === 0, '沒有任何頁面內容超出版面（文字不重疊、不被截斷）' + (warns.length ? ' ' + warns.join(';') : ''));
  // 存檔以便檢查
  const srcs = await p.locator('main ul li img').evaluateAll(a => a.map(i => i.src));
  for (let i = 0; i < srcs.length; i++) {
    const b64 = await p.evaluate(async (u) => { const b = await (await fetch(u)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(b); }); }, srcs[i]);
    fs.writeFileSync(`${S}/report-out/page-${i + 1}.png`, Buffer.from(b64, 'base64'));
  }

  console.log('— 分享與下載');
  await p.getByRole('button', { name: '分享至 LINE' }).click(); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => window.__shared);
  console.log('  分享內容：', JSON.stringify(sh && { n: sh.n, first: sh.names[0], last: sh.names[sh.n - 1] }));
  check(sh && sh.n === n && sh.types.every(t => t === 'image/png'), `分享選單一次收到全部 ${n} 張 PNG（不只第一張）`);
  const dl = p.waitForEvent('download'); await p.getByRole('button', { name: '下載 ZIP' }).click(); const z = await dl;
  const zp = `${S}/report-out/report.zip`; await z.saveAs(zp);
  const list = require('child_process').execSync(`python3 -c "import zipfile,sys;print(len(zipfile.ZipFile('${zp}').namelist()))"`).toString().trim();
  check(Number(list) === n, `ZIP 內含全部 ${n} 張圖片`);
  const dls = []; p.on('download', d => dls.push(d.suggestedFilename()));
  await p.getByRole('button', { name: /下載全部/ }).click(); await p.waitForTimeout(400 * n + 1500);
  check(dls.length === n, `「下載全部」逐張下載 ${dls.length}/${n} 張`);
  await p.screenshot({ path: `${S}/s6-report-page.png` });

  console.log('— 不支援多檔分享的瀏覽器');
  {
    const c2 = await browser.newContext({ ...devices['Pixel 7'] });
    await c2.addInitScript(() => { navigator.canShare = () => false; });
    const q = await c2.newPage(); await q.goto(URL);
    await q.getByLabel('Email').fill('hsp-test-a@example.com'); await q.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW);
    await q.getByRole('button', { name: '登入' }).click(); await q.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
    await q.getByText(/^雲端已同步・/).waitFor({ timeout: 45000 }); await q.getByText(name).first().waitFor();
    await q.goto(p.url()); await q.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 });
    check(await seen(q, '這個瀏覽器無法一次分享多張圖片') && await q.getByRole('button', { name: '分享至 LINE' }).count() === 0 && await q.getByRole('button', { name: '下載 ZIP' }).count() === 1, '不支援時改提供下載全部／ZIP 與清楚的使用提示');
    await c2.close();
  }
  console.log('— 離線也能產生報告');
  await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p.reload(); 
  check(await p.getByText(/已產生 \d+ 張報告圖片/).waitFor({ timeout: 120000 }).then(() => true, () => false), '離線時仍可用本機資料產生報告');
  await ctx.setOffline(false);
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await browser.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
