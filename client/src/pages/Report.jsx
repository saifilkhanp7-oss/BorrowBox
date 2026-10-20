import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, fmtDateTime, fmtRange } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { Spinner, ErrorBox, UserChip, Field, useLoad, useAction } from '../components/ui.jsx';
import Chat from '../components/Chat.jsx';
import { BackIcon, CheckIcon } from '../components/Icons.jsx';

const FIXES = [
  { key: 'repair', label: 'Repair', emoji: '🔧', desc: 'Get it fixed' },
  { key: 'replace', label: 'Replace', emoji: '🔁', desc: 'Get a new one' },
  { key: 'forget', label: 'Forget it', emoji: '🤝', desc: 'No problem, let it go' },
];

export default function Report() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, setData } = useLoad(() => get(`/reports/${id}`), [id]);
  const [busy, run] = useAction(showToast);
  const [fix, setFix] = useState('');
  const [note, setNote] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const r = data.report;
  const act = async (path, body, msg) => { const res = await run(() => post(path, body), msg); if (res?.report) setData({ report: res.report }); return res; };

  return (
    <div className="page">
      <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>
      <section className="card stack">
        <div className="row gap-s wrap">
          <span className="pill pill-danger">{r.type_label}</span>
          <span className={`pill ${r.status === 'resolved' ? 'pill-ok' : r.status === 'agreed' ? 'pill-sun' : 'pill-muted'}`}>
            {r.status === 'resolved' ? 'Resolved ✅' : r.status === 'agreed' ? `Agreed: ${r.agreed_fix_label}` : 'Open'}
          </span>
        </div>
        <h2>Problem with <Link to={`/borrows/${r.borrow.id}`}>{r.item.name}</Link></h2>
        <p className="muted">Borrowed {fmtRange(r.borrow.start_date, r.borrow.end_date)} · reported by {r.reported_by_user.name} · {fmtDateTime(r.created_at)}</p>
        {r.description && <blockquote>“{r.description}”</blockquote>}
        <div className="row-between wrap gap-s"><UserChip user={r.borrower} sub="Borrower" /><UserChip user={r.lender} sub="Owner" /></div>
      </section>

      <section className="card stack">
        <h3>What both of you recorded</h3>
        <p className="muted small">The same record for both of you, with dates. The owner should also share the video taken before the handover (send it on WhatsApp or show it in person).</p>
        <dl className="cond-list">
          <div><dt>Condition when shared</dt><dd>{r.item.condition}{r.item.condition_notes ? ` – ${r.item.condition_notes}` : ''}</dd></div>
          <div><dt>At handover{r.borrow.handover_at ? ` · ${fmtDateTime(r.borrow.handover_at)}` : ''}</dt>
            <dd>{r.borrow.handover_condition || '—'}{r.borrow.handover_note ? ` · Note: ${r.borrow.handover_note}` : ''}
              <span className="cond-ticks">{r.borrow.handover_video ? '📹 Owner took a video' : '📹 No video confirmed'}{r.borrow.handover_checked ? ' · 🔍 Borrower checked the item' : ''}</span></dd></div>
          <div><dt>At return{r.borrow.returned_at ? ` · ${fmtDateTime(r.borrow.returned_at)}` : ''}</dt>
            <dd>{r.borrow.return_condition ? (r.borrow.return_condition === 'damaged' ? 'Came back damaged' : 'Came back fine') : 'Not returned yet'}{r.borrow.return_note ? ` · Note: ${r.borrow.return_note}` : ''}</dd></div>
        </dl>
      </section>

      <div className="borrow-layout">
        <section className="card stack">
          <h3>Agree on a fix</h3>
          {r.fixes.length === 0 && <p className="muted small">No suggestion yet. Talk in the chat, then suggest a fix.</p>}
          {r.fixes.map((f) => (
            <div key={f.id} className={`fix fix-${f.status}`}>
              <div><b>{f.proposed_by_user.name}</b> suggested <b>{f.fix_label}</b>{f.note ? ` – “${f.note}”` : ''}</div>
              <span className="muted small">{f.status === 'pending' ? 'Waiting for answer' : f.status}</span>
              {f.can_answer && (
                <div className="row gap-s">
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act(`/report-fixes/${f.id}/accept`, {}, 'Agreed')}><CheckIcon size={16} /> Agree</button>
                  <button className="btn btn-sm" disabled={busy} onClick={() => act(`/report-fixes/${f.id}/reject`, {}, 'Not agreed')}>Don't agree</button>
                </div>
              )}
            </div>
          ))}
          {r.can_propose && (
            <form className="stack" onSubmit={async (e) => { e.preventDefault(); const res = await act(`/reports/${id}/fixes`, { fix, note }, 'Suggestion sent'); if (res) { setFix(''); setNote(''); } }}>
              <div className="choice-row three">
                {FIXES.map((x) => <button type="button" key={x.key} className={`choice ${fix === x.key ? 'on ok' : ''}`} onClick={() => setFix(x.key)}>{x.emoji}<b>{x.label}</b><span className="muted small">{x.desc}</span></button>)}
              </div>
              <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I'll get it repaired at the shop by Friday" maxLength={300} /></Field>
              <button className="btn btn-primary" disabled={busy || !fix}>Suggest this fix</button>
            </form>
          )}
          {r.status === 'agreed' && <p className="notice">Both agreed on <b>{r.agreed_fix_label}</b>{r.agreed_note ? ` – ${r.agreed_note}` : ''}. {r.role === 'lender' ? 'When it is done, mark it resolved.' : 'The owner will mark it resolved when it is done.'}</p>}
          {r.can_resolve && <button className="btn btn-primary self-start" disabled={busy} onClick={() => act(`/reports/${id}/resolve`, {}, 'Resolved ✅')}>Mark as resolved</button>}
          {r.status === 'resolved' && <p className="notice">✅ Resolved {fmtDateTime(r.resolved_at)}{r.agreed_fix_label ? ` with: ${r.agreed_fix_label}` : ''}.</p>}
        </section>
        {r.role !== 'admin' ? <Chat base={`/borrows/${r.borrow.id}`} open={r.status !== 'resolved'} title="Talk it through" /> : <div className="card muted small">You are seeing this as the circle admin.</div>}
      </div>
    </div>
  );
}
