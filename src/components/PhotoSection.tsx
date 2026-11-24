import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addPhoto, deletePhoto, movePhoto, updatePhotoCaption } from '../db/repo'
import type { SurveyPhoto } from '../db/types'
import { compressImage } from '../lib/image'
import { ensurePhotoBlob, retrySync } from '../sync/engine'
import { useSyncState } from '../sync/useSync'
import { Card, Icon } from './ui'
import { useToast } from './Toast'

/** 照片顯示網址：本機優先，沒有才從雲端下載 */
export function usePhotoUrl(photoId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!photoId) return
    let alive = true
    let u: string | null = null
    ensurePhotoBlob(photoId).then((b) => {
      if (!alive) return
      if (!b) return setMissing(true)
      u = URL.createObjectURL(b)
      setUrl(u)
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [photoId])
  return { url, missing }
}

function PhotoStatus({ p }: { p: SurveyPhoto }) {
  const { phase } = useSyncState()
  const tag = (cls: string, t: string) => <span className={`block px-1.5 py-0.5 text-[11px] text-white ${cls}`}>{t}</span>
  if (p._syncError) return tag('bg-red-700', '上傳失敗')
  if (p._blobState === 'pending') return tag('bg-oak', phase === 'offline' ? '等待網路上傳' : phase === 'syncing' ? '上傳中…' : '待上傳')
  if (p._dirty) return tag('bg-oak', '尚未同步')
  return tag('bg-ink/70', '已上傳')
}

function PhotoCard({ p, index, total, onOpen }: { p: SurveyPhoto; index: number; total: number; onOpen: () => void }) {
  const { url, missing } = usePhotoUrl(p.id)
  const [caption, setCaption] = useState(p.caption ?? '')
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setCaption(p.caption ?? '')
  }, [p.caption])
  const save = () => {
    editing.current = false
    const v = caption.trim() || null
    if (v !== (p.caption ?? null)) void updatePhotoCaption(p.id, v)
  }
  return (
    <li>
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-sand-2" aria-label={`檢視照片 ${index + 1}`}>
        {url ? (
          <img src={url} alt={p.caption ?? `照片 ${index + 1}`} className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-sub">{missing ? '離線中，照片尚未下載' : '載入中…'}</span>
        )}
        <span className="absolute bottom-0 left-0"><PhotoStatus p={p} /></span>
        <span className="absolute right-0 top-0 bg-ink px-2 py-0.5 text-[11px] tabular-nums text-white">{String(index + 1).padStart(2, '0')}</span>
      </button>
      <div className="pt-1">
        <input
          value={caption}
          placeholder="照片說明"
          onFocus={() => (editing.current = true)}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-sm focus:border-ink focus:outline-none focus:ring-0"
          aria-label={`照片 ${index + 1} 說明`}
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button type="button" disabled={index === 0} onClick={() => void movePhoto(p.area_id, p.id, -1)} className="h-9 w-9 text-ink disabled:text-[#c9c9c9] active:bg-sand" aria-label={`照片 ${index + 1} 往前`}>←</button>
            <button type="button" disabled={index === total - 1} onClick={() => void movePhoto(p.area_id, p.id, 1)} className="h-9 w-9 text-ink disabled:text-[#c9c9c9] active:bg-sand" aria-label={`照片 ${index + 1} 往後`}>→</button>
          </div>
          <button
            type="button"
            onClick={() => confirm('確定刪除這張照片？') && void deletePhoto(p.id)}
            className="glass inline-flex h-9 items-center rounded-full px-3 text-[13px] text-red-700"
            aria-label={`刪除照片 ${index + 1}`}
          >
            刪除
          </button>
        </div>
      </div>
    </li>
  )
}

function Viewer({ photos, start, onClose }: { photos: SurveyPhoto[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const p = photos[i]
  const { url } = usePhotoUrl(p?.id)
  if (!p) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog">
      <div className="flex items-center justify-between p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white">
        <span className="text-sm">{i + 1} / {photos.length}</span>
        <button onClick={onClose} className="rounded-full bg-white/15 px-4 py-2 text-sm">關閉</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />}
        {i > 0 && <button onClick={() => setI(i - 1)} className="absolute left-0 top-0 h-full w-1/4" aria-label="上一張" />}
        {i < photos.length - 1 && <button onClick={() => setI(i + 1)} className="absolute right-0 top-0 h-full w-1/4" aria-label="下一張" />}
      </div>
      {p.caption && <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center text-white">{p.caption}</div>}
    </div>
  )
}

export function PhotoSection({ areaId, bare = false }: { areaId: string; bare?: boolean }) {
  const toast = useToast()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [view, setView] = useState<number | null>(null)
  const photos = useLiveQuery(
    async () =>
      (await db.survey_photos.where('area_id').equals(areaId).toArray())
        .filter((p) => !p.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    [areaId],
  )
  const failed = photos?.some((p) => p._syncError)

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    const list = [...files]
    setBusy({ done: 0, total: list.length })
    let ok = 0
    for (const f of list) {
      try {
        await addPhoto(areaId, await compressImage(f))
        ok++
      } catch (e) {
        toast(`有 1 張照片無法讀取：${e instanceof Error ? e.message : e}`)
      }
      setBusy({ done: ok, total: list.length })
    }
    setBusy(null)
    if (ok) toast(`已儲存 ${ok} 張照片到本機`)
  }

  const Wrap = bare ? 'div' : Card
  const btn = 'flex h-12 items-center justify-center gap-2 text-[15px] disabled:opacity-40'
  return (
    <Wrap>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[0.16em] text-sub">現場照片{photos?.length ? `（${photos.length}）` : ''}</h2>
        {failed && (
          <button onClick={() => void retrySync()} className="glass inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-red-700">
            重新上傳
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!!busy} onClick={() => camRef.current?.click()} className={`${btn} glass-dark rounded-full`}>
          {Icon.camera}拍照
        </button>
        <button type="button" disabled={!!busy} onClick={() => galRef.current?.click()} className={`${btn} glass rounded-full text-ink`}>
          {Icon.image}從相簿選取
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} data-testid="camera-input" />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} data-testid="gallery-input" />
      {busy && <p className="mt-3 text-sm text-sub">處理照片中… {busy.done}/{busy.total}</p>}
      {photos && photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
          {photos.map((p, i) => <PhotoCard key={p.id} p={p} index={i} total={photos.length} onOpen={() => setView(i)} />)}
        </ul>
      ) : (
        <p className="mt-3 bg-sand py-4 text-center text-sm text-oak">尚未拍照</p>
      )}
      {view !== null && photos && <Viewer photos={photos} start={view} onClose={() => setView(null)} />}
    </Wrap>
  )
}
