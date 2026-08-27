import { useEffect, useState } from 'react'
import { Check, Copy, Share, Smartphone, SquarePlus } from 'lucide-react'
import { Card, CardHeader, Logo } from './ui'
import { esIOS, estaInstalada, haySugerencia, instalar, suscribir } from '../lib/instalar'

/**
 * Instalar la aplicación en el teléfono. Instalada se abre a pantalla completa,
 * con su ícono propio y sin la barra del navegador, que es como la usa el
 * personal en terreno.
 *
 * Tres estados posibles y ninguno se puede forzar: si el navegador ofreció la
 * instalación se muestra el botón; en iPhone no existe ese aviso y hay que
 * explicar el gesto; y si ya está instalada, se dice y se acaba.
 */
export function InstalarApp() {
  const [disponible, setDisponible] = useState(haySugerencia())
  const [instalada, setInstalada] = useState(estaInstalada())
  const [estado, setEstado] = useState<'idle' | 'rechazado'>('idle')
  const [copiado, setCopiado] = useState(false)
  const ios = esIOS()
  const enlace = window.location.origin + window.location.pathname

  useEffect(() => suscribir(() => {
    setDisponible(haySugerencia())
    setInstalada(estaInstalada())
  }), [])

  return (
    <Card>
      <CardHeader title="Instalar en el teléfono" />
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        <Logo className="h-16 w-16 shrink-0 sm:h-20 sm:w-20" />

        <div className="min-w-0 flex-1 space-y-3">
          {instalada ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" />
              Ya está instalada en este dispositivo.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Instalada se abre a pantalla completa, con su ícono propio y sin la barra del
              navegador. Funciona igual que una aplicación de la tienda, pero se actualiza sola.
            </p>
          )}

          {!instalada && disponible && (
            <div>
              <button
                className="btn-primary"
                onClick={async () => {
                  const r = await instalar()
                  if (r === 'rechazado') setEstado('rechazado')
                }}
              >
                <Smartphone className="h-4 w-4" /> Instalar ahora
              </button>
              {estado === 'rechazado' && (
                <p className="mt-2 text-xs text-slate-500">
                  Se canceló la instalación. Puedes volver a intentarlo desde el menú del
                  navegador, en «Instalar aplicación».
                </p>
              )}
            </div>
          )}

          {!instalada && !disponible && ios && (
            <ol className="space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <Paso n={1} />
                <span>
                  Abre esta página en <span className="font-medium">Safari</span> (no funciona
                  desde Chrome ni desde otra aplicación).
                </span>
              </li>
              <li className="flex gap-2">
                <Paso n={2} />
                <span className="flex flex-wrap items-center gap-1">
                  Toca <Share className="inline h-4 w-4 text-sea-600" />
                  <span className="font-medium">Compartir</span>, abajo en la barra.
                </span>
              </li>
              <li className="flex gap-2">
                <Paso n={3} />
                <span className="flex flex-wrap items-center gap-1">
                  Elige <SquarePlus className="inline h-4 w-4 text-sea-600" />
                  <span className="font-medium">Agregar a pantalla de inicio</span> y confirma.
                </span>
              </li>
            </ol>
          )}

          {!instalada && !disponible && !ios && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Este navegador todavía no ofrece la instalación. En Android abre el menú de
              Chrome (⋮) y elige <span className="font-medium">Instalar aplicación</span>; en
              iPhone hay que hacerlo desde Safari, con Compartir → Agregar a pantalla de inicio.
            </p>
          )}

          {/* El enlace sirve para mandárselo al personal por WhatsApp y que lo
              instalen ellos desde su propio teléfono. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">Enlace para el equipo:</span>
            <code className="max-w-full truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
              {enlace}
            </code>
            <button
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(enlace)
                setCopiado(true)
                setTimeout(() => setCopiado(false), 1800)
              }}
            >
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Paso({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
      {n}
    </span>
  )
}
