import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toBlob } from 'html-to-image'
import { db } from '../db/db'
import { useUserId } from '../auth/AuthProvider'
import { ensurePhotoBlob } from '../sync/engine'
import { Button, ErrorBox, Icon, IconButton, TopBar, PageTitle } from '../components/ui'
import { useToast } from '../components/Toast'
import { buildBlocks, buildReportData, CONTENT_H, paginate, PAGE_H, PAGE_W, type Block, type ReportData } from '../report/model'
import { BlockView, MeasureBox, ReportPage as PageView } from '../report/ReportView'
import { loadTemplateCheck } from '../components/TemplateCheck'
import { templateRowId } from '../db/repo'
import { describeValues, TEMPLATES } from '../templates'
import { customerItems } from '../report/customerText'
import { VARIANT_LABEL, type ReportCheck, type ReportVariant } from '../report/model'
import { canShareFiles, downloadAll, downloadBlob, safeName, shareFiles, zipFiles } from '../report/share'

/** 報告用照片：長邊 1800px、JPEG 0.92（輸出 2 倍解析度時欄寬約 1070px，清晰不糊） */
async function reportImageUrl(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const out = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('照片處理失敗'))), 'image/jpeg', 0.92))
  c.width = c.height = 0
  return URL.createObjectURL(out)
}

type Stage = { step: 'loading' | 'measuring' | 'rendering' | 'done' | 'error'; msg?: string; done?: number; total?: number }

export function ReportPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const variant: ReportVariant = params.get('v') === 'customer' ? 'customer' : 'installer'
  const userId = useUserId()
  const nav = useNavigate()
  const toast = useToast()
  const [stage, setStage] = useState<Stage>({ step: 'loading' })
  const [data, setData] = useState<ReportData | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [pages, setPages] = useState<Block[][] | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [missingPhotos, setMissingPhotos] = useState(0)
  const measureRefs = useRef(new Map<string, HTMLDivElement>())
  const contRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const urlsToRevoke = useRef<string[]>([])

  // 1. 讀取本機資料（以目前裝置上已保存的資料為準，不受同步狀態影響）
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const survey = await db.surveys.get(id!)
        if (!survey || survey.user_id !== userId || survey.deleted_at) throw new Error('找不到這筆場勘')
        const areas = (await db.survey_areas.where('survey_id').equals(id!).toArray()).filter((a) => !a.deleted_at).sort((a, b) => a.sort_order - b.sort_order)
        const photos = (await db.survey_photos.where('survey_id').equals(id!).toArray()).filter((p) => !p.deleted_at && areas.some((a) => a.id === p.area_id))
        const urls = new Map<string, string | null>()
        let missing = 0
        for (let i = 0; i < photos.length; i++) {
          setStage({ step: 'loading', msg: '準備照片', done: i, total: photos.length })
          const b = await ensurePhotoBlob(photos[i].id)
          if (!b) {
            urls.set(photos[i].id, null)
            missing++
            continue
          }
          const u = await reportImageUrl(b)
          urlsToRevoke.current.push(u)
          urls.set(photos[i].id, u)
        }
        if (!alive) return
        const products = (await db.survey_products.where('survey_id').equals(id!).toArray()).filter((p) => !p.deleted_at).sort((a, b) => a.sort_order - b.sort_order)
        const checks: ReportCheck[] = []
        for (const def of TEMPLATES) {
          const c = await loadTemplateCheck(def, id!, await templateRowId(id!, def.id))
          if (!c.result) continue
          checks.push({
            templateId: def.id,
            title: def.title,
            note: def.note,
            result: c.result,
            installAreaId: c.installArea?.id ?? null,
            installAreaName: c.installArea?.name ?? null,
            customer: customerItems(def.id, c.result.findings, areas),
            fields: describeValues(def, c.values),
            shots: def.shots.filter((s) => s.when?.(c.values) ?? true).map((s) => ({ label: s.label, done: c.shotsTaken.has(s.key) })),
          })
        }
        const d = buildReportData(survey, areas, photos, urls, products, checks, variant)
        setMissingPhotos(missing)
        setData(d)
        setBlocks(buildBlocks(d))
        setStage({ step: 'measuring' })
      } catch (e) {
        setStage({ step: 'error', msg: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      alive = false
      urlsToRevoke.current.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [id, userId, variant])

  // 2. 量測每個區塊高度 → 分頁
  useLayoutEffect(() => {
    if (stage.step !== 'measuring' || !blocks.length) return
    void document.fonts.ready.then(() => {
      const h = new Map<string, number>()
      for (const b of blocks) h.set(b.key, Math.ceil(measureRefs.current.get(b.key)?.getBoundingClientRect().height ?? 0))
      const contH = Math.ceil(contRef.current?.getBoundingClientRect().height ?? 40)
      // 客戶版頁數少：區域照片接在後面，不另起新頁
      setPages(paginate(blocks, h, contH, { areasOnNewPage: data?.variant !== 'customer' }))
      setStage({ step: 'rendering', done: 0 })
    })
  }, [stage.step, blocks, data])

  // 3. 逐頁轉成 PNG
  useEffect(() => {
    if (stage.step !== 'rendering' || !pages || !data) return
    let alive = true
    ;(async () => {
      try {
        const out: File[] = []
        const base = `場勘報告_${VARIANT_LABEL[data.variant]}_${safeName(data.survey.customer_name)}_${data.survey.survey_date ?? ''}`
        for (let i = 0; i < pages.length; i++) {
          const node = pageRefs.current[i]
          if (!node) throw new Error('頁面尚未準備好')
          await Promise.all([...node.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
          setStage({ step: 'rendering', done: i, total: pages.length })
          const content = node.children[1] as HTMLElement | undefined
          if (content && content.scrollHeight > CONTENT_H + 2) console.warn(`[report] 第 ${i + 1} 頁內容超出 ${content.scrollHeight - CONTENT_H}px`)
          const blob = await toBlob(node, { width: PAGE_W, height: PAGE_H, pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: false })
          if (!blob) throw new Error(`第 ${i + 1} 頁產生失敗`)
          out.push(new File([blob], `${base}_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' }))
          if (!alive) return
        }
        setFiles(out)
        setPreviews(out.map((f) => URL.createObjectURL(f)))
        setStage({ step: 'done' })
      } catch (e) {
        setStage({ step: 'error', msg: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      alive = false
    }
  }, [stage.step, pages, data])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const title = data ? `${data.survey.customer_name} 場勘報告（${VARIANT_LABEL[data.variant]}）` : '場勘報告'
  const shareSupported = files.length > 0 && canShareFiles(files)

  async function onShare() {
    try {
      const r = await shareFiles(files, title)
      if (r === 'unsupported') toast('此瀏覽器不支援一次分享多張圖片，請改用下載')
    } catch (e) {
      toast(`分享失敗：${e instanceof Error ? e.message : e}`)
    }
  }

  async function onZip() {
    const z = await zipFiles(files.map((f) => ({ name: f.name, blob: f })))
    downloadBlob(z, `場勘報告_${VARIANT_LABEL[data!.variant]}_${safeName(data!.survey.customer_name)}.zip`)
  }

  return (
    <div className="min-h-dvh pb-36">
      <TopBar left={<IconButton label="返回" onClick={() => nav(-1)}>{Icon.back}返回</IconButton>} />
      <main className="mx-auto max-w-2xl space-y-4 px-6">
        <PageTitle eyebrow="REPORT" title="場勘報告" />
        <div className="glass grid grid-cols-2 gap-1 rounded-full p-1" role="tablist" aria-label="報告版本">
          {(['installer', 'customer'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={variant === v}
              disabled={stage.step !== 'done' && stage.step !== 'error'}
              onClick={() => {
                if (v === variant) return
                setFiles([]); setPreviews([]); setPages(null); setBlocks([]); setData(null); setStage({ step: 'loading' })
                setParams(v === 'installer' ? {} : { v }, { replace: true })
              }}
              className={`h-11 rounded-full text-[15px] disabled:opacity-50 ${variant === v ? 'glass-dark' : 'text-ink active:bg-black/5'}`}
            >
              {VARIANT_LABEL[v]}
              <span className="ml-1.5 text-xs opacity-70">{v === 'installer' ? '給安裝人員' : '給客戶'}</span>
            </button>
          ))}
        </div>
        {stage.step === 'error' && <ErrorBox>產生報告失敗：{stage.msg}</ErrorBox>}
        {stage.step !== 'done' && stage.step !== 'error' && (
          <div className="border-y border-line py-10 text-center">
            <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-line border-t-ink" />
            <div className="text-lg font-light text-ink">
              {stage.step === 'loading' ? `準備照片 ${stage.done ?? 0}/${stage.total ?? 0}` : stage.step === 'measuring' ? '排版中…' : `產生圖片 ${(stage.done ?? 0) + 1}/${stage.total ?? '…'}`}
            </div>
            <div className="mt-1 text-sm text-sub">請稍候，照片較多時需要較長時間</div>
          </div>
        )}
        {missingPhotos > 0 && <ErrorBox>有 {missingPhotos} 張照片目前無法取得（離線且尚未下載到這台裝置），報告中會以文字標示。</ErrorBox>}
        {stage.step === 'done' && (
          <>
            <p className="text-sm text-[#555]">
              已產生 <b>{files.length}</b> 張報告圖片（A4 直式，{PAGE_W * 2}×{PAGE_H * 2}）。
            </p>
            <ul className="space-y-3">
              {previews.map((u, i) => (
                <li key={u} className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgb(70_50_25/0.12)]">
                  <img src={u} alt={`第 ${i + 1} 頁`} className="w-full" />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {stage.step === 'done' && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
          <div className="glass-card mx-auto max-w-2xl space-y-2 !rounded-[30px] p-3">
            {shareSupported ? (
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-14" onClick={() => void onShare()}>分享至 LINE</Button>
                <Button variant="secondary" className="h-14" onClick={() => void onShare()}>分享全部 {files.length} 張</Button>
              </div>
            ) : (
              <p className="rounded-2xl bg-white/70 px-3 py-2 text-sm text-ink">
                這個瀏覽器無法一次分享多張圖片。請「下載全部」或「下載 ZIP」後，到 LINE 選擇相簿中的圖片傳送。建議使用 Android Chrome。
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void downloadAll(files)}>下載全部（{files.length} 張）</Button>
              <Button variant="secondary" onClick={() => void onZip()}>下載 ZIP</Button>
            </div>
            {shareSupported && <p className="text-center text-xs text-sub">按「分享至 LINE」後，在分享選單中選擇 LINE，所有頁面會一次傳送</p>}
          </div>
        </div>
      )}

      {/* 離屏排版區：量測與轉圖用，不顯示在畫面上 */}
      <div aria-hidden data-report-pages style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}>
        {data && stage.step === 'measuring' && (
          <MeasureBox>
            {blocks.map((b) => (
              <div key={b.key} ref={(el) => void (el ? measureRefs.current.set(b.key, el) : measureRefs.current.delete(b.key))}>
                <BlockView b={b} d={data} />
              </div>
            ))}
            {data.areas.length > 0 && (
              <div ref={contRef}>
                <BlockView b={{ kind: 'area-cont', key: 'm', areaIndex: 0 }} d={data} />
              </div>
            )}
          </MeasureBox>
        )}
        {data && pages && (stage.step === 'rendering' || stage.step === 'done') &&
          pages.map((blks, i) => <PageView key={i} ref={(el) => void (pageRefs.current[i] = el)} blocks={blks} d={data} page={i + 1} total={pages.length} />)}
      </div>
    </div>
  )
}
