import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { escucharInstalacion } from './lib/instalar'

// El navegador avisa que se puede instalar una sola vez y temprano, antes de
// que se monte cualquier pantalla. Se engancha acá para no perder el aviso.
escucharInstalacion()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
