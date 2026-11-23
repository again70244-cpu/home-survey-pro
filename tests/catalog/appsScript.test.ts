/**
 * 在模擬的 Google Apps Script 環境執行 ProductSync.gs：
 * - 確認價格、促銷、LINE、業績欄位「從未被讀取」
 * - 確認送出的簽章能通過 Edge Function 驗證，且整條流程可寫入（本機 DB 存在時）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHmac, createHash, randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { handle } from '../../supabase/functions/product-sync/handler.ts'

const SECRET = 'apps-script-secret-0123456789abcdef0123456789'
const code = readFileSync(new URL('../../integrations/google-apps-script/ProductSync.gs', import.meta.url), 'utf8')

// 試算表內容：完全照實際欄位順序（含禁止同步的欄位）
const SHEETS: Record<string, string[][]> = {
  報價: [
    ['產品型號', '產品原價', '周年慶低售(6期)', '促銷/備註', '分類', '圖片網址', '圖片網址2', '圖片網址3', '圖片網址4', '安裝尺寸', '連結', '影片網址', '保養說明'],
    ['WD-S2220B      AI智控洗乾衣機/22洗20乾/尊爵黑', '114900', '94000', '贈品 MS2535GIS', '洗衣機', 'https://i.ibb.co/a.png，https://i.ibb.co/b.png', '', ' https://i.ibb.co/c.jpg', '', '寬70;高189;深83\n門開90度總深146\n電源線長度120\n進排水管長度100\n外箱尺寸寬75;高200;深86', '', '', ''],
    ['LSU93DHP/LSN93DHP 旗艦9.3KW', '84900', '75500', '', '冷氣/空調', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
  一對多報價: [
    ['室外機型號', '室外機原價', '室外機低售(6期)', '室內機1', '室內機2', '室內機3', '室內機4', '室內機5', '室內機6', '室內機7', '備註'],
    ['一對二 室外機 LM2U50(5.2KW)', '42,900', '39,500', 'LSN22DDHST極淨2.2KW $11900', 'LSN28DDHST極淨2.8KW  $12500', '', '', '', '', '', '搭配室內機2.2~4.1(相加總合不得超過6.3;相加總合不得低於4.2)'],
  ],
  白名單: [['姓名', 'LINE userID'], ['某人', 'Uxxxxxxxx']],
  LG業績: [['姓名', '月份', '空調目標台數'], ['某人', '', '10']],
}
const FORBIDDEN_HEADERS = ['產品原價', '周年慶低售(6期)', '促銷/備註', '室外機原價', '室外機低售(6期)']

function makeEnv(fetchResponse: { code: number; body: unknown }) {
  const reads: { sheet: string; row: number; col: number; rows: number; cols: number }[] = []
  const requests: { url: string; opts: any }[] = []
  const props = new Map<string, string>([['PRODUCT_SYNC_URL', 'https://x.supabase.co/functions/v1/product-sync'], ['PRODUCT_SYNC_SECRET', SECRET], ['PRODUCT_SYNC_DATASET', 'staging']])
  const sheet = (name: string) => {
    const data = SHEETS[name]
    if (!data) return null
    return {
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getRange: (row: number, col: number, rows: number, cols: number) => {
        reads.push({ sheet: name, row, col, rows, cols })
        const slice = data.slice(row - 1, row - 1 + rows).map((r) => r.slice(col - 1, col - 1 + cols))
        return { getDisplayValues: () => slice, getRichTextValues: () => slice.map((r) => r.map(() => ({ getLinkUrl: () => null }))) }
      },
    }
  }
  const signed = (bytes: Buffer) => [...bytes].map((b) => (b > 127 ? b - 256 : b))
  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => ({ getId: () => 'sheet-id', getSheetByName: sheet }), getUi: () => { throw new Error('no ui') } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v), deleteProperty: (k: string) => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }) },
    Utilities: {
      getUuid: () => randomUUID(),
      sleep: () => {},
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { MD5: 'md5' },
      computeHmacSha256Signature: (msg: string, key: string) => signed(createHmac('sha256', key).update(msg, 'utf8').digest()),
      computeDigest: (_a: string, s: string) => signed(createHash('md5').update(s, 'utf8').digest()),
    },
    UrlFetchApp: {
      fetch: (url: string, opts: any) => {
        requests.push({ url, opts })
        return { getResponseCode: () => fetchResponse.code, getContentText: () => JSON.stringify(fetchResponse.body) }
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(code, ctx)
  return { ctx: ctx as any, reads, requests, props }
}

describe('Google Apps Script（ProductSync.gs）', () => {
  it('只讀白名單欄位：價格、促銷欄位的資料從未被讀取；白名單／業績工作表完全沒被打開', () => {
    const { ctx, reads, requests } = makeEnv({ code: 200, body: { status: 'success' } })
    const r = vm.runInContext("productSyncRun_('manual', 'sync', false)", ctx)
    expect(r.status).toBe('success')
    const dataReads = reads.filter((x) => x.row >= 2)
    for (const rd of dataReads) {
      expect(rd.cols).toBe(1) // 一次只讀一欄
      const header = SHEETS[rd.sheet][0][rd.col - 1]
      expect(FORBIDDEN_HEADERS).not.toContain(header)
    }
    expect(reads.some((x) => x.sheet === '白名單' || x.sheet === 'LG業績')).toBe(false)
    const body = requests[0].opts.payload as string
    expect(body).not.toMatch(/114900|94000|84900|42,900|贈品|產品原價|促銷/)
    expect(body).not.toMatch(/Uxxxx|目標/)
  })

  it('簽章可通過 Edge Function 驗證；空白列不送出', async () => {
    const { ctx, requests } = makeEnv({ code: 200, body: { status: 'success' } })
    vm.runInContext("productSyncRun_('manual', 'sync', false)", ctx)
    const { url, opts } = requests[0]
    const sent = JSON.parse(opts.payload)
    expect(sent.products.rows.map((r: any) => r.row)).toEqual([2, 3]) // 第 4 列是空白列
    let forwarded: any = null
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      forwarded = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ status: 'success', counts: {}, diff: {} }), { status: 200 })
    }) as unknown as typeof fetch
    const req = new Request(url, { method: 'POST', headers: opts.headers, body: opts.payload })
    const res = await handle(req, { PRODUCT_SYNC_SECRET: SECRET, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }, fakeFetch)
    expect(res.status).toBe(200)
    expect(forwarded.p.products.map((p: any) => p.model_code)).toEqual(['WD-S2220B', 'LSU93DHP/LSN93DHP'])
    expect(forwarded.p.products[0].image_urls).toEqual(['https://i.ibb.co/a.png', 'https://i.ibb.co/b.png', 'https://i.ibb.co/c.jpg'])
    expect(JSON.stringify(forwarded)).not.toMatch(/\$|11900/)
  })

  it('定期同步：資料沒變就不呼叫伺服器；伺服器失敗時不記錄雜湊（下次自動重試）', () => {
    const ok = makeEnv({ code: 200, body: { status: 'success' } })
    vm.runInContext("productSyncRun_('schedule', 'sync', false)", ok.ctx)
    vm.runInContext("productSyncRun_('schedule', 'sync', false)", ok.ctx)
    expect(ok.requests).toHaveLength(1)

    const fail = makeEnv({ code: 502, body: { status: 'failed', error: 'db down' } })
    vm.runInContext("productSyncRun_('schedule', 'sync', false)", fail.ctx)
    expect(fail.props.get('PRODUCT_SYNC_LAST_HASH')).toBeUndefined()
    expect(fail.requests.length).toBe(3) // 伺服器錯誤自動重試 3 次
    vm.runInContext("productSyncRun_('schedule', 'sync', false)", fail.ctx)
    expect(fail.requests.length).toBe(6) // 下一次定期同步仍會再試
    expect(fail.props.get('PRODUCT_SYNC_LAST_RESULT')).toContain('失敗')
  })

  it('所有全域名稱都有前綴，不會覆蓋既有程式（例如 onOpen、setup、doGet）', () => {
    const names = [...code.matchAll(/^function\s+(\w+)/gm)].map((m) => m[1]).concat([...code.matchAll(/^var\s+(\w+)/gm)].map((m) => m[1]))
    expect(names.length).toBeGreaterThan(10)
    for (const n of names) expect(n).toMatch(/^(productSync|PS_)/)
    expect(code).not.toMatch(/function (onOpen|onEdit|doGet|doPost|setup)\b/)
  })

  it('網路中斷：重試後回報失敗，不拋出未處理例外', () => {
    const { ctx } = makeEnv({ code: 200, body: {} })
    ctx.UrlFetchApp.fetch = () => { throw new Error('Address unavailable') }
    const r = vm.runInContext("productSyncRun_('manual', 'sync', false)", ctx)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('已重試 3 次')
  })
})
