import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { Field, PageHead, Spinner, useLoad, useAction } from '../components/ui.jsx';
import { UsersIcon, ChevronIcon, CopyIcon, ShareIcon } from '../components/Icons.jsx';

export function inviteLink(code) {
  return `${window.location.origin}/join/${code}`;
}

export function InviteBox({ circle }) {
  const { showToast } = useApp();
  const link = inviteLink(circle.invite_code);
  const share = async () => {
    const text = `Join "${circle.name}" on BorrowBox so we can borrow and lend things. Code: ${circle.invite_code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'BorrowBox', text, url: link }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard?.writeText(`${text}\n${link}`);
      showToast('Invite copied');
    }
  };
  return (
    <div className="invite">
      <div>
        <span className="muted small">Invite code</span>
        <div className="invite-code">{circle.invite_code}</div>
      </div>
      <div className="row gap-s">
        <button className="btn btn-sm" onClick={async () => { await navigator.clipboard?.writeText(link); showToast('Link copied'); }}><CopyIcon size={16} /> Copy link</button>
        <button className="btn btn-sm btn-primary" onClick={share}><ShareIcon size={16} /> Share</button>
      </div>
    </div>
  );
}

export function CreateJoinForms({ compact = false }) {
  const { showToast, loadCircles, setCircleId } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [busy, run] = useAction(showToast);

  const create = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/circles', { name, description }), 'Circle created! Now invite people.');
    if (r) { await loadCircles(); setCircleId(r.circle.id); nav(`/c/${r.circle.id}/admin`); }
  };
  const join = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/circles/join', { code }), 'You joined the circle');
    if (r) { await loadCircles(); setCircleId(r.circle.id); nav('/'); }
  };

  return (
    <div className={compact ? 'grid-2' : 'grid-2'}>
      <form className="card stack" onSubmit={create}>
        <h3>Create a circle</h3>
        <p className="muted small">For your hostel block, class, building, office or friends. You will be the admin.</p>
        <Field label="Circle name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Hostel Block C" or "CSE 3rd Year"' required maxLength={50} /></Field>
        <Field label="Short description (optional)"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this for?" maxLength={200} /></Field>
        <button className="btn btn-primary" disabled={busy}>Create circle</button>
      </form>
      <form className="card stack" onSubmit={join}>
        <h3>Join with a code</h3>
        <p className="muted small">Got an invite code like <b>BX7-K2Q9</b> from a friend? Enter it here.</p>
        <Field label="Invite code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC-1234" required className="mono" /></Field>
        <button className="btn" disabled={busy}>Join circle</button>
      </form>
    </div>
  );
}

export default function Circles() {
  const { circles, setCircleId } = useApp();
  const nav = useNavigate();
  return (
    <div className="page">
      <PageHead title="My circles" sub="You can be in more than one circle. Things are only visible inside their own circle." />
      {circles.length > 0 && (
        <div className="list card">
          {circles.map((c) => (
            <button key={c.id} className="list-row" onClick={() => { setCircleId(c.id); nav('/'); }}>
              <span className="list-icon"><UsersIcon /></span>
              <span className="list-main">
                <b>{c.name}</b>
                <span className="muted small">{c.members} member{c.members > 1 ? 's' : ''}{c.role === 'admin' ? ' · You are admin' : ''}</span>
              </span>
              <ChevronIcon />
            </button>
          ))}
        </div>
      )}
      <CreateJoinForms />
    </div>
  );
}

export function JoinCircle() {
  const { code } = useParams();
  const { showToast, loadCircles, setCircleId } = useApp();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => get(`/circles/preview/${encodeURIComponent(code)}`), [code]);
  const [busy, run] = useAction(showToast);
  if (loading) return <Spinner />;
  if (error) return <div className="page"><div className="card center stack"><h3>Invite not valid</h3><p className="muted">{error.message}</p><Link to="/circles" className="btn">Go to my circles</Link></div></div>;
  const c = data.circle;
  const join = async () => {
    const r = await run(() => post('/circles/join', { code }), `Welcome to ${c.name}!`);
    if (r) { await loadCircles(); setCircleId(r.circle.id); nav('/'); }
  };
  return (
    <div className="page narrow">
      <div className="card center stack join-card">
        <div className="empty-icon"><UsersIcon size={30} /></div>
        <p className="muted">You are invited to join</p>
        <h1>{c.name}</h1>
        {c.description && <p>{c.description}</p>}
        <p className="muted small">{c.members} member{c.members > 1 ? 's' : ''}</p>
        {data.member ? (
          <button className="btn btn-primary" onClick={() => { setCircleId(c.id); nav('/'); }}>You are already in. Open it</button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={join} disabled={busy}>Join circle</button>
        )}
      </div>
    </div>
  );
}
