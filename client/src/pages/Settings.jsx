import { useState } from 'react';
import { get, patch, del, timeAgo } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Field, useLoad, useAction } from '../components/ui.jsx';
import { LogoutIcon, SunIcon, MoonIcon } from '../components/Icons.jsx';

export default function Settings() {
  const { user, setUser, showToast, logout, theme, toggleTheme } = useApp();
  const [name, setName] = useState(user.name);
  const [room, setRoom] = useState(user.room_no || '');
  const [busy, run] = useAction(showToast);
  const sessions = useLoad(() => get('/auth/sessions'), []);

  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => patch('/users/me', { name, room_no: room }), 'Saved');
    if (r) setUser(r.user);
  };
  const toggle = async (k) => {
    const r = await run(() => patch('/users/me', { [k]: !user[k] }));
    if (r) setUser(r.user);
  };
  const endSession = async (s) => {
    const r = await run(() => del(`/auth/sessions/${s.id}`), 'Logged out that device');
    if (r) { if (s.current) setUser(null); else sessions.reload(true); }
  };

  const emails = [
    ['email_borrow', 'Borrow updates', 'Requests, approvals, returns, problem reports'],
    ['email_reminders', 'Due date reminders', 'One day before, on the due day and when late'],
    ['email_urgent', 'Urgent wanted posts', 'When someone in your circle urgently needs something'],
    ['email_auctions', 'Giveaways & auctions', 'Outbid, won, picked for a giveaway'],
  ];

  return (
    <div className="page narrow">
      <PageHead title="Settings" />
      <form className="card stack" onSubmit={save}>
        <h3>Your profile</h3>
        <p className="muted small">Others in your circles only see your name, room/flat number and badges. Never your email or phone.</p>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></Field>
        <Field label="Room / flat number (optional)"><input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. C-204" maxLength={30} /></Field>
        <p className="muted small">Email: {user.email}</p>
        <button className="btn btn-primary self-start" disabled={busy}>Save</button>
      </form>

      <section className="card stack">
        <h3>Email notifications</h3>
        <p className="muted small">You always see everything in the app. Login codes are always emailed.</p>
        {emails.map(([k, label, desc]) => (
          <label key={k} className="toggle-card">
            <input type="checkbox" checked={!!user[k]} onChange={() => toggle(k)} disabled={busy} />
            <span><b>{label}</b><span className="muted small">{desc}</span></span>
          </label>
        ))}
      </section>

      <section className="card stack">
        <h3>Look</h3>
        <button className="btn self-start" onClick={toggleTheme}>{theme === 'dark' ? <><SunIcon size={18} /> Switch to light mode</> : <><MoonIcon size={18} /> Switch to dark mode</>}</button>
      </section>

      <section className="card stack">
        <h3>Logged-in devices</h3>
        <div className="list">
          {sessions.data?.sessions.map((s) => (
            <div key={s.id} className="list-row static">
              <span className="list-main"><b>{s.device_label}{s.current ? ' (this device)' : ''}</b><span className="muted small">Last used {timeAgo(s.last_seen_at)}</span></span>
              <button className="btn btn-sm" disabled={busy} onClick={() => endSession(s)}>Log out</button>
            </div>
          ))}
        </div>
        <button className="btn btn-danger-ghost self-start" onClick={logout}><LogoutIcon size={18} /> Log out</button>
      </section>
    </div>
  );
}
