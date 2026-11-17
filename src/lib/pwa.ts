import { registerSW } from 'virtual:pwa-register'

/** PWA 狀態：新版本可用、可安裝到主畫面 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type PwaState = { needRefresh: boolean; canInstall: boolean; installed: boolean }

let state: PwaState = {
  needRefresh: false,
  canInstall: false,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
}
const subs = new Set<() => void>()
const set = (p: Partial<PwaState>) => {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
export const pwaStore = { get: () => state, subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)) }

let deferred: BeforeInstallPromptEvent | null = null
let updateSW: ((reload?: boolean) => Promise<void>) | null = null

export function initPwa() {
  // 不自動重新整理：避免業務在現場輸入到一半被打斷，改由使用者按「更新」
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => set({ needRefresh: true }),
    onRegisteredSW: (_url, reg) => reg && setInterval(() => void reg.update(), 60 * 60 * 1000),
  })
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    set({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ canInstall: false, installed: true })
  })
}

export async function applyUpdate() {
  await updateSW?.(true)
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  set({ canInstall: false })
  return outcome === 'accepted'
}
