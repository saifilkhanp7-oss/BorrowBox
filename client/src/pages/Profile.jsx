import { useParams } from 'react-router-dom';
import { get, patch, timeAgo } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { Avatar, ItemCard, Spinner, ErrorBox, BADGE_INFO, useLoad, useAction } from '../components/ui.jsx';

export default function Profile() {
  const { id } = useParams();
  const { showToast } = useApp();
  const { data, error, loading, reload } = useLoad(() => get(`/users/${id}`), [id]);
  const [busy, run] = useAction(showToast);
  if (loading && !data) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { user, items, skills, notes, own } = data;
  const hide = async (n) => { const r = await run(() => patch(`/notes/${n.id}`, { hidden: !n.hidden })); if (r) reload(true); };

  return (
    <div className="page">
      <section className="card profile-head">
        <Avatar name={user.name} size={72} />
        <div>
          <h1>{user.name}</h1>
          {user.room_no && <p className="muted">Room / flat {user.room_no}</p>}
        </div>
      </section>

      <section className="card">
        <h3>Badges</h3>
        {user.badges.length ? (
          <div className="badges">
            {user.badges.map((b) => (
              <div key={b} className="badge"><span className="badge-emoji">{BADGE_INFO[b].emoji}</span><b>{BADGE_INFO[b].name}</b><span className="muted small">{BADGE_INFO[b].desc}</span></div>
            ))}
          </div>
        ) : <p className="muted small">{own ? 'No badges yet. Return things on time, lend, help and give away to earn them.' : 'No badges yet.'}</p>}
        {own && (
          <details className="mt">
            <summary className="small">How to earn badges</summary>
            <ul className="plain-list small">
              <li>⏰ <b>On-Time Returner</b> – 3+ returns and your last 5 all on time. Returning late twice in your last 5 loses it (you can earn it back).</li>
              <li>🤝 <b>Generous Lender</b> – lend your things 5 times.</li>
              <li>🌱 <b>Helpful Neighbour</b> – help 3 times with “I have this” or favours.</li>
              <li>🎓 <b>Semester Saver</b> – give away 3 things.</li>
              <li>💼 <b>Businessperson</b> – sell 3 things in auctions within 6 months. It goes away if you stop selling for 6 months.</li>
            </ul>
            <p className="muted small">No fines and no money – ever.</p>
          </details>
        )}
      </section>

      <section className="card">
        <h3>Thank-you notes 💌</h3>
        {notes.length ? (
          <div className="notes">
            {notes.map((n) => (
              <div key={n.id} className={`note ${n.hidden ? 'hidden-note' : ''}`}>
                <p>“{n.message}”</p>
                <span className="muted small">– {n.from?.name} · {timeAgo(n.created_at)}</span>
                {own && <button className="link-btn small" disabled={busy} onClick={() => hide(n)}>{n.hidden ? 'Show on profile' : 'Hide'}</button>}
              </div>
            ))}
          </div>
        ) : <p className="muted small">No notes yet.</p>}
      </section>

      {skills.length > 0 && (
        <section className="card">
          <h3>Can help with</h3>
          <ul className="plain-list">{skills.map((s) => <li key={s.id}>✨ <b>{s.title}</b>{s.description ? ` – ${s.description}` : ''}</li>)}</ul>
        </section>
      )}

      <section>
        <h2 className="section-title">{own ? 'Your items' : `${user.name.split(' ')[0]}'s items`}</h2>
        {items.length ? <div className="grid-items">{items.map((i) => <ItemCard key={i.id} item={i} />)}</div> : <p className="muted">Nothing shared yet.</p>}
      </section>
    </div>
  );
}
