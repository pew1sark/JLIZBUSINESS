import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ReactNode } from 'react'

export interface PuntoMapa {
  id: string
  lat: number
  lng: number
  etiqueta?: string
  color?: string
  numero?: number | string
  popup?: ReactNode
}

/** Marcador propio: evita depender de las imágenes por defecto de Leaflet. */
function icono(color = '#0b2545', numero?: number | string) {
  const contenido = numero !== undefined && numero !== null ? String(numero) : ''
  return L.divIcon({
    className: '',
    html: `<div style="
        background:${color};
        width:28px;height:28px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid white;
        box-shadow:0 1px 4px rgba(0,0,0,.35);
        display:flex;align-items:center;justify-content:center;">
        <span style="transform:rotate(45deg);color:white;font-size:11px;font-weight:700;font-family:Inter,sans-serif">${contenido}</span>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 26],
    popupAnchor: [0, -24],
  })
}

function Encuadrar({ puntos }: { puntos: PuntoMapa[] }) {
  const map = useMap()
  useEffect(() => {
    if (!puntos.length) return
    if (puntos.length === 1) {
      map.setView([puntos[0].lat, puntos[0].lng], 14)
      return
    }
    map.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [40, 40],
      maxZoom: 15,
    })
  }, [puntos, map])
  return null
}

export function Mapa({
  puntos, alto = 380, ruta = false, origen,
}: {
  puntos: PuntoMapa[]
  alto?: number
  /** Une los puntos con una línea, en el orden recibido. */
  ruta?: boolean
  origen?: { lat: number; lng: number; etiqueta?: string }
}) {
  const centro = useMemo<[number, number]>(() => {
    if (puntos.length) return [puntos[0].lat, puntos[0].lng]
    if (origen) return [origen.lat, origen.lng]
    return [-33.45, -70.66]
  }, [puntos, origen])

  const linea = useMemo<[number, number][]>(() => {
    if (!ruta) return []
    const base: [number, number][] = origen ? [[origen.lat, origen.lng]] : []
    return [...base, ...puntos.map((p) => [p.lat, p.lng] as [number, number])]
  }, [ruta, puntos, origen])

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" style={{ height: alto }}>
      <MapContainer
        center={centro}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {origen && (
          <Marker position={[origen.lat, origen.lng]} icon={icono('#1eafa7', '★')}>
            <Popup>{origen.etiqueta ?? 'Bodega'}</Popup>
          </Marker>
        )}

        {puntos.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={icono(p.color, p.numero)}>
            {(p.popup || p.etiqueta) && <Popup>{p.popup ?? p.etiqueta}</Popup>}
          </Marker>
        ))}

        {linea.length > 1 && (
          <Polyline positions={linea} pathOptions={{ color: '#0b2545', weight: 3, opacity: 0.6, dashArray: '6 8' }} />
        )}

        <Encuadrar puntos={puntos} />
      </MapContainer>
    </div>
  )
}
