/** 照片壓縮：長邊最多 2560px、JPEG 品質 0.85，保留尺寸刻度辨識度；同時去除 EXIF（含 GPS） */
export const MAX_EDGE = 2560
export const QUALITY = 0.85

export interface Compressed {
  blob: Blob
  width: number
  height: number
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // 舊瀏覽器退回 <img>
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function compressImage(file: Blob): Promise<Compressed> {
  const src = await loadBitmap(file)
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))
  const width = Math.round(w0 * scale)
  const height = Math.round(h0 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, width, height)
  if ('close' in src) src.close()
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('照片轉換失敗'))), 'image/jpeg', QUALITY),
  )
  canvas.width = canvas.height = 0 // 釋放記憶體
  return { blob, width, height }
}
