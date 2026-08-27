/**
 * Instalación de la aplicación en el teléfono.
 *
 * El navegador avisa que se puede instalar con `beforeinstallprompt`, y lo hace
 * una sola vez y temprano — normalmente antes de que el usuario llegue a
 * Configuración. Por eso el evento se captura al arrancar, desde `main.tsx`, y
 * se guarda acá: cuando la pantalla se monta, el prompt ya está esperando.
 *
 * iOS no implementa este evento: en iPhone la única vía es Compartir → Agregar
 * a pantalla de inicio, así que ahí se muestran las instrucciones a mano.
 */

interface PromptInstalacion extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let guardado: PromptInstalacion | null = null
const oyentes = new Set<() => void>()

const avisar = () => oyentes.forEach((f) => f())

/** Se llama una vez al arrancar la aplicación. */
export function escucharInstalacion() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Sin preventDefault el navegador muestra su propia barra y consume el
    // evento; queremos ofrecerlo desde Configuración, cuando el usuario lo pida.
    e.preventDefault()
    guardado = e as PromptInstalacion
    avisar()
  })
  window.addEventListener('appinstalled', () => {
    guardado = null
    avisar()
  })
}

export const suscribir = (f: () => void) => {
  oyentes.add(f)
  return () => { oyentes.delete(f) }
}

export const haySugerencia = () => guardado !== null

/** Lanza el diálogo del navegador. Devuelve si el usuario aceptó. */
export async function instalar(): Promise<'aceptado' | 'rechazado' | 'no_disponible'> {
  if (!guardado) return 'no_disponible'
  await guardado.prompt()
  const { outcome } = await guardado.userChoice
  // El prompt se consume: sirve una sola vez.
  guardado = null
  avisar()
  return outcome === 'accepted' ? 'aceptado' : 'rechazado'
}

/** Ya está corriendo como aplicación instalada, no dentro del navegador. */
export const estaInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // Safari en iOS no soporta display-mode y usa esta propiedad suya.
  (window.navigator as unknown as { standalone?: boolean }).standalone === true

export const esIOS = () => {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return false
  if (/iphone|ipod|ipad/i.test(ua)) return true
  // iPadOS se declara como Mac y solo se distingue por la pantalla táctil.
  // El descarte de Android va antes porque un Chrome emulando teléfono en un
  // Mac cumple esta condición y mostraba las instrucciones equivocadas.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}
