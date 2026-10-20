import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, patch, del, timeAgo } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Field, UserChip, ItemCard, Skeleton, useLoad, useAction } from '../components/ui.jsx';
import { PlusIcon } from '../components/Icons.jsx';
import { InviteBox } from './Circles.jsx';

export default function Admin() {
  const { circle, showToast, loadCircles, user } = useApp();
  const isAdmin = circle.role === 'admin';
  const members = useLoad(() => get(`/circles/${circle.id}/members`), [circle.id]);
  const shared = useLoad(() => get(`/circles/${circle.id}/items?shared=1`), [circle.id]);
  const reports = useLoad(() => (isAdmin ? get(`/circles/${circle.id}/reports`) : Promise.resolve({ reports: [] })), [circle.id, isAdmin]);
  const [busy, run] = useAction(showToast);
  const [name, setName] = useState(circle.name);
  const [description, setDescription] = useState(circle.description || '');
  useEffect(() => { setName(circle.name); setDescription(circle.description || ''); }, [circle]);

  if (!isAdmin) return <div className="page"><div className="card center"><h3>Only the circle admin can open this page.</h3></div></div>;

  const save = async (e) => { e.preventDefault(); const r = await run(() => patch(`/circles/${circle.id}`, { name, description }), 'Saved'); if (r) loadCircles(); };
  const regen = async () => { if (!confirm('Make a new invite code? The old code and link will stop working.')) return; const r = await run(() => post(`/circles/${circle.id}/regenerate-code`), 'New code made'); if (r) loadCircles(); };
  const removeMember = async (m) => { if (!confirm(`Remove ${m.name} from ${circle.name}? Their listings will be hidden.`)) return; const r = await run(() => del(`/circles/${circle.id}/members/${m.id}`), 'Member removed'); if (r) { members.reload(true); loadCircles(); } };
  const makeAdmin = async (m) => { if (!confirm(`Make ${m.name} the admin? You will become a normal member.`)) return; const r = await run(() => post(`/circles/${circle.id}/transfer-admin`, { userId: m.id }), `${m.name} is now the admin`); if (r) { await loadCircles(); members.reload(true); } };

  return (
    <div className="page">
      <PageHead title="Circle admin" sub={circle.name} />

      <section className="card stack">
        <h3>Invite people</h3>
        <InviteBox circle={circle} />
        <button className="link-btn self-start small" disabled={busy} onClick={regen}>Make a new invite code</button>
      </section>

      <section className="card">
        <h3>Members ({members.data?.members.length ?? '…'})</h3>
        {members.loading && !members.data ? <Skeleton rows={2} /> : (
          <div className="list">
            {members.data?.members.map((m) => (
              <div key={m.id} className="list-row static">
                <span className="list-main"><UserChip user={m} sub={m.role === 'admin' ? 'Admin' : `Joined ${timeAgo(m.joined_at)}`} /></span>
                {m.id !== user.id && (
                  <span className="row gap-s">
                    <button className="btn btn-sm" disabled={busy} onClick={() => makeAdmin(m)}>Make admin</button>
                    <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => removeMember(m)}>Remove</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <div className="row-between wrap gap-s">
          <div><h3>Shared circle items</h3><p className="muted small">Things that belong to the whole group, like the hostel cricket kit or club projector. You approve requests for these.</p></div>
          <Link to={`/c/${circle.id}/items/new?shared=1`} className="btn btn-primary btn-sm"><PlusIcon size={16} /> Add shared item</Link>
        </div>
        {shared.data?.items.length ? <div className="grid-items">{shared.data.items.map((i) => <ItemCard key={i.id} item={i} />)}</div> : <p className="muted small">No shared items yet.</p>}
      </section>

      <section className="card">
        <h3>Problem reports</h3>
        {reports.data?.reports.length ? (
          <div className="list">
            {reports.data.reports.map((r) => (
              <Link key={r.id} to={`/reports/${r.id}`} className="list-row">
                <span className="list-main"><b>{r.item_name}</b> · {r.type_label}<span className="muted small">{r.reported_by_user?.name} · {timeAgo(r.created_at)}</span></span>
                <span className={`pill ${r.status === 'resolved' ? 'pill-ok' : 'pill-danger'}`}>{r.status}</span>
              </Link>
            ))}
          </div>
        ) : <p className="muted small">No problems reported. 🎉</p>}
        <p className="muted small mt">To remove any item, open it and tap “Remove (admin)”.</p>
      </section>

      <form className="card stack" onSubmit={save}>
        <h3>Circle details</h3>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></Field>
        <button className="btn self-start" disabled={busy}>Save</button>
      </form>
    </div>
  );
}
