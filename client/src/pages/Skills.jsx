import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Skeleton, ErrorBox, Empty, Modal, Field, UserChip, Spinner, useLoad, useAction } from '../components/ui.jsx';
import Chat from '../components/Chat.jsx';
import { PlusIcon, SparkIcon, BackIcon, HeartIcon } from '../components/Icons.jsx';

const REQ_STATUS = { pending: 'Waiting for answer', accepted: 'Accepted', declined: 'Declined', done: 'Done', cancelled: 'Cancelled' };

export default function Skills() {
  const { circle, showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => get(`/circles/${circle.id}/skills`), [circle.id]);
  const [newOpen, setNewOpen] = useState(false);
  const [askFor, setAskFor] = useState(null);
  const [busy, run] = useAction(showToast);

  const toggle = async (s) => { const r = await run(() => patch(`/skills/${s.id}`, { status: s.status === 'active' ? 'paused' : 'active' })); if (r) reload(true); };
  const remove = async (s) => { if (!confirm('Remove this post?')) return; const r = await run(() => del(`/skills/${s.id}`), 'Removed'); if (r) reload(true); };

  return (
    <div className="page">
      <PageHead title="Skills & favours" sub="Not just things – people can share help too."
        action={<button className="btn btn-primary" onClick={() => setNewOpen(true)}><PlusIcon size={18} /> Offer help</button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={3} />}
      {data && (data.skills.length ? (
        <div className="grid-2">
          {data.skills.map((s) => (
            <article key={s.id} className="card stack-s skill">
              <div className="row-between gap-s">
                <h3>{s.title}</h3>
                {s.status === 'paused' && <span className="pill pill-muted">Paused</span>}
              </div>
              {s.description && <p>{s.description}</p>}
              {s.availability_note && <p className="muted small">🕒 {s.availability_note}</p>}
              <div className="row-between wrap gap-s">
                <UserChip user={s.user} size={28} />
                {s.done_count > 0 && <span className="muted small">Helped {s.done_count} time{s.done_count > 1 ? 's' : ''}</span>}
              </div>
              {s.mine ? (
                <>
                  {s.requests.length > 0 && (
                    <div className="list">
                      {s.requests.map((r) => (
                        <Link key={r.id} to={`/favours/${r.id}`} className="list-row small"><span className="list-main">{r.requester.name} · {REQ_STATUS[r.status]}</span></Link>
                      ))}
                    </div>
                  )}
                  <div className="row gap-s">
                    <button className="btn btn-sm" disabled={busy} onClick={() => toggle(s)}>{s.status === 'active' ? 'Pause' : 'Resume'}</button>
                    <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => remove(s)}>Remove</button>
                  </div>
                </>
              ) : (() => {
                const open = s.requests.find((r) => ['pending', 'accepted'].includes(r.status));
                return open ? <Link to={`/favours/${open.id}`} className="btn btn-sm self-start">Open your request ({REQ_STATUS[open.status]})</Link>
                  : <button className="btn btn-primary btn-sm self-start" onClick={() => setAskFor(s)}>Ask for this</button>;
              })()}
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={<SparkIcon size={30} />} title="No one has offered help yet" action={<button className="btn btn-primary" onClick={() => setNewOpen(true)}>Offer something</button>}>
          “I can teach basic guitar”, “I can fix laptops”, “I can help you move”…
        </Empty>
      ))}
      <NewSkill open={newOpen} onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); reload(true); }} />
      <AskModal skill={askFor} onClose={() => setAskFor(null)} onDone={(rid) => nav(`/favours/${rid}`)} />
    </div>
  );
}

function NewSkill({ open, onClose, onDone }) {
  const { circle, showToast } = useApp();
  const [f, setF] = useState({ title: '', description: '', availability_note: '' });
  const [busy, run] = useAction(showToast);
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => post(`/circles/${circle.id}/skills`, f), 'Posted – thanks for helping!');
    if (r) { setF({ title: '', description: '', availability_note: '' }); onDone(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Offer a skill or favour">
      <form className="stack" onSubmit={submit}>
        <Field label="What can you help with?"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. I can teach basic guitar" required maxLength={80} /></Field>
        <Field label="Details (optional)"><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={400} /></Field>
        <Field label="When are you usually free? (optional)"><input value={f.availability_note} onChange={(e) => setF({ ...f, availability_note: e.target.value })} placeholder="e.g. weekday evenings" maxLength={120} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>Post</button>
      </form>
    </Modal>
  );
}

function AskModal({ skill, onClose, onDone }) {
  const { showToast } = useApp();
  const [message, setMessage] = useState('');
  const [busy, run] = useAction(showToast);
  if (!skill) return null;
  const send = async () => {
    const r = await run(() => post(`/skills/${skill.id}/requests`, { message }), 'Request sent');
    if (r) onDone(r.requestId);
  };
  return (
    <Modal open onClose={onClose} title={skill.title}>
      <div className="stack">
        <Field label={`Message to ${skill.user.name}`}><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Can you show me the basic chords this weekend?" maxLength={300} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={send}>Ask</button>
      </div>
    </Modal>
  );
}

export function Favour() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, setData } = useLoad(() => get(`/skill-requests/${id}`), [id]);
  const [busy, run] = useAction(showToast);
  const [thanks, setThanks] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const r = data.request;
  const act = async (a, body, msg) => { const res = await run(() => post(`/skill-requests/${id}/${a}`, body), msg); if (res) setData({ request: res.request }); };
  return (
    <div className="page">
      <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>
      <div className="borrow-layout">
        <div className="stack">
          <section className="card stack">
            <span className="pill pill-muted self-start">{REQ_STATUS[r.status]}</span>
            <h2>{r.skill.title}</h2>
            {r.skill.description && <p>{r.skill.description}</p>}
            <div className="row-between wrap gap-s"><UserChip user={r.helper} sub="Helping" /><UserChip user={r.requester} sub="Asked" /></div>
            {r.role === 'helper' && r.status === 'pending' && (
              <div className="row gap-s"><button className="btn btn-primary" disabled={busy} onClick={() => act('accept', {}, 'Accepted')}>Yes, I can help</button><button className="btn" disabled={busy} onClick={() => act('decline', {}, 'Declined')}>Not this time</button></div>
            )}
            {r.status === 'accepted' && <button className="btn btn-primary self-start" disabled={busy} onClick={() => act('done', {}, 'Marked as done 🎉')}>Mark as done</button>}
            {r.role === 'requester' && ['pending', 'accepted'].includes(r.status) && <button className="link-btn self-start" disabled={busy} onClick={() => act('cancel', {}, 'Cancelled')}>Cancel request</button>}
            {r.role === 'requester' && r.status === 'done' && (r.thanked ? <p className="muted small"><HeartIcon size={14} /> You left a thank-you note.</p> : (
              <form className="thanks" onSubmit={(e) => { e.preventDefault(); act('thanks', { message: thanks }, 'Thank-you note sent 💌'); }}>
                <label className="field"><span className="field-label">💌 Thank {r.helper.name}</span><input value={thanks} onChange={(e) => setThanks(e.target.value)} maxLength={200} placeholder="Thanks for the help!" /></label>
                <button className="btn btn-sm" disabled={busy || thanks.trim().length < 2}>Send</button>
              </form>
            ))}
          </section>
        </div>
        <Chat base={`/skill-requests/${id}`} open={r.chat_open} />
      </div>
    </div>
  );
}
