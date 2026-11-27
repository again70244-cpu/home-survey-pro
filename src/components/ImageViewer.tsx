/**
 * 全螢幕看圖（App 內，不跳到網頁）
 * - 超大圖片（例如 4181×7500）手機瀏覽器會畫不出來而變黑：先縮成約 1200 萬像素再顯示，放大仍清楚
 * - 雙指縮放、點兩下放大／還原、放大後可拖曳、未放大時左右滑動換圖
 * - 開關由路由 state 控制，所以手機的「返回」會關閉看圖，而不是離開產品頁
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'

/** 顯示用的最大像素數（手機可安全繪製的範圍內） */
export const MAX_VIEW_PIXELS = 12_000_000
const MAX_SCALE = 6

/** 回傳可安全顯示的圖片網址：小圖直接用原圖 blob；超大圖先縮小 */
function useDisplaySrc(url: string) {
  const [state, setState] = useState<{ src: string | null; failed: boolean; scaled: boolean }>({ src: null, failed: false, scaled: false })
  useEffect(() => {
    let alive = true
    let made: string | null = null
    setState({ src: null, failed: false, scaled: false })
    ;(async () => {
      try {
        const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        const bmp = await createImageBitmap(blob)
        const px = bmp.width * bmp.height
        let out: Blob = blob
        let scaled = false
        if (px > MAX_VIEW_PIXELS) {
          const k = Math.sqrt(MAX_VIEW_PIXELS / px)
          const c = document.createElement('canvas')
          c.width = Math.round(bmp.width * k)
          c.height = Math.round(bmp.height * k)
          const g = c.getContext('2d')!
          g.imageSmoothingQuality = 'high'
          g.drawImage(bmp, 0, 0, c.width, c.height)
          out = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.92))
          c.width = c.height = 0 // 釋放記憶體
          scaled = true
        }
        bmp.close()
        made = URL.createObjectURL(out)
        if (alive) setState({ src: made, failed: false, scaled })
      } catch {
        // 讀不到（例如舊瀏覽器不支援）：退回直接顯示原圖
        if (alive) setState({ src: url, failed: false, scaled: false })
      }
    })()
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])
  return state
}

type View = { s: number; x: number; y: number }

function Slide({ url, onSwipe }: { url: string; onSwipe: (dir: 1 | -1) => void }) {
  const { src, scaled } = useDisplaySrc(url)
  const [broken, setBroken] = useState(false)
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 })
  const [anim, setAnim] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef<{ start: View; d0: number; mx: number; my: number; px: number; py: number; moved: boolean; t: number } | null>(null)
  const lastTap = useRef(0)

  const clamp = (v: View): View => {
    const el = box.current
    if (!el || v.s <= 1) return { s: Math.max(1, v.s), x: 0, y: 0 }
    const w = el.clientWidth, h = el.clientHeight
    const mx = (w * (v.s - 1)) / 2, my = (h * (v.s - 1)) / 2
    return { s: Math.min(MAX_SCALE, v.s), x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) }
  }
  const rel = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: cx - r.left - r.width / 2, y: cy - r.top - r.height / 2 }
  }
  /** 以畫面上某點為中心縮放到 s */
  const zoomAt = (v: View, s: number, p: { x: number; y: number }): View => {
    const k = s / v.s
    return { s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }
  }

  const begin = () => {
    const arr = [...pts.current.values()]
    const mx = arr.reduce((a, p) => a + p.x, 0) / arr.length
    const my = arr.reduce((a, p) => a + p.y, 0) / arr.length
    const d0 = arr.length > 1 ? Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) : 0
    g.current = { start: view, d0, mx, my, px: mx, py: my, moved: g.current?.moved ?? false, t: g.current?.t ?? Date.now() }
  }
  const down = (e: RPointerEvent) => {
    box.current?.setPointerCapture(e.pointerId)
    if (!pts.current.size) g.current = null
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setAnim(false)
    begin()
  }
  const move = (e: RPointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g.current) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const arr = [...pts.current.values()]
    const G = g.current
    const mx = arr.reduce((a, p) => a + p.x, 0) / arr.length
    const my = arr.reduce((a, p) => a + p.y, 0) / arr.length
    if (Math.hypot(mx - G.mx, my - G.my) > 8) G.moved = true
    G.px = mx; G.py = my
    if (arr.length > 1 && G.d0 > 0) {
      G.moved = true
      const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y)
      const s = Math.max(0.8, Math.min(MAX_SCALE, G.start.s * (d / G.d0)))
      const c0 = rel(G.mx, G.my)
      const z = zoomAt(G.start, s, c0)
      setView({ s, x: z.x + (mx - G.mx), y: z.y + (my - G.my) })
    } else if (G.start.s > 1) {
      setView(clamp({ s: G.start.s, x: G.start.x + (mx - G.mx), y: G.start.y + (my - G.my) }))
    } else {
      setView({ s: 1, x: (mx - G.mx) * 0.9, y: 0 }) // 未放大：跟著手指橫移，放開後判斷是否換圖
    }
  }
  const up = (e: RPointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.delete(e.pointerId)
    const G = g.current
    if (pts.current.size) { begin(); return } // 還有手指：從目前狀態接續
    setAnim(true)
    if (!G) return
    const dx = G.px - G.mx
    if (!G.moved) {
      // 點一下／點兩下
      const now = Date.now()
      if (now - lastTap.current < 320) {
        lastTap.current = 0
        setView(view.s > 1.05 ? { s: 1, x: 0, y: 0 } : clamp(zoomAt(view, 2.5, rel(G.px, G.py))))
      } else lastTap.current = now
      return
    }
    if (G.start.s <= 1 && view.s <= 1.02) {
      if (Math.abs(dx) > 60) onSwipe(dx < 0 ? 1 : -1)
      setView({ s: 1, x: 0, y: 0 })
      return
    }
    setView(clamp(view))
  }

  const style = { transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`, transition: anim ? 'transform 420ms cubic-bezier(.22,1,.36,1)' : 'none' }
  return (
    <div
      ref={box}
      className="relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      data-testid="viewer-stage"
      data-scale={view.s.toFixed(2)}
    >
      {!src ? (
        <span className="hsp-spin h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80" aria-label="載入中" />
      ) : broken ? (
        <p className="px-8 text-center text-[15px] text-white/80">這張圖片無法顯示<br /><a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block underline underline-offset-4">改用瀏覽器開啟</a></p>
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          data-scaled={scaled ? '1' : '0'}
          className="pointer-events-none max-h-full max-w-full object-contain will-change-transform"
          style={style}
        />
      )}
    </div>
  )
}

export function ImageViewer({ urls, index, onIndex, onClose }: { urls: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true))
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < urls.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { cancelAnimationFrame(t); window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [index, urls.length, onClose, onIndex])

  const go = (d: 1 | -1) => { const n = index + d; if (n >= 0 && n < urls.length) onIndex(n) }
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="產品圖片"
      data-testid="image-viewer"
      className={`fixed inset-0 z-[100] flex flex-col bg-black transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 text-white">
        <span className="pl-2 text-[14px] tabular-nums text-white/70" data-testid="viewer-count">{urls.length > 1 ? `${index + 1} / ${urls.length}` : ''}</span>
        <button type="button" onClick={onClose} aria-label="關閉" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[22px] active:bg-white/20">×</button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Slide key={urls[index]} url={urls[index]} onSwipe={go} />
        {index > 0 && (
          <button type="button" aria-label="上一張" onClick={() => go(-1)} className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white sm:flex">‹</button>
        )}
        {index < urls.length - 1 && (
          <button type="button" aria-label="下一張" onClick={() => go(1)} className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white sm:flex">›</button>
        )}
      </div>
      <div className="pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 text-center text-[12px] text-white/45">
        {urls.length > 1 && (
          <div className="mb-2 flex justify-center gap-1.5" aria-hidden>
            {urls.map((u, i) => <i key={u} className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? 'w-4 bg-white/80' : 'w-1.5 bg-white/25'}`} />)}
          </div>
        )}
        雙指縮放・點兩下放大{urls.length > 1 ? '・左右滑動換圖' : ''}
      </div>
    </div>,
    document.body,
  )
}
