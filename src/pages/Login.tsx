import { useState } from 'react'
import { isAdminRole } from '../lib/permissions'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/ui'

type Mode = 'login' | 'signup' | 'reset'

export function Login() {
  const { session, profile, signIn, signUp, resetPassword, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  if (!loading && session && profile) {
    return <Navigate to={isAdminRole(profile.role) ? '/' : '/t'} replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password)
      } else if (mode === 'signup') {
        await signUp(email.trim(), password, fullName.trim())
        setMsg({
          kind: 'ok',
          text: 'Cuenta creada. Si el proyecto exige confirmación por correo, revisa tu bandeja antes de ingresar.',
        })
        setMode('login')
      } else {
        await resetPassword(email.trim())
        setMsg({ kind: 'ok', text: 'Te enviamos un enlace para restablecer la contraseña.' })
      }
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Error desconocido' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-3 h-20 w-20" ring />
          <h1 className="text-xl font-semibold text-white">Pescadería Bilagay</h1>
          <p className="mt-1 text-sm text-navy-300">Gestión de distribuidora de pescado fresco</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
            >
              Ingresar
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-md py-1.5 font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
            >
              Crear cuenta
            </button>
          </div>

          {mode === 'signup' && (
            <div className="rounded-lg bg-navy-50 px-3 py-2.5 text-xs text-navy-800">
              <p className="font-medium">Las cuentas se crean por invitación</p>
              <p className="mt-0.5 text-navy-700/80">
                Usa el mismo correo que el administrador autorizó. Cualquier otro será rechazado.
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="label">Nombre completo</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Juan Pérez"
                required
              />
            </div>
          )}

          <div>
            <label className="label">Correo</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@empresa.cl"
              autoComplete="email"
              required
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="label">Contraseña</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />
            </div>
          )}

          {msg && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                msg.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {msg.text}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'login' ? 'Ingresar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}
            className="w-full text-center text-xs text-slate-500 hover:text-navy-700"
          >
            {mode === 'reset' ? 'Volver al inicio de sesión' : '¿Olvidaste tu contraseña?'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-navy-300">
          El acceso lo crea el administrador desde <strong className="text-navy-100">Cuentas y accesos</strong>.
          <br />
          Si tu correo no está autorizado, el registro no se completará.
        </p>
      </div>
    </div>
  )
}
