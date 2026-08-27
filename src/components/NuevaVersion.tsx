import { useCallback, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'

/** Cada cuánto se le pregunta al servidor si hay una versión nueva. */
const CADA = 60_000

/**
 * Aviso de versión nueva.
 *
 * El registro que inyectaba el plugin llamaba a `serviceWorker.register()` una
 * sola vez, al cargar, y nunca volvía a comprobar. Como esto es una aplicación
 * de una sola página, moverse entre pantallas no recarga nada: quien dejaba la
 * pestaña abierta —o usaba la aplicación instalada, que casi nunca se cierra—
 * se quedaba con el JavaScript viejo por días, sin enterarse. Las correcciones
 * se desplegaban y para esa persona no existían.
 *
 * Ahora se pregunta cada minuto y, cuando hay algo nuevo, se avisa. No se
 * recarga a la fuerza mientras alguien puede estar escribiendo un cobro: se
 * aplica sola al volver a la aplicación después de dejarla en segundo plano,
 * que es un momento sin nada a medio hacer, o antes si se toca el aviso.
 */
export function NuevaVersion() {
  const {
    needRefresh: [hayNueva],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (!registro) return
      setInterval(() => {
        // `update()` va al servidor a mirar si cambió el service worker.
        // Si no hay conexión falla y no pasa nada: se reintenta al minuto.
        registro.update().catch(() => {})
      }, CADA)
    },
  })

  /**
   * Aplica la versión nueva y recarga.
   *
   * `updateServiceWorker(true)` recarga sola solo si había un service worker
   * *en espera* al que mandarle la orden. Cuando la pestaña todavía no está
   * controlada —el primer arranque tras registrar— el nuevo se activa de una y
   * no queda nada en espera: se pedía el cambio, no pasaba nada y el aviso
   * quedaba ahí para siempre. Por eso la recarga se fuerza igual.
   */
  const aplicar = useCallback(() => {
    void updateServiceWorker(true)
    setTimeout(() => window.location.reload(), 1000)
  }, [updateServiceWorker])

  // Volver a la aplicación tras dejarla en segundo plano es el momento seguro
  // para aplicarla: no hay un formulario a medio llenar.
  useEffect(() => {
    if (!hayNueva) return
    const alVolver = () => {
      if (document.visibilityState === 'visible') aplicar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [hayNueva, aplicar])

  if (!hayNueva) return null

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-[1200] flex justify-center px-4 pb-4">
      <div className="flex items-center gap-3 rounded-xl bg-navy-900 px-4 py-3 text-sm text-white shadow-lg">
        <RefreshCw className="h-4 w-4 shrink-0 text-sea-400" />
        <span>Hay una versión nueva del sistema.</span>
        <button
          onClick={aplicar}
          className="shrink-0 rounded-lg bg-sea-600 px-3 py-1.5 text-xs font-medium hover:bg-sea-500"
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
