/** 型號、文字、網址的正規化；以及去除價格字樣（價格絕不可進入產品知識庫） */
import { toHalfWidth } from './installText.ts'

/** 拆解「產品型號」欄：「型號 + 空白 + 描述」 */
export function splitModelCell(raw: string | null | undefined): { modelCode: string; modelToken: string; description: string } | null {
  const s = toHalfWidth(raw ?? '')
    .replace(/\s*\/\s*/g, '/') // 「LSU93DHP / LSN93DHP」→「LSU93DHP/LSN93DHP」
    .trim()
  if (!s) return null
  const m = s.match(/^(\S+)\s*([\s\S]*)$/)
  if (!m) return null
  const modelToken = m[1]
  const modelCode = normalizeModelCode(modelToken)
  if (!/[A-Z]/.test(modelCode) || !/\d/.test(modelCode)) return null // 不像型號（例如標題列、空白列）
  return { modelCode, modelToken, description: m[2].replace(/\s+/g, ' ').trim() }
}

/** 正規化型號：半形、去空白、大寫 → 作為唯一鍵的一部分 */
export function normalizeModelCode(s: string): string {
  return toHalfWidth(s).replace(/\s+/g, '').toUpperCase()
}

/** 顯示名稱：去除通路／銷售限制字樣（原始描述另外完整保留） */
export function displayNameFrom(description: string): string {
  return description
    .replace(/^[A-Z]\s*\//, '') // 「C/AI智控…」前綴
    .replace(/\/?\s*(?:網購|集盛|量販|通路)(?:\s*[+＋、]\s*(?:網購|集盛|量販|通路))*\s*禁售/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 去除金額字樣：$11900、NT$1,200、1200元 */
export function stripPrices(s: string): { text: string; removed: boolean } {
  const re = /(?:NT\s*)?\$\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*元/gi
  const removed = re.test(s)
  return { text: s.replace(re, '').replace(/[ \t]{2,}/g, ' ').trim(), removed }
}

/** 從儲存格取出網址（支援全形逗號、換行、空白分隔），去重 */
export function extractUrls(...cells: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const c of cells) {
    for (const part of toHalfWidth(c ?? '').split(/[,\s，、;]+/)) {
      const u = part.trim()
      if (!/^https?:\/\/[^\s]+$/i.test(u)) continue
      try {
        const url = new URL(u)
        if (!out.includes(url.href)) out.push(url.href)
      } catch {
        /* 無效網址略過 */
      }
    }
  }
  return out
}

export function cleanText(s: string | null | undefined): string | null {
  const t = toHalfWidth(s ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return t || null
}
