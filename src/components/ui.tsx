import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

/* 白樺（Birch）風格元件：純白、細線、黑色方角按鈕、無陰影 */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white tracking-[0.12em] active:bg-black disabled:bg-ink/40',
  secondary: 'bg-white text-ink border border-ink active:bg-sand',
  danger: 'bg-white text-red-700 border border-red-200 active:bg-red-50',
  ghost: 'text-ink active:bg-sand',
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex min-h-12 items-center justify-center gap-2 px-4 text-[15px] font-normal transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  )
}

/** 區段：不用卡片框，以上方細線分隔 */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`border-t border-line py-5 ${className}`}>{children}</section>
}

/** 區段標題：小字、加寬字距 */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-xs font-medium tracking-[0.18em] text-sub">{children}</h2>
      {right}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs tracking-[0.12em] text-sub">
        {label}
        {hint && <span className="ml-1.5 tracking-normal text-[#a3a3a3]">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'block w-full border-0 border-b border-[#d4d4d4] bg-transparent px-0 py-2.5 text-[17px] text-ink focus:border-ink focus:outline-none focus:ring-0'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${inputCls} resize-none ${props.className ?? ''}`} />
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="border-l-2 border-red-700 bg-red-50 px-3.5 py-3 text-sm text-red-800">{children}</div>
}

export function InfoBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="border-l-2 border-ink bg-sand px-3.5 py-3 text-sm text-ink">{children}</div>
}

/** 頂部列：左側返回、右側文字按鈕；不放置中標題（標題改在頁面內以大字呈現） */
export function TopBar({ title, left, right }: { title?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-3">
        <div className="flex min-w-12 justify-start">{left}</div>
        <div className="flex-1 truncate text-center text-sm text-sub">{title}</div>
        <div className="flex min-w-12 justify-end">{right}</div>
      </div>
    </header>
  )
}

/** 頁面大標題 */
export function PageTitle({ eyebrow, title, meta }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="pb-6 pt-2">
      {eyebrow && <div className="text-xs tracking-[0.2em] text-sub">{eyebrow}</div>}
      <h1 className="mt-2 break-words text-[34px] font-light leading-tight tracking-tight text-ink">{title}</h1>
      {meta && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#555]">{meta}</div>}
    </div>
  )
}

export function IconButton({ label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className="flex h-11 min-w-11 items-center justify-center gap-1 px-1 text-[15px] text-ink active:bg-sand"
    >
      {children}
    </button>
  )
}

/** 文字按鈕（加底線） */
export function TextButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`h-11 px-2 text-[15px] text-ink underline decoration-1 underline-offset-4 active:bg-sand ${className}`}>
      {children}
    </button>
  )
}

/** 固定在底部的主要動作列 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  )
}

const svg = (d: ReactNode, size = 20, w = 1.4) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

export const Icon = {
  back: svg(<path d="M15 18l-6-6 6-6" />, 22),
  plus: svg(<path d="M12 5v14M5 12h14" />, 20),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>, 19),
  user: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>, 21),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>, 21),
  edit: svg(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />, 19),
  chevron: svg(<path d="M9 6l6 6-6 6" />, 18),
  camera: svg(<><path d="M3 8h3l2-3h8l2 3h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></>, 20),
  image: svg(<><rect x="3" y="4" width="18" height="16" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>, 20),
  report: svg(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>, 18),
}
