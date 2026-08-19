/** Exportación a CSV con BOM, para que Excel abra bien los acentos. */
export function descargarCsv(filas: (string | number | null)[][], nombre: string) {
  const csv = filas
    .map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
