import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { LogoMark } from '../components/Icons.jsx';
import { ThemeToggle } from '../components/Layout.jsx';

export default function Auth({ mode }) {
  const { setUser } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  const sendCode = async (e) => {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await post(signup ? '/auth/signup' : '/auth/login', { name, email });
      setDevCode(r.devCode || null);
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await post('/auth/verify', { email, code });
      let next = '/';
      try { next = sessionStorage.getItem('bb_next') || '/'; sessionStorage.removeItem('bb_next'); } catch { /* ignore */ }
      setUser(r.user);
      nav(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth-top"><ThemeToggle /></div>
      <div className="auth-card card">
        <div className="auth-brand"><LogoMark size={44} /><span>BorrowBox</span></div>
        <p className="auth-tag">Borrow from your hostel, class or building instead of buying. We keep track so nothing gets lost and nobody feels awkward to ask.</p>

        {step === 'form' ? (
          <form onSubmit={sendCode} className="stack">
            <h2>{signup ? 'Create your account' : 'Log in'}</h2>
            {signup && (
              <label className="field">
                <span className="field-label">Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" autoComplete="name" required maxLength={40} />
              </label>
            )}
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" autoComplete="email" required />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
            <p className="muted small center">
              {signup ? <>Already have an account? <Link to="/login">Log in</Link></> : <>New here? <Link to="/signup">Sign up</Link></>}
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <h2>Check your email</h2>
            <p className="muted">We sent a 6-digit code to <b>{email}</b>. It works for 10 minutes.</p>
            {devCode && <p className="dev-code">Dev mode – your code is <b>{devCode}</b></p>}
            <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus required />
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : signup ? 'Create account' : 'Log in'}</button>
            <div className="row-between small">
              <button type="button" className="link-btn" onClick={() => { setStep('form'); setCode(''); setError(''); }}>Change email</button>
              <button type="button" className="link-btn" onClick={sendCode} disabled={busy}>Send a new code</button>
            </div>
            <p className="muted small center">You will stay logged in on this device.</p>
          </form>
        )}
      </div>
    </div>
  );
}
