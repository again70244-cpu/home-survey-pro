/**
 * LG 產品知識庫同步（Google Sheets → Supabase）
 *
 * 安裝：試算表 → 擴充功能 → Apps Script → 左側「檔案」旁的 ＋ → 指令碼 → 命名 ProductSync → 貼上本檔 → 儲存
 *      （請「新增檔案」，不要刪除或覆蓋既有的程式；本檔所有名稱都以 productSync／PS_ 開頭，不會與既有程式衝突）
 *      專案設定 → 指令碼屬性（Script Properties）新增：
 *        PRODUCT_SYNC_URL     = https://<專案>.supabase.co/functions/v1/product-sync
 *        PRODUCT_SYNC_SECRET  = （與 Supabase 的 PRODUCT_SYNC_SECRET 相同）
 *        PRODUCT_SYNC_DATASET = production（測試用副本請設 staging）
 *      回到編輯器，選擇函式 productSyncSetup → 執行 → 授權
 *      （選單「LG 產品同步」由 productSyncSetup 安裝的開啟觸發器建立，不使用 onOpen，避免與既有程式衝突）
 *
 * 安全
 * - 只讀取「報價」「一對多報價」兩張工作表，而且只讀下方白名單中的欄位（依欄位標題找欄）。
 *   產品原價、周年慶低售、促銷/備註、室外機價格、白名單（LINE）、LG業績 都不會被讀取。
 * - 密鑰只存在 Script Properties，不寫在程式碼裡。
 */

var PS_PRODUCT_SHEET = '報價';
var PS_MULTI_SPLIT_SHEET = '一對多報價';
var PS_PRODUCT_COLUMNS = ['產品型號', '分類', '圖片網址', '圖片網址2', '圖片網址3', '圖片網址4', '安裝尺寸', '連結', '影片網址', '保養說明'];
var PS_MULTI_SPLIT_COLUMNS = ['室外機型號', '室內機1', '室內機2', '室內機3', '室內機4', '室內機5', '室內機6', '室內機7', '備註'];
var PS_LINK_COLUMNS = ['圖片網址', '圖片網址2', '圖片網址3', '圖片網址4', '連結', '影片網址'];
var PS_DEBOUNCE_MS = 2 * 60 * 1000;   // 修改後等 2 分鐘再同步（期間的修改合併）
var PS_SCHEDULE_MINUTES = 15;          // 定期檢查

// ---------------------------------------------------------------------------
// 選單
// ---------------------------------------------------------------------------
function productSyncOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LG 產品同步')
    .addItem('立即同步', 'productSyncNow')
    .addItem('差異檢查（只預覽，不寫入）', 'productSyncPreview')
    .addItem('完整重新同步', 'productSyncFull')
    .addSeparator()
    .addItem('查看上次同步結果', 'productSyncShowLast')
    .addItem('安裝／重設自動同步', 'productSyncSetup')
    .addToUi();
}

function productSyncNow() { productSyncShow_(productSyncRun_('manual', 'sync', false)); }
function productSyncPreview() { productSyncShow_(productSyncRun_('preview', 'preview', false)); }
function productSyncFull() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert('完整重新同步',
    '會重新送出全部產品資料。\n\n若產品數量大幅減少（例如刪除了很多列），一般同步會被保護機制拒絕；完整重新同步會「強制套用」。\n\n確定要繼續嗎？',
    ui.ButtonSet.OK_CANCEL);
  if (ans !== ui.Button.OK) return;
  productSyncShow_(productSyncRun_('full', 'full', true));
}
function productSyncShowLast() {
  var last = PropertiesService.getScriptProperties().getProperty('PRODUCT_SYNC_LAST_RESULT');
  SpreadsheetApp.getUi().alert('上次同步結果', last || '尚未同步過', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// 安裝觸發器
// ---------------------------------------------------------------------------
function productSyncSetup() {
  var props = PropertiesService.getScriptProperties();
  ['PRODUCT_SYNC_URL', 'PRODUCT_SYNC_SECRET'].forEach(function (k) {
    if (!props.getProperty(k)) throw new Error('請先在「專案設定 → 指令碼屬性」設定 ' + k);
  });
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (['productSyncOnOpen', 'productSyncOnEdit', 'productSyncOnChange', 'productSyncScheduled', 'productSyncDebounced'].indexOf(f) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('productSyncOnOpen').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('productSyncOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('productSyncOnChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('productSyncScheduled').timeBased().everyMinutes(PS_SCHEDULE_MINUTES).create();
  var r = productSyncRun_('manual', 'sync', false);
  try {
    SpreadsheetApp.getUi().alert('自動同步已安裝', '修改「報價」「一對多報價」後約 2 分鐘自動同步，另外每 15 分鐘定期檢查。\n\n首次同步結果：\n' + productSyncSummary_(r), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* 從編輯器執行時沒有 UI */ }
}

// ---------------------------------------------------------------------------
// 觸發：修改（防抖）與定期
// ---------------------------------------------------------------------------
function productSyncOnEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name && name !== PS_PRODUCT_SHEET && name !== PS_MULTI_SPLIT_SHEET) return; // 其他工作表的修改不觸發
  productSyncSchedule_();
}
function productSyncOnChange(e) {
  // 新增／刪除列或欄、貼上等結構性變更（事件不提供工作表名稱，交給雜湊判斷是否真的有變）
  if (e && e.changeType === 'FORMAT') return;
  productSyncSchedule_();
}
function productSyncSchedule_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PRODUCT_SYNC_PENDING_AT', String(Date.now()));
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'productSyncDebounced'; });
  if (!exists) ScriptApp.newTrigger('productSyncDebounced').timeBased().after(PS_DEBOUNCE_MS).create();
}
function productSyncDebounced() {
  var props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'productSyncDebounced') ScriptApp.deleteTrigger(t); });
  var pending = Number(props.getProperty('PRODUCT_SYNC_PENDING_AT') || 0);
  var wait = PS_DEBOUNCE_MS - (Date.now() - pending);
  if (wait > 10 * 1000) { // 這段時間內還有新的修改 → 再等一下
    ScriptApp.newTrigger('productSyncDebounced').timeBased().after(wait).create();
    return;
  }
  props.deleteProperty('PRODUCT_SYNC_PENDING_AT');
  productSyncRun_('edit', 'sync', false);
}
function productSyncScheduled() { productSyncRun_('schedule', 'sync', false); }

// ---------------------------------------------------------------------------
// 同步主流程
// ---------------------------------------------------------------------------
function productSyncRun_(trigger, mode, force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return { status: 'skipped', error: '已有同步正在進行，稍後會自動再試' };
  try {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('PRODUCT_SYNC_URL');
    var secret = props.getProperty('PRODUCT_SYNC_SECRET');
    if (!url || !secret) throw new Error('尚未設定 PRODUCT_SYNC_URL 或 PRODUCT_SYNC_SECRET');
    var dataset = props.getProperty('PRODUCT_SYNC_DATASET') || 'production';
    var ss = SpreadsheetApp.getActive();

    var products = productSyncRead_(ss, PS_PRODUCT_SHEET, PS_PRODUCT_COLUMNS, '產品型號');
    var multi = productSyncRead_(ss, PS_MULTI_SPLIT_SHEET, PS_MULTI_SPLIT_COLUMNS, '室外機型號');
    var localHash = productSyncMd5_(JSON.stringify([dataset, products, multi]));

    // 定期／修改觸發：資料沒變就不呼叫伺服器（手動、完整、預覽一律送出）
    if ((trigger === 'schedule' || trigger === 'edit') && localHash === props.getProperty('PRODUCT_SYNC_LAST_HASH')) {
      return { status: 'unchanged_local' };
    }

    var body = JSON.stringify({
      dataset: dataset, mode: mode, trigger: trigger, force: !!force,
      spreadsheet_id: ss.getId(), sent_at: new Date().toISOString(),
      products: { rows: products }, multi_split: { rows: multi }
    });
    var res = productSyncPost_(url, secret, body);
    var result = res.body || {};
    result.http = res.code;
    if (res.code === 200 && (result.status === 'success' || result.status === 'unchanged')) {
      props.setProperty('PRODUCT_SYNC_LAST_HASH', localHash); // 只有成功才記錄；失敗時下次定期同步會自動重試
    }
    props.setProperty('PRODUCT_SYNC_LAST_RESULT', new Date().toLocaleString('zh-TW') + '（' + trigger + '）\n' + productSyncSummary_(result));
    if (res.code !== 200) console.error('同步失敗', res.code, JSON.stringify(result));
    return result;
  } catch (err) {
    var msg = String(err && err.message || err);
    PropertiesService.getScriptProperties().setProperty('PRODUCT_SYNC_LAST_RESULT', new Date().toLocaleString('zh-TW') + '（' + trigger + '）\n失敗：' + msg);
    console.error(msg);
    return { status: 'failed', error: msg };
  } finally {
    lock.releaseLock();
  }
}

/** 依欄位標題只讀取白名單欄；找不到的欄位視為空白 */
function productSyncRead_(ss, sheetName, columns, keyColumn) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('找不到工作表「' + sheetName + '」');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  if (header.indexOf(keyColumn) < 0) throw new Error('「' + sheetName + '」找不到欄位「' + keyColumn + '」，請確認標題列');
  var n = lastRow - 1;
  var data = {};
  columns.forEach(function (c) {
    var idx = header.indexOf(c);
    if (idx < 0) return;
    var rng = sh.getRange(2, idx + 1, n, 1); // 只讀這一欄
    var vals = rng.getDisplayValues();
    if (PS_LINK_COLUMNS.indexOf(c) >= 0) {
      var rich = rng.getRichTextValues();
      vals = vals.map(function (v, i) {
        var link = rich[i][0] && rich[i][0].getLinkUrl();
        return [link && v[0].indexOf(link) < 0 ? (v[0] ? v[0] + ' ' : '') + link : v[0]];
      });
    }
    data[c] = vals;
  });
  var rows = [];
  for (var i = 0; i < n; i++) {
    var values = {};
    var any = false;
    Object.keys(data).forEach(function (c) {
      var v = String(data[c][i][0] || '');
      values[c] = v === '' ? null : v;
      if (v.trim()) any = true;
    });
    if (any) rows.push({ row: i + 2, values: values });
  }
  return rows;
}

function productSyncPost_(url, secret, body) {
  var lastErr;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var ts = String(Date.now());
      var rid = Utilities.getUuid();
      var sig = productSyncHex_(Utilities.computeHmacSha256Signature(ts + '.' + rid + '.' + body, secret, Utilities.Charset.UTF_8));
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        payload: body,
        headers: { 'X-Sync-Timestamp': ts, 'X-Sync-Request-Id': rid, 'X-Sync-Signature': sig },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var parsed;
      try { parsed = JSON.parse(res.getContentText()); } catch (e) { parsed = { error: res.getContentText().slice(0, 300) }; }
      if (code >= 500 && attempt < 3) { lastErr = parsed.error; Utilities.sleep(2000 * attempt); continue; } // 伺服器暫時錯誤 → 重試
      return { code: code, body: parsed };
    } catch (e) {
      lastErr = e; // 網路中斷 → 重試
      Utilities.sleep(2000 * attempt);
    }
  }
  throw new Error('連線失敗（已重試 3 次）：' + lastErr);
}

function productSyncSummary_(r) {
  if (!r) return '';
  var s = { success: '成功', unchanged: '資料沒有變更', unchanged_local: '資料沒有變更（未送出）', preview: '差異預覽', rejected: '已拒絕（保護機制）', failed: '失敗', skipped: '略過' }[r.status] || r.status;
  var lines = ['狀態：' + s];
  if (r.counts) lines.push('產品 ' + r.counts.products + ' 筆（完整 ' + r.counts.complete + '、缺少安裝資料 ' + r.counts.missing + '、待確認 ' + r.counts.needs_review + '、無法解析 ' + r.counts.invalid + '）；一對多 ' + r.counts.systems + ' 筆');
  var d = r.diff && r.diff.products;
  if (d) lines.push('新增 ' + d.added.length + '、更新 ' + d.updated.length + '（尺寸變更 ' + d.spec_changed.length + '）、停用 ' + d.deactivated.length + '、恢復 ' + d.reactivated.length);
  if (d && r.status === 'preview') {
    if (d.added.length) lines.push('將新增：' + d.added.slice(0, 20).join('、'));
    if (d.updated.length) lines.push('將更新：' + d.updated.slice(0, 20).join('、'));
    if (d.deactivated.length) lines.push('將停用：' + d.deactivated.slice(0, 20).join('、'));
  }
  if (r.review && r.review.length) {
    lines.push('\n待確認／無法解析（' + r.review.length + ' 筆）：');
    r.review.slice(0, 25).forEach(function (x) { lines.push('第 ' + x.row + ' 列 ' + x.model + '：' + x.issues.join('；')); });
    if (r.review.length > 25) lines.push('…其餘 ' + (r.review.length - 25) + ' 筆請看執行記錄');
    console.log(JSON.stringify(r.review));
  }
  if (r.warnings && r.warnings.length) lines.push('警告：\n- ' + r.warnings.slice(0, 10).join('\n- '));
  if (r.error) lines.push('原因：' + r.error);
  return lines.join('\n');
}
function productSyncShow_(r) { SpreadsheetApp.getUi().alert('LG 產品同步', productSyncSummary_(r), SpreadsheetApp.getUi().ButtonSet.OK); }
function productSyncHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function productSyncMd5_(s) { return productSyncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)); }
