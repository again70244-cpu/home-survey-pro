import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addPhoto, deletePhoto, movePhoto, updatePhotoCaption } from '../db/repo'
import type { SurveyPhoto } from '../db/types'
import { compressImage } from '../lib/image'
import { ensurePhotoBlob, retrySync } from '../sync/engine'
import { useSyncState } from '../sync/useSync'
import { Card } from './ui'
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
  if (p._syncError) return <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">上傳失敗</span>
  if (p._blobState === 'pending')
    return <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">{phase === 'offline' ? '等待網路上傳' : phase === 'syncing' ? '上傳中…' : '待上傳'}</span>
  if (p._dirty) return <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">尚未同步</span>
  return <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">已上傳</span>
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
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full bg-slate-100" aria-label={`檢視照片 ${index + 1}`}>
        {url ? (
          <img src={url} alt={p.caption ?? `照片 ${index + 1}`} className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-slate-400">{missing ? '離線中，照片尚未下載' : '載入中…'}</span>
        )}
        <span className="absolute left-1.5 top-1.5"><PhotoStatus p={p} /></span>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-slate-900/60 px-2 py-0.5 text-xs text-white">{index + 1}</span>
      </button>
      <div className="space-y-1.5 p-2">
        <input
          value={caption}
          placeholder="照片說明"
          onFocus={() => (editing.current = true)}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          aria-label={`照片 ${index + 1} 說明`}
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <button type="button" disabled={index === 0} onClick={() => void movePhoto(p.area_id, p.id, -1)} className="h-9 w-9 rounded-lg border border-slate-200 disabled:opacity-30 active:bg-slate-100" aria-label={`照片 ${index + 1} 往前`}>←</button>
            <button type="button" disabled={index === total - 1} onClick={() => void movePhoto(p.area_id, p.id, 1)} className="h-9 w-9 rounded-lg border border-slate-200 disabled:opacity-30 active:bg-slate-100" aria-label={`照片 ${index + 1} 往後`}>→</button>
          </div>
          <button
            type="button"
            onClick={() => confirm('確定刪除這張照片？') && void deletePhoto(p.id)}
            className="h-9 rounded-lg px-2 text-sm text-red-600 active:bg-red-50"
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

export function PhotoSection({ areaId }: { areaId: string }) {
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

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500">現場照片 {photos?.length ? `（${photos.length}）` : ''}</h2>
        {failed && (
          <button onClick={() => void retrySync()} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 ring-1 ring-red-200">
            重新上傳
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!!busy} onClick={() => camRef.current?.click()} className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-brand-600 text-base font-semibold text-white active:bg-brand-700 disabled:opacity-50">
          <span className="text-2xl">📷</span>拍照
        </button>
        <button type="button" disabled={!!busy} onClick={() => galRef.current?.click()} className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-brand-600 text-base font-semibold text-brand-700 active:bg-brand-50 disabled:opacity-50">
          <span className="text-2xl">🖼️</span>從相簿選取
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} data-testid="camera-input" />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} data-testid="gallery-input" />
      {busy && <p className="mt-3 text-sm text-brand-700">處理照片中… {busy.done}/{busy.total}</p>}
      {photos && photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-3">
          {photos.map((p, i) => <PhotoCard key={p.id} p={p} index={i} total={photos.length} onOpen={() => setView(i)} />)}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 py-4 text-center text-sm text-amber-700">尚未拍照</p>
      )}
      {view !== null && photos && <Viewer photos={photos} start={view} onClose={() => setView(null)} />}
    </Card>
  )
}
