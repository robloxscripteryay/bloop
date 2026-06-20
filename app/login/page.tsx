'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

export default function AuthPage() {
  const router = useRouter()
  const supabase = createClient()

  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [signupUsername, setSignupUsername] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (signupUsername.trim().length < 3) {
      setError('Username must be at least 3 characters.')
      return
    }
    if (signupPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        data: { username: signupUsername.trim() },
      },
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function enterAsGuest() {
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInAnonymously()
    setLoading(false)
    if (error) {
      // Most likely cause: Anonymous Sign-ins isn't toggled on yet in
      // Supabase Dashboard → Authentication → Sign In / Providers.
      setError('Guest mode isn\'t enabled yet on this project. Try logging in or signing up instead.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand-row">
          <div className="bloop-logo">B</div>
          <div className="brand">Bloop</div>
        </div>
        <p className="sub">Chat, share, and hang out — free, for everyone.</p>

        <div className="tab-switch">
          <button
            type="button"
            className={tab === 'login' ? 'active' : ''}
            onClick={() => { setTab('login'); setError('') }}
          >
            Log in
          </button>
          <button
            type="button"
            className={tab === 'signup' ? 'active' : ''}
            onClick={() => { setTab('signup'); setError('') }}
          >
            Sign up
          </button>
          <div
            className="tab-pill"
            style={{ transform: tab === 'signup' ? 'translateX(100%)' : 'translateX(0)' }}
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Log in to Bloop'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <div className="field">
              <label htmlFor="signup-username">Username</label>
              <input
                id="signup-username"
                type="text"
                placeholder="Pick a username"
                value={signupUsername}
                onChange={(e) => setSignupUsername(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                placeholder="you@example.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                placeholder="At least 6 characters"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
              />
            </div>
            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create account'}
            </button>
          </form>
        )}

        <div className="divider">or</div>
        <button className="guest-btn" type="button" onClick={enterAsGuest} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Continue as Guest'}
        </button>
        <p className="guest-note">
          Guests can chat in Global only. Create a free account to DM people, make rooms, and unlock colour themes.
        </p>
      </div>
    </div>
  )
}
