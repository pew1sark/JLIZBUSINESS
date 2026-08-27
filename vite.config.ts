import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base path para GitHub Pages (https://pew1sark.github.io/JLIZBUSINESS/)
export default defineConfig({
  base: '/JLIZBUSINESS/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' + registro desde la aplicación: con 'autoUpdate' el service
      // worker nuevo tomaba control, pero la pestaña abierta seguía corriendo
      // el JavaScript viejo hasta que alguien recargara a mano.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'logo.svg', 'apple-touch-icon.png', 'icon-maskable-512.png'],
      manifest: {
        // `id` fija la identidad de la aplicación instalada: sin él, cambiar
        // start_url haría que el sistema la trate como una aplicación distinta.
        id: '/JLIZBUSINESS/',
        lang: 'es-CL',
        dir: 'ltr',
        name: 'Pescadería Bilagay SpA · Gestión de pescado fresco',
        short_name: 'Bilagay',
        description: 'Gestión de compras, inventario, pedidos y reparto de Pescadería Bilagay SpA',
        theme_color: '#0b2545',
        background_color: '#0b2545',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/JLIZBUSINESS/',
        scope: '/JLIZBUSINESS/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android recorta el icono a la forma del sistema. El maskable trae
          // el sello mas chico sobre el fondo, para que el aro no quede cortado.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
})
