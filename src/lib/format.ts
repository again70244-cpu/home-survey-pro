export function formatDate(d: string | null): string {
  if (!d) return '未填日期'
  const [y, m, day] = d.split('-')
  return `${y}/${m}/${day}`
}

/** 尺寸顯示：null 一律顯示「尚未測量」，不當成 0 */
export function formatCm(v: number | null): string {
  return v === null || v === undefined ? '尚未測量' : `${v} cm`
}

export function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '')
}
