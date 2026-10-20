import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, patch, del, fmtRange, fmtDate, daysBetween, dueText } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { ItemStatus, UserChip, Spinner, ErrorBox, CategoryArt, VideoNote, useLoad, useAction } from '../components/ui.jsx';
import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx';
import { BackIcon, EditIcon, QrIcon, PauseIcon, TrashIcon, ClockIcon, CheckIcon } from '../components/Icons.jsx';

export default function ItemDetail() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const itemQ = useLoad(() => get(`/items/${id}`), [id]);
  const calQ = useLoad(() => get(`/items/${id}/calendar`), [id]);
  const [range, setRange] = useState({ start: null, end: null });
  const [message, setMessage] = useState('');
  const [busy, run] = useAction(showToast);

  if (itemQ.loading && !itemQ.data) return <Spinner />;
  if (itemQ.error) return <div className="page"><ErrorBox error={itemQ.error} /></div>;
  const it = itemQ.data.item;
  if (it.listing_type === 'giveaway' && it.giveaway_id) { nav(`/giveaways/${it.giveaway_id}`, { replace: true }); return null; }

  const request = async () => {
    const r = await run(() => post(`/items/${id}/borrows`, { start_date: range.start, end_date: range.end, message }), 'Request sent! The owner will answer soon.');
    if (r) nav(`/borrows/${r.borrow.id}`);
  };
  const waitlist = async (join) => {
    const r = await run(() => (join ? post(`/items/${id}/waitlist`) : del(`/items/${id}/waitlist`)), join ? 'You will be told when it is back' : 'Left the waitlist');
    if (r) itemQ.setData({ item: r.item });
  };
  const pause = async (status) => {
    const r = await run(() => patch(`/items/${id}`, { status }), status === 'paused' ? 'Item hidden for now' : 'Item is shared again');
    if (r) itemQ.setData({ item: r.item });
  };
  const remove = async () => {
    if (!confirm(`Remove "${it.name}" from the circle? This can't be undone.`)) return;
    const r = await run(() => del(`/items/${id}`), 'Item removed');
    if (r) nav(`/c/${it.circle_id}/items`, { replace: true });
  };

  const days = range.start && range.end ? daysBetween(range.start, range.end) + 1 : 0;
  const canReq = it.can_request;
  const blockedOut = it.status === 'borrowed' || (calQ.data && calQ.data.booked.length > 0);

  return (
    <div className="page item-page">
      <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>
      <div className="item-layout">
        <div className="item-media">
          <div className="item-hero"><CategoryArt category={it.category} size="lg" /><span className="muted small">{it.category}</span></div>
          <div className="desktop-only"><VideoNote who={it.is_lender ? 'owner' : 'borrower'} /></div>
        </div>

        <div className="stack">
          <div className="card stack">
            <div className="row-between wrap gap-s">
              <ItemStatus item={it} />
              {it.trusted_only && <span className="pill pill-sun">⏰ Only for On-Time Returners</span>}
            </div>
            <h1>{it.name}</h1>
            <p className="muted">{it.category} · Condition: <b>{it.condition}</b> · Up to {it.max_days} day{it.max_days > 1 ? 's' : ''}</p>
            {it.condition_notes && <div className="cond-notes">🩹 <b>Already noted:</b> {it.condition_notes}</div>}
            {it.description && <p>{it.description}</p>}
            {it.rules && <div className="rules">📌 {it.rules}</div>}
            {it.status === 'borrowed' && !it.active_borrow && it.due_back && (
              <p className="notice"><ClockIcon size={16} /> Unavailable at this moment. Should be back around {fmtDate(it.due_back)}.</p>
            )}
            <div className="owner-line">
              {it.is_shared ? <span className="user-chip"><span className="avatar" style={{ '--hue': 160 }}>🏠</span><span className="user-chip-text"><span className="user-chip-name">{it.shared_by}</span><span className="muted small">Shared circle item · managed by admin</span></span></span>
                : <UserChip user={it.owner} sub="Owner" />}
            </div>
          </div>

          {/* lender tools */}
          {it.is_lender && (
            <div className="card stack">
              <h3>{it.is_shared ? 'Manage shared item' : 'Your item'}</h3>
              {it.needs_review && (
                <div className="notice notice-action">
                  <span>It came back. Check it, update the condition and share it again.</span>
                  <Link to={`/items/${id}/reshare`} className="btn btn-primary btn-sm">Update & share again</Link>
                </div>
              )}
              {it.active_borrow && (
                <Link to={`/borrows/${it.active_borrow.id}`} className="notice">
                  <span><b>{it.active_borrow.borrower.name}</b> has it · {dueText(it.active_borrow.end_date)}</span>
                </Link>
              )}
              <div className="row wrap gap-s">
                <Link to={`/items/${id}/edit`} className="btn btn-sm"><EditIcon size={16} /> Edit</Link>
                <Link to={`/items/${id}/qr`} className="btn btn-sm"><QrIcon size={16} /> Print QR</Link>
                {it.status === 'available' && <button className="btn btn-sm" onClick={() => pause('paused')} disabled={busy}><PauseIcon size={16} /> Pause sharing</button>}
                {it.status === 'paused' && !it.needs_review && <button className="btn btn-sm" onClick={() => pause('available')} disabled={busy}><CheckIcon size={16} /> Share again</button>}
                {it.status !== 'borrowed' && <button className="btn btn-sm btn-danger-ghost" onClick={remove} disabled={busy}><TrashIcon size={16} /> Remove</button>}
              </div>
              {it.waitlist_count > 0 && <p className="muted small">{it.waitlist_count} person{it.waitlist_count > 1 ? 's are' : ' is'} waiting for this item.</p>}
            </div>
          )}
          {!it.is_lender && it.is_admin && it.status !== 'borrowed' && (
            <button className="btn btn-sm btn-danger-ghost self-start" onClick={remove} disabled={busy}><TrashIcon size={16} /> Remove (admin)</button>
          )}

          {/* borrower side */}
          {!it.is_lender && it.my_borrow && (
            <Link to={`/borrows/${it.my_borrow.id}`} className="card notice-card">
              <b>You have a {it.my_borrow.status === 'active' ? 'borrow going on' : 'request'} for this item</b>
              <span className="muted">{fmtRange(it.my_borrow.start_date, it.my_borrow.end_date)} · open it →</span>
            </Link>
          )}

          <div className="card stack">
            <h3>Availability</h3>
            {calQ.data ? (
              <AvailabilityCalendar cal={calQ.data} select={canReq.ok && !it.my_borrow} value={range} onSelect={setRange} maxDays={it.max_days} />
            ) : <Spinner />}

            {!it.is_lender && !it.my_borrow && (canReq.ok ? (
              <div className="stack">
                <p className="muted small">{range.start ? (range.end ? `${fmtRange(range.start, range.end)} · ${days} day${days > 1 ? 's' : ''}` : 'Now tap the last day') : 'Tap the first day, then the last day you need it.'}</p>
                <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message to the owner (optional), e.g. need it for tomorrow's exam" maxLength={300} />
                <button className="btn btn-primary btn-block" disabled={busy || !range.start || !range.end} onClick={request}>Request to borrow</button>
              </div>
            ) : (
              <p className="notice">{canReq.trusted ? '⏰ The owner lends this only to people with the On-Time Returner badge. Return 3 things on time to earn it.' : canReq.reason}</p>
            ))}

            {!it.is_lender && it.listing_type === 'lend' && blockedOut && (
              it.on_waitlist ? (
                <div className="row-between wrap gap-s">
                  <span className="muted small">You are #{it.waitlist_position} on the waitlist. We'll tell you when it's free.</span>
                  <button className="btn btn-sm" onClick={() => waitlist(false)} disabled={busy}>Leave waitlist</button>
                </div>
              ) : (
                <button className="btn btn-block" onClick={() => waitlist(true)} disabled={busy}><ClockIcon size={16} /> Join waitlist – tell me when it's back</button>
              )
            )}
          </div>

          <div className="mobile-only"><VideoNote who={it.is_lender ? 'owner' : 'borrower'} /></div>
        </div>
      </div>
    </div>
  );
}
