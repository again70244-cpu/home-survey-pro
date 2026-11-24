import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])
  const show = useCallback((m: string) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    setMsg(m)
    setLeaving(false)
    // 停留 2.4 秒後慢慢淡出（0.7 秒），再移除
    timers.current = [window.setTimeout(() => setLeaving(true), 2400), window.setTimeout(() => setMsg(null), 3100)]
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" role="status">
          <div key={msg} className={`glass-dark rounded-full px-5 py-3 text-sm tracking-wide ${leaving ? 'hsp-toast-out' : 'hsp-toast'}`}>{msg}</div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
