import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, patch, fmtDate, timeAgo, todayStr } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Skeleton, ErrorBox, Empty, Modal, Field, UserChip, useLoad, useAction } from '../components/ui.jsx';
import { PlusIcon, MegaphoneIcon, HandIcon } from '../components/Icons.jsx';

export default function Wanted() {
  const { circle, showToast } = useApp();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('open');
  const { data, error, loading, reload } = useLoad(() => get(`/circles/${circle.id}/wanted?status=${tab}`), [circle.id, tab]);
  const [newOpen, setNewOpen] = useState(sp.get('new') === '1');
  const [offerFor, setOfferFor] = useState(null);
  const [busy, run] = useAction(showToast);

  // came back from "add it now" → open the offer with the new item picked
  useEffect(() => {
    const w = Number(sp.get('offer'));
    if (w && data) {
      const post_ = data.wanted.find((x) => x.id === w);
      if (post_) setOfferFor({ wanted: post_, itemId: Number(sp.get('item')) || null });
    }
  }, [sp, data]);

  const closeOffer = () => { setOfferFor(null); if (sp.get('offer')) setSp({}, { replace: true }); };
  const setStatus = async (w, status) => {
    const r = await run(() => patch(`/wanted/${w.id}`, { status }), status === 'found' ? 'Great, marked as found!' : 'Closed');
    if (r) reload(true);
  };

  return (
    <div className="page">
      <PageHead title="Wanted board" sub="Can't find something? Ask the circle."
        action={<button className="btn btn-primary" onClick={() => setNewOpen(true)}><PlusIcon size={18} /> Ask</button>} />
      <div className="tabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Open</button>
        <button className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>Found / closed</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={3} />}
      {data && (data.wanted.length ? (
        <div className="stack">
          {data.wanted.map((w) => (
            <article key={w.id} className={`card wanted ${w.urgent ? 'urgent' : ''}`}>
              <div className="row-between wrap gap-s">
                <div className="row gap-s wrap">
                  {w.urgent && <span className="pill pill-danger">🚨 Urgent</span>}
                  {w.needed_by && <span className="pill pill-muted">Needed by {fmtDate(w.needed_by)}</span>}
                  {w.status !== 'open' && <span className="pill pill-ok">{w.status === 'found' ? 'Found' : 'Closed'}</span>}
                </div>
                <span className="muted small">{timeAgo(w.created_at)}</span>
              </div>
              <h3>{w.title}</h3>
              {w.details && <p>{w.details}</p>}
              <UserChip user={w.user} size={28} />
              {w.offers.length > 0 && (
                <div className="offers">
                  {w.offers.map((o) => (
                    <div key={o.id} className="offer">
                      🙋 <b>{o.offered_by.name}</b> has <b>{o.item_name}</b>
                      {(w.mine || o.offered_by.id) && <Link to={`/borrows/${o.borrow_id}`} className="small"> · open</Link>}
                    </div>
                  ))}
                </div>
              )}
              {w.status === 'open' && (
                <div className="row wrap gap-s">
                  {w.mine ? (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setStatus(w, 'found')}>I found it</button>
                      <button className="btn btn-sm" disabled={busy} onClick={() => setStatus(w, 'closed')}>Close</button>
                    </>
                  ) : (
                    <button className="btn btn-primary" onClick={() => setOfferFor({ wanted: w })}><HandIcon size={18} /> I have this</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={<MegaphoneIcon size={30} />} title={tab === 'open' ? 'Nobody is looking for anything right now' : 'Nothing here yet'}
          action={tab === 'open' && <button className="btn btn-primary" onClick={() => setNewOpen(true)}>Ask for something</button>}>
          Need a scientific calculator for tomorrow? Post it here and mark it urgent.
        </Empty>
      ))}

      <NewWanted open={newOpen} onClose={() => { setNewOpen(false); if (sp.get('new')) setSp({}, { replace: true }); }} onDone={() => { setNewOpen(false); setTab('open'); reload(true); }} />
      {offerFor && <OfferModal wanted={offerFor.wanted} preselect={offerFor.itemId} onClose={closeOffer}
        onDone={(borrowId) => { closeOffer(); nav(`/borrows/${borrowId}`); }} />}
    </div>
  );
}

function NewWanted({ open, onClose, onDone }) {
  const { circle, showToast } = useApp();
  const [f, setF] = useState({ title: '', details: '', needed_by: '', urgent: false });
  const [busy, run] = useAction(showToast);
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => post(`/circles/${circle.id}/wanted`, f), f.urgent ? 'Posted! Everyone in the circle was told.' : 'Posted');
    if (r) { setF({ title: '', details: '', needed_by: '', urgent: false }); onDone(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ask the circle">
      <form className="stack" onSubmit={submit}>
        <Field label="What do you need?"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Scientific calculator" required maxLength={80} /></Field>
        <Field label="Details (optional)"><textarea rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="e.g. for tomorrow's exam, will return same evening" maxLength={400} /></Field>
        <Field label="Needed by (optional)"><input type="date" min={todayStr()} value={f.needed_by} onChange={(e) => setF({ ...f, needed_by: e.target.value })} /></Field>
        <label className="toggle-card">
          <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />
          <span><b>🚨 Urgent</b><span className="muted small">Everyone in the circle gets notified. Max 2 urgent posts a day.</span></span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>Post</button>
      </form>
    </Modal>
  );
}

function OfferModal({ wanted, preselect, onClose, onDone }) {
  const { circle, showToast } = useApp();
  const mine = useLoad(() => get(`/circles/${circle.id}/items?mine=1&available=1`), [circle.id]);
  const [itemId, setItemId] = useState(preselect || null);
  const [days, setDays] = useState(2);
  const [busy, run] = useAction(showToast);
  const items = mine.data?.items || [];
  const sel = items.find((i) => i.id === itemId);
  const send = async () => {
    const r = await run(() => post(`/wanted/${wanted.id}/offer`, { item_id: itemId, days }), `${wanted.user.name} was told you have it 🙌`);
    if (r) onDone(r.borrowId);
  };
  return (
    <Modal open onClose={onClose} title={`I have this: ${wanted.title}`}>
      <div className="stack">
        <p className="muted small">Pick your item. It becomes a borrow that you already approved, starting today.</p>
        {mine.loading ? <Skeleton rows={2} /> : items.length ? (
          <div className="pick-list">
            {items.map((i) => (
              <button key={i.id} type="button" className={`pick ${itemId === i.id ? 'on' : ''}`} onClick={() => { setItemId(i.id); setDays(Math.min(days, i.max_days)); }}>
                <b>{i.name}</b><span className="muted small">{i.category} · up to {i.max_days} days</span>
              </button>
            ))}
          </div>
        ) : <p className="notice">You have no available items in this circle yet.</p>}
        <Link to={`/c/${circle.id}/items/new?wanted=${wanted.id}`} className="btn btn-block">+ Add the item now</Link>
        {sel && (
          <Field label={`How many days can they keep it? (max ${sel.max_days})`}>
            <input type="number" min={1} max={sel.max_days} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </Field>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !itemId} onClick={send}>Offer it</button>
      </div>
    </Modal>
  );
}
