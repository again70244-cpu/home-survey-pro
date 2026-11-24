/**
 * 按鍵回饋：玻璃按鈕按下時，從手指位置擴散光波；主要按鈕外框發光，Android 輕震 10ms
 * 以事件委派掛在 document，所有 .glass／.glass-dark 的按鈕與連結自動套用，不需要逐一修改元件
 * 系統開啟「減少動態效果」時不產生光波、不震動
 */
export function initPressFeedback() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reduce?.matches || e.button > 0) return
      const el = (e.target as Element | null)?.closest?.('button.glass, a.glass, button.glass-dark, a.glass-dark') as HTMLElement | null
      if (!el || (el as HTMLButtonElement).disabled) return
      const r = el.getBoundingClientRect()
      const dot = document.createElement('span')
      dot.className = 'hsp-ripple'
      dot.setAttribute('aria-hidden', 'true')
      dot.style.left = `${e.clientX - r.left}px`
      dot.style.top = `${e.clientY - r.top}px`
      el.appendChild(dot)
      dot.addEventListener('animationend', () => dot.remove(), { once: true })
      window.setTimeout(() => dot.remove(), 800) // 動畫事件沒觸發時的保險
      if (el.classList.contains('glass-dark')) {
        el.classList.remove('hsp-glow')
        void el.offsetWidth // 重新觸發動畫
        el.classList.add('hsp-glow')
        navigator.vibrate?.(10)
      }
    },
    { passive: true },
  )
}
