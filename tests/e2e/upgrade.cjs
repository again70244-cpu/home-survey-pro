const { chromium, devices } = require('playwright'); const { execSync } = require('child_process');
const S = process.argv[2]; const URL = 'http://localhost:4175/';
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? '✅' : '❌', m); };
const serve = (dir) => {
  try { execSync('pkill -f "http.server 4175"') } catch {}
  execSync('for i in $(seq 1 50); do (ss -ltn | grep -q ":4175 ") || break; sleep 0.1; done')
  execSync(`cd ${dir} && (nohup python3 -m http.server 4175 >/dev/null 2>&1 &)`)
  execSync('for i in $(seq 1 50); do curl -s -o /dev/null localhost:4175/ && break; sleep 0.1; done')
  const want = require('fs').readdirSync(dir + '/assets').length
  console.log('  serving', dir.split('/').pop(), 'sw.js bytes', execSync('curl -s localhost:4175/sw.js | wc -c').toString().trim())
};
(async () => {
  serve(S + '/dist-old');
  const ctx = await chromium.launchPersistentContext(S + '/p2/profile-' + Date.now(), { ...devices['Pixel 7'] });
  const p = ctx.pages()[0] ?? await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.getByLabel('Email').fill('hsp-test-a@example.com'); await p.getByLabel('密碼').fill(process.env.HSP_TEST_A_PW);
  await p.getByRole('button', { name: '登入' }).click(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  // 舊版：離線建立一筆（只存在本機、尚未同步），確保升級後本機獨有資料也保留
  await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline')));
  const name = '升級測試-' + Date.now().toString().slice(-5);
  await p.getByRole('button', { name: '新增場勘' }).click(); await p.getByLabel('客戶姓名').fill(name); { const m = p.getByRole('button', { name: /電話、地址、日期、備註/ }); if (await m.count()) await m.click(); } await p.getByLabel('產品型號').fill('WD-S2220B');
  await p.getByRole('button', { name: '建立場勘' }).click(); await p.getByRole('heading', { name }).waitFor();
  await p.getByLabel('陽台 寬（公分）').fill('120'); await p.getByLabel('陽台 寬（公分）').blur(); await p.waitForTimeout(800);
  await p.getByRole('region', { name: '區域 陽台' }).getByTestId('gallery-input').setInputFiles(S + '/photos/p1.jpg');
  await p.getByText('已儲存 1 張照片到本機').waitFor({ timeout: 20000 });
  const v1 = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { res({ version: r.result.version, stores: [...r.result.objectStoreNames] }); r.result.close(); }; }));
  console.log('  舊版 IndexedDB：', JSON.stringify(v1));
  // 換成新版（模擬 App 更新）：網路恢復但雲端暫時連不上 → 資料維持「尚未同步」
  await ctx.route('**/*.supabase.co/**', (r) => r.abort('internetdisconnected'));
  await ctx.setOffline(false);
  execSync(`find ${S}/dist-s2 -type f -exec touch {} +`); serve(S + '/dist-s2');
  await p.goto(URL + '#/'); await p.reload(); await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  const banner = await p.getByText('有新版本可用').waitFor({ timeout: 30000 }).then(() => true, () => false);
  check(banner, '舊版 App 偵測到新版本，顯示「更新」提示（不會自動重新整理打斷輸入）');
  await p.getByRole('button', { name: '更新' }).click();
  await p.waitForLoadState('load'); await p.waitForTimeout(1500);
  await p.getByRole('heading', { name: '場勘紀錄' }).waitFor({ timeout: 20000 });
  check(await p.getByRole('button', { name: 'LG 產品知識庫' }).count() === 1, '按「更新」後載入新版（出現產品知識庫入口）');
  const v2 = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('home-survey-pro'); r.onsuccess = () => { res({ version: r.result.version, stores: [...r.result.objectStoreNames] }); r.result.close(); }; }));
  console.log('  新版 IndexedDB：', JSON.stringify(v2));
  check(v2.version >= v1.version && v2.stores.includes('catalog_products') && v1.stores.every((s) => v2.stores.includes(s)), '本機資料庫升級：版本不降低，原有資料表全部保留');
  check(await p.getByText(name).count() === 1, '升級後：離線建立、尚未同步的場勘仍在');
  check(await p.getByText('等待網路同步').count() >= 1 || await p.getByText('本機已保存').count() >= 1, '升級後：仍記得這筆尚未同步');
  await p.getByText(name).click(); await p.getByRole('heading', { name }).waitFor();
  check(await p.getByLabel('陽台 寬（公分）').inputValue() === '120', '升級後：尺寸仍在');
  await p.getByRole('region', { name: '區域 陽台' }).locator('ul li img').first().waitFor({ timeout: 10000 });
  check(await p.getByRole('region', { name: '區域 陽台' }).locator('ul li img').evaluate((i) => i.complete && i.naturalWidth > 0), '升級後：本機照片仍在');
  await ctx.unroute('**/*.supabase.co/**'); await p.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await p.getByText(/^雲端已同步・/).first().waitFor({ timeout: 60000 }).then(() => true, () => false), '恢復網路後，升級前的離線資料正常同步上雲端');
  check(await p.getByRole('region', { name: '區域 陽台' }).getByText('已上傳', { exact: true }).waitFor({ timeout: 30000 }).then(() => true, () => false), '照片上傳成功');
  console.log('\n結果：' + ok + ' 通過，' + bad + ' 失敗'); await ctx.close(); try { execSync('pkill -f "http.server 4175"') } catch {} ; process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
