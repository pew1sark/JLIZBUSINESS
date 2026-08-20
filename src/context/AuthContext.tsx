import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { can, type Action, type Resource } from '../lib/permissions'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  can: (resource: Resource, action?: Action) => boolean
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, avatar_url, role, is_active, created_at')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setError('No se pudo cargar el perfil: ' + error.message)
      setProfile(null)
      return
    }
    if (data && !data.is_active) {
      setError('Tu cuenta está desactivada. Contacta al administrador.')
      await supabase.auth.signOut()
      setProfile(null)
      return
    }
    setProfile(data as Profile | null)
  }

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      if (newSession?.user) {
        await loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value: AuthState = {
    session,
    profile,
    loading,
    error,
    async signIn(email, password) {
      setError(null)
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(traducirError(error.message))
    },
    async signUp(email, password, fullName) {
      setError(null)
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) throw new Error(traducirError(error.message))
    },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
      })
      if (error) throw new Error(traducirError(error.message))
    },
    async signOut() {
      await supabase.auth.signOut()
      setProfile(null)
      setSession(null)
    },
    async refreshProfile() {
      if (session?.user) await loadProfile(session.user.id)
    },
    can: (resource, action = 'read') => can(profile?.role, resource, action),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function traducirError(msg: string) {
  // El alta de usuario rechaza los correos no invitados desde la base de datos.
  // Supabase devuelve ese fallo envuelto en un error genérico, así que hay que
  // reconocerlo acá para poder decirle a la persona qué le pasó realmente.
  if (/no está autorizado/i.test(msg)
      || /Database error saving new user/i.test(msg)
      || /unexpected_failure/i.test(msg)) {
    return 'Tu correo no está autorizado para crear una cuenta. El administrador debe darte acceso primero desde Cuentas y accesos.'
  }
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.'
  if (/Email not confirmed/i.test(msg)) return 'Debes confirmar tu correo antes de ingresar.'
  if (/User already registered/i.test(msg)) return 'Ese correo ya está registrado.'
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera unos minutos.'
  return msg
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
