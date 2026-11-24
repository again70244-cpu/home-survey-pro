import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2200)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" role="status">
          <div key={msg} className="glass-dark hsp-toast rounded-full px-5 py-3 text-sm tracking-wide">{msg}</div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
