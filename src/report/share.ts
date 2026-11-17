import { zipSync } from 'fflate'

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files })
  } catch {
    return false
  }
}

/** 一次分享全部圖片（Android Chrome 原生分享選單，可選 LINE） */
export async function shareFiles(files: File[], title: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles(files)) return 'unsupported'
  try {
    await navigator.share({ files, title, text: title })
    return 'shared'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    throw e
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 逐張下載（間隔避免瀏覽器擋下多檔下載） */
export async function downloadAll(files: File[]) {
  for (const f of files) {
    downloadBlob(f, f.name)
    await new Promise((r) => setTimeout(r, 400))
  }
}

export async function zipFiles(files: { name: string; blob: Blob }[], level: 0 | 6 = 0): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level }]
  const out = zipSync(entries)
  return new Blob([out as BlobPart], { type: 'application/zip' })
}

/** 檔名不可含特殊字元 */
export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '客戶'
}
