import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, fmtRange, fmtDate, fmtDateTime, dueText, addDays } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { UserChip, Spinner, ErrorBox, Modal, Field, CategoryArt, useLoad, useAction } from '../components/ui.jsx';
import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx';
import Chat from '../components/Chat.jsx';
import { BackIcon, CheckIcon, AlertIcon, HeartIcon, QrIcon } from '../components/Icons.jsx';

const STATUS_TEXT = {
  requested: 'Waiting for the owner', countered: 'New dates suggested', approved: 'Approved – meet for handover',
  active: 'With the borrower', returned: 'Returned', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired',
};

function Timeline({ b }) {
  const steps = ['Requested', 'Approved', 'Handed over', 'Returned'];
  const at = { requested: 0, countered: 0, approved: 1, active: 2, returned: 4 }[b.status];
  if (at === undefined) return null;
  return (
    <ol className="timeline">
      {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}><span>{i < at ? <CheckIcon size={12} /> : i + 1}</span>{s}</li>)}
    </ol>
  );
}

export default function Borrow() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, setData } = useLoad(() => get(`/borrows/${id}`), [id]);
  const [busy, run] = useAction(showToast);
  const [modal, setModal] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const b = data.borrow;
  const it = b.item;
  const lender = b.role === 'lender';
  const borrower = b.role === 'borrower';
  const act = async (path, body, msg) => {
    const r = await run(() => post(`/borrows/${id}/${path}`, body), msg);
    if (r?.borrow) setData({ borrow: r.borrow });
    return r;
  };
  const pendingExt = b.extensions.find((e) => e.status === 'pending');
  const openReport = b.reports.find((r) => r.status !== 'resolved');

  return (
    <div className="page">
      <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>

      <div className="borrow-head card">
        <Link to={`/items/${it.id}`} className="borrow-thumb"><CategoryArt category={it.category} /></Link>
        <div className="grow">
          <p className="muted small">{borrower ? 'You are borrowing' : lender ? `${b.borrower.name} is borrowing ${it.is_shared ? 'the circle’s' : 'your'}` : 'Borrow'}</p>
          <h2><Link to={`/items/${it.id}`}>{it.name}</Link></h2>
          <p className="muted">{fmtRange(b.start_date, b.end_date)}
            {b.end_date !== b.original_end_date && <span className="small"> (extended from {fmtDate(b.original_end_date)})</span>}
          </p>
        </div>
        <span className={`pill ${b.overdue ? 'pill-danger' : b.status === 'active' ? 'pill-warn' : ['returned', 'approved'].includes(b.status) ? 'pill-ok' : 'pill-muted'}`}>
          {b.status === 'active' ? dueText(b.end_date, b.today) : STATUS_TEXT[b.status]}
        </span>
      </div>

      <Timeline b={b} />

      <div className="borrow-layout">
        <div className="stack">
          {/* ===== action card ===== */}
          <section className="card stack action-card">
            {b.status === 'requested' && lender && (
              <>
                <h3>{b.borrower.name} wants to borrow it</h3>
                <p>{fmtRange(b.start_date, b.end_date)}</p>
                {b.message && <blockquote>“{b.message}”</blockquote>}
                <div className="row wrap gap-s">
                  <button className="btn btn-primary" disabled={busy} onClick={() => act('approve', {}, 'Approved')}><CheckIcon size={18} /> Approve</button>
                  <button className="btn" disabled={busy} onClick={() => setModal('counter')}>Suggest other dates</button>
                  <button className="btn btn-danger-ghost" disabled={busy} onClick={() => setModal('decline')}>Decline</button>
                </div>
              </>
            )}
            {b.status === 'requested' && borrower && (
              <>
                <h3>Request sent</h3>
                <p className="muted">Waiting for {it.is_shared ? 'the circle admin' : b.lender?.name || 'the owner'} to answer. Requests with no answer expire after 3 days.</p>
                <button className="btn btn-sm self-start" disabled={busy} onClick={() => act('cancel', {}, 'Request cancelled')}>Cancel request</button>
              </>
            )}
            {b.status === 'countered' && (
              <>
                <h3>New dates suggested</h3>
                <p>The owner can lend it on <b>{fmtRange(b.counter_start, b.counter_end)}</b> instead of {fmtRange(b.start_date, b.end_date)}.</p>
                {borrower ? (
                  <div className="row wrap gap-s">
                    <button className="btn btn-primary" disabled={busy} onClick={() => act('accept-counter', {}, 'Dates accepted – approved!')}>Accept these dates</button>
                    <button className="btn" disabled={busy} onClick={() => act('cancel', {}, 'Request cancelled')}>No thanks</button>
                  </div>
                ) : lender ? <p className="muted small">Waiting for {b.borrower.name} to accept.</p> : null}
              </>
            )}
            {b.status === 'approved' && <Handover b={b} busy={busy} act={act} />}
            {b.status === 'active' && (
              <ActiveActions b={b} busy={busy} act={act} run={run} setData={setData} pendingExt={pendingExt} openModal={setModal} />
            )}
            {b.status === 'returned' && (
              <>
                <h3>{b.return_condition === 'fine' ? 'Came back fine 👍' : 'Came back damaged'}</h3>
                <p className="muted">Returned {b.returned_on_time ? 'on time' : 'late'} · {fmtDateTime(b.return_lender_at)}</p>
                {lender && it.needs_review && it.status === 'paused' && (
                  <div className="notice notice-action"><span>Update the condition and share it again when you are ready.</span>
                    <Link className="btn btn-primary btn-sm" to={`/items/${it.id}/reshare`}>Update & share again</Link></div>
                )}
                {borrower && !b.thanked && <ThanksForm onSend={(message) => act('thanks', { message }, 'Thank-you note sent 💌')} busy={busy} name={b.lender?.name} />}
                {borrower && b.thanked && <p className="muted small"><HeartIcon size={14} /> You left a thank-you note.</p>}
              </>
            )}
            {['declined', 'cancelled', 'expired'].includes(b.status) && (
              <>
                <h3>{STATUS_TEXT[b.status]}</h3>
                {b.decline_reason && <p className="muted">{b.decline_reason}</p>}
                {borrower && <Link to={`/items/${it.id}`} className="btn btn-sm self-start">See other dates</Link>}
              </>
            )}

            {['active', 'returned'].includes(b.status) && b.role !== 'admin' && (
              openReport ? (
                <Link to={`/reports/${openReport.id}`} className="notice notice-danger"><AlertIcon size={16} /> A problem is reported. Open it →</Link>
              ) : (
                <button className="link-btn danger self-start" onClick={() => setModal('report')}><AlertIcon size={16} /> Report a problem</button>
              )
            )}
            {b.reports.filter((r) => r.status === 'resolved').map((r) => <Link key={r.id} to={`/reports/${r.id}`} className="muted small">Resolved problem report →</Link>)}
          </section>

          <section className="card">
            <div className="row-between wrap gap-s">
              <UserChip user={b.borrower} sub="Borrower" />
              {it.is_shared ? <span className="muted small">🏠 {b.owner_label}{b.lender ? ` · handled by ${b.lender.name}` : ''}</span> : <UserChip user={b.lender} sub="Owner" />}
            </div>
            {it.rules && <div className="rules mt">📌 {it.rules}</div>}
          </section>

          <section className="card stack">
            <h3>Condition record</h3>
            <p className="muted small">Both of you see the same record, so there is no fight later.</p>
            <dl className="cond-list">
              <div><dt>When shared</dt><dd>{it.condition}{it.condition_notes ? ` – ${it.condition_notes}` : ''}</dd></div>
              {b.handover_lender_at && (
                <div><dt>At handover · {fmtDateTime(b.handover_lender_at)}</dt>
                  <dd>{b.handover_condition || it.condition}{b.handover_note ? ` · Note: ${b.handover_note}` : ''}
                    <span className="cond-ticks">{b.handover_video ? '📹 Owner took a video' : ''}{b.handover_checked ? ' · 🔍 Borrower checked it' : ''}</span></dd></div>
              )}
              {b.return_lender_at && (
                <div><dt>At return · {fmtDateTime(b.return_lender_at)}</dt>
                  <dd>{b.return_condition === 'damaged' ? 'Came back damaged' : 'Came back fine'}{b.return_note ? ` · Note: ${b.return_note}` : ''}</dd></div>
              )}
            </dl>
          </section>

          {b.extensions.length > 0 && (
            <section className="card">
              <h3>Extensions</h3>
              <ul className="plain-list">
                {b.extensions.map((e) => <li key={e.id}>Until {fmtDate(e.requested_end_date)} – <b>{e.status}</b>{e.reason ? ` · ${e.reason}` : ''}</li>)}
              </ul>
            </section>
          )}
        </div>

        <Chat base={`/borrows/${id}`} open={b.chat_open} title="Chat about this borrow" />
      </div>

      <CounterModal open={modal === 'counter'} onClose={() => setModal(null)} b={b} onSend={async (s, e) => { const r = await act('counter', { start_date: s, end_date: e }, 'New dates sent'); if (r) setModal(null); }} busy={busy} />
      <DeclineModal open={modal === 'decline'} onClose={() => setModal(null)} onSend={async (reason) => { const r = await act('decline', { reason }, 'Declined'); if (r) setModal(null); }} busy={busy} />
      <ExtendModal open={modal === 'extend'} onClose={() => setModal(null)} b={b} onSend={async (d, reason) => { const r = await act('extensions', { requested_end_date: d, reason }, 'Asked for more time'); if (r) setModal(null); }} busy={busy} />
      <ReportModal open={modal === 'report'} onClose={() => setModal(null)} b={b} onDone={(rid) => { setModal(null); nav(`/reports/${rid}`); }} />
      <ReturnModal open={modal === 'return'} onClose={() => setModal(null)} b={b} onDone={(r) => { setModal(null); setData({ borrow: r.borrow }); if (r.suggest_report) setModal('report'); }} />
    </div>
  );
}

function Handover({ b, busy, act }) {
  const [video, setVideo] = useState(false);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const lender = b.role === 'lender';
  const borrower = b.role === 'borrower';
  return (
    <>
      <h3>Handover</h3>
      <p className="muted">Meet up on {fmtDate(b.start_date)}. When the item changes hands, <b>both</b> of you confirm here. Tip: scan the item’s QR code to open this screen fast.</p>
      <div className="confirm-row">
        <span className={b.handover_lender_at ? 'ok' : ''}>{b.handover_lender_at ? <CheckIcon size={14} /> : '○'} Owner: video taken</span>
        <span className={b.handover_borrower_at ? 'ok' : ''}>{b.handover_borrower_at ? <CheckIcon size={14} /> : '○'} Borrower: item checked</span>
      </div>
      {lender && !b.handover_lender_at && (
        <div className="stack">
          <div className="video-step">
            <b>📹 Before you give it: take a short video</b>
            <span className="muted small">Use your phone camera. Show all sides and any scratches. Keep the video until the item comes back – if it comes back damaged, you can show it in the chat.</span>
          </div>
          <Field label="Anything to note about its condition right now? (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lid is a bit loose" maxLength={300} />
          </Field>
          <label className="toggle-card">
            <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
            <span><b>I took a video of the item</b><span className="muted small">You can't confirm the handover without this.</span></span>
          </label>
          <button className="btn btn-primary" disabled={busy || !video} onClick={() => act('handover', { video_taken: true, note }, 'Handover confirmed')}>Confirm handover</button>
        </div>
      )}
      {borrower && !b.handover_borrower_at && (
        <div className="stack">
          <div className="video-step">
            <b>🔍 Before you take it: check the item</b>
            <span className="muted small">Look at it carefully in front of the owner{b.item.condition_notes ? ` (already noted: ${b.item.condition_notes})` : ''}. If something is broken or missing, write it in the chat <b>before</b> you take it.</span>
          </div>
          <label className="toggle-card">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span><b>I checked the item and it is as described</b><span className="muted small">You can't confirm without this.</span></span>
          </label>
          <button className="btn btn-primary" disabled={busy || !checked} onClick={() => act('handover', { checked: true }, 'Confirmed')}>I received the item</button>
        </div>
      )}
      {((lender && b.handover_lender_at) || (borrower && b.handover_borrower_at)) && <p className="muted small">Waiting for the other person to confirm.</p>}
      {b.role !== 'admin' && <button className="link-btn self-start" disabled={busy} onClick={() => { if (confirm('Cancel this borrow?')) act('cancel', {}, 'Cancelled'); }}>Cancel borrow</button>}
    </>
  );
}

function ActiveActions({ b, busy, act, run, setData, pendingExt, openModal }) {
  const lender = b.role === 'lender';
  const borrower = b.role === 'borrower';
  const decideExt = async (approve) => {
    const r = await run(() => post(`/extensions/${pendingExt.id}/${approve ? 'approve' : 'reject'}`), approve ? 'Extension approved' : 'Extension rejected');
    if (r) setData({ borrow: r.borrow });
  };
  return (
    <>
      <h3>{b.overdue ? <span className="danger">Overdue – {dueText(b.end_date, b.today)}</span> : dueText(b.end_date, b.today)}</h3>
      <p className="muted">Return by <b>{fmtDate(b.end_date)}</b>. Reminders go out one day before and on the due day.</p>
      {pendingExt && (
        <div className="notice">
          <span>{borrower ? 'You asked' : `${b.borrower.name} asked`} to keep it until <b>{fmtDate(pendingExt.requested_end_date)}</b>{pendingExt.reason ? ` – “${pendingExt.reason}”` : ''}.</span>
          {lender && <div className="row gap-s"><button className="btn btn-sm btn-primary" disabled={busy} onClick={() => decideExt(true)}>Approve</button><button className="btn btn-sm" disabled={busy} onClick={() => decideExt(false)}>Reject</button></div>}
        </div>
      )}
      {borrower && (
        <div className="row wrap gap-s">
          {!b.return_borrower_at ? <button className="btn btn-primary" disabled={busy} onClick={() => act('return', {}, 'Owner notified')}>I returned it</button>
            : <span className="pill pill-ok">You said you returned it – waiting for the owner</span>}
          {!pendingExt && !b.return_borrower_at && <button className="btn" onClick={() => openModal('extend')}>Ask for more time</button>}
        </div>
      )}
      {lender && (
        <div className="stack-s">
          {b.return_borrower_at && <p className="small"><b>{b.borrower.name}</b> says they gave it back. Check it and confirm.</p>}
          <button className="btn btn-primary self-start" onClick={() => openModal('return')}><QrIcon size={16} /> Confirm return</button>
        </div>
      )}
    </>
  );
}

function ThanksForm({ onSend, busy, name }) {
  const [msg, setMsg] = useState('');
  return (
    <form className="thanks" onSubmit={(e) => { e.preventDefault(); onSend(msg); }}>
      <label className="field"><span className="field-label">💌 Leave a thank-you note{name ? ` for ${name}` : ''}</span>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Thanks, it really helped in my exam!" maxLength={200} /></label>
      <button className="btn btn-sm" disabled={busy || msg.trim().length < 2}>Send</button>
    </form>
  );
}

function CounterModal({ open, onClose, b, onSend, busy }) {
  const cal = useLoad(() => (open ? get(`/items/${b.item.id}/calendar`) : Promise.resolve(null)), [open, b.item.id]);
  const [range, setRange] = useState({ start: null, end: null });
  if (!open) return null;
  // don't treat this request's own pending range as a clash
  const data = cal.data && { ...cal.data, pending: cal.data.pending.filter((p) => !(p.start === b.start_date && p.end === b.end_date)) };
  return (
    <Modal open={open} onClose={onClose} title="Suggest other dates">
      {data ? <AvailabilityCalendar cal={data} select value={range} onSelect={setRange} maxDays={b.item.max_days} /> : <Spinner />}
      <p className="muted small">{range.start && range.end ? fmtRange(range.start, range.end) : 'Pick the first and last day.'}</p>
      <button className="btn btn-primary btn-block" disabled={busy || !range.end} onClick={() => onSend(range.start, range.end)}>Send these dates</button>
    </Modal>
  );
}

function DeclineModal({ open, onClose, onSend, busy }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Decline request">
      <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I need it myself that week" maxLength={200} /></Field>
      <button className="btn btn-danger btn-block mt" disabled={busy} onClick={() => onSend(reason)}>Decline</button>
    </Modal>
  );
}

function ExtendModal({ open, onClose, b, onSend, busy }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const min = addDays(b.end_date, 1);
  const max = addDays(b.end_date, b.item.max_days);
  return (
    <Modal open={open} onClose={onClose} title="Ask for more time">
      <div className="stack">
        <p className="muted small">Now due {fmtDate(b.end_date)}. You can ask for up to {b.item.max_days} more day(s).</p>
        <Field label="Keep it until"><input type="date" min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Why? (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. exam moved to Friday" maxLength={200} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy || !date} onClick={() => onSend(date, reason)}>Send request</button>
      </div>
    </Modal>
  );
}

function ReturnModal({ open, onClose, b, onDone }) {
  const { showToast } = useApp();
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  const [busy, run] = useAction(showToast);
  const send = async () => {
    const r = await run(() => post(`/borrows/${b.id}/return`, { condition, note }), 'Return confirmed');
    if (r) onDone(r);
  };
  return (
    <Modal open={open} onClose={onClose} title="Confirm return">
      <div className="stack">
        <p className="muted small">Check the item and compare it with the video you took before giving it. How did it come back?</p>
        <div className="choice-row">
          <button type="button" className={`choice ${condition === 'fine' ? 'on ok' : ''}`} onClick={() => setCondition('fine')}>👍<b>Came back fine</b></button>
          <button type="button" className={`choice ${condition === 'damaged' ? 'on bad' : ''}`} onClick={() => setCondition('damaged')}>⚠️<b>Came back damaged</b></button>
        </div>
        <Field label={`Note (optional${condition === 'damaged' ? ', but useful now' : ''})`}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={condition === 'damaged' ? 'e.g. new crack on the screen' : 'e.g. all good, thanks!'} maxLength={300} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !condition} onClick={send}>Confirm return</button>
        <p className="muted small">After this, the item stays hidden until you update its condition and share it again.</p>
      </div>
    </Modal>
  );
}

function ReportModal({ open, onClose, b, onDone }) {
  const { showToast } = useApp();
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [busy, run] = useAction(showToast);
  const canNotReturned = b.role === 'lender' && b.overdue;
  const send = async () => {
    const r = await run(() => post(`/borrows/${b.id}/reports`, { type, description }), 'Problem reported');
    if (r) onDone(r.reportId);
  };
  return (
    <Modal open={open} onClose={onClose} title="Report a problem">
      <div className="stack">
        <p className="muted small">Stay calm 🙂 Compare with the video taken before the handover, then agree on a fix together in the chat.</p>
        <div className="choice-row three">
          <button type="button" className={`choice ${type === 'damaged' ? 'on bad' : ''}`} onClick={() => setType('damaged')}>💔<b>Damaged</b></button>
          <button type="button" className={`choice ${type === 'lost' ? 'on bad' : ''}`} onClick={() => setType('lost')}>❓<b>Lost</b></button>
          {canNotReturned && <button type="button" className={`choice ${type === 'not_returned' ? 'on bad' : ''}`} onClick={() => setType('not_returned')}>⏳<b>Not returned</b></button>}
        </div>
        <Field label="What happened?"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. the screen has a new crack on the left side" maxLength={600} /></Field>
        <button className="btn btn-danger btn-block" disabled={busy || !type} onClick={send}>Send report</button>
      </div>
    </Modal>
  );
}
