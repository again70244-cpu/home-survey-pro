import { Navigate, useParams } from 'react-router-dom'

/** 舊的區域頁網址：尺寸與照片已改在場勘頁直接編輯，導回場勘頁 */
export function AreaPage() {
  const { id } = useParams()
  return <Navigate to={`/survey/${id}`} replace />
}
