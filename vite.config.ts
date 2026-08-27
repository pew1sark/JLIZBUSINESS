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
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'logo.svg', 'apple-touch-icon.png'],
      manifest: {
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
})
