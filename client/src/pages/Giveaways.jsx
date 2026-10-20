import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, fmtDateTime } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Skeleton, ErrorBox, Empty, Field, UserChip, Spinner, CategoryArt, VideoNote, useLoad, useAction } from '../components/ui.jsx';
import Chat from '../components/Chat.jsx';
import { PlusIcon, GiftIcon, BackIcon, HeartIcon } from '../components/Icons.jsx';
import { ItemFields } from './ItemForm.jsx';

const MONEY_NOTE = 'BorrowBox only helps decide who gets the item. Any payment is done in person, outside the app.';

function Countdown({ endsAt, serverNow }) {
  const offset = serverNow ? serverNow - Date.now() : 0;
  const [t, setT] = useState(() => endsAt - (Date.now() + offset));
  useEffect(() => { const i = setInterval(() => setT(endsAt - (Date.now() + offset)), 1000); return () => clearInterval(i); }, [endsAt, offset]);
  if (t <= 0) return <span>Ending…</span>;
  const d = Math.floor(t / 864e5); const h = Math.floor((t % 864e5) / 36e5); const m = Math.floor((t % 36e5) / 6e4); const s = Math.floor((t % 6e4) / 1e3);
  return <span className="mono">{d > 0 ? `${d}d ` : ''}{h}h {m}m {d === 0 ? `${s}s` : ''}</span>;
}

export default function Giveaways() {
  const { circle } = useApp();
  const [tab, setTab] = useState('open');
  const { data, error, loading, reload } = useLoad(() => get(`/circles/${circle.id}/giveaways?status=${tab === 'past' ? 'past' : ''}`), [circle.id, tab]);
  return (
    <div className="page">
      <PageHead title="Giveaways" sub="Things people don't need anymore – free or by auction. Perfect at semester end."
        action={<Link to={`/c/${circle.id}/giveaways/new`} className="btn btn-primary"><PlusIcon size={18} /> Give away</Link>} />
      <div className="tabs">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Open</button>
        <button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Finished</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={4} card />}
      {data && (data.giveaways.length ? (
        <div className="grid-items">
          {data.giveaways.map((g) => (
            <Link key={g.id} to={`/giveaways/${g.id}`} className="item-card">
              <div className="item-card-photo"><CategoryArt category={g.item.category} /></div>
              <div className="item-card-body">
                <div className="item-card-name">{g.item.name}</div>
                <div className="muted small">{g.item.category} · {g.item.condition}</div>
                {g.mode === 'auction' ? (
                  <>
                    <span className="pill pill-sun">Auction</span>
                    <div className="small"><b>{g.highest_bid != null ? `₹${g.highest_bid}` : `From ₹${g.start_price}`}</b> <span className="muted">· {g.bid_count} bid{g.bid_count === 1 ? '' : 's'}</span></div>
                    {g.status === 'open' && <div className="muted small">Ends {fmtDateTime(g.ends_at)}</div>}
                  </>
                ) : (
                  <><span className="pill pill-ok">Free</span><div className="muted small">{g.interest_count} want{g.interest_count === 1 ? 's' : ''} it</div></>
                )}
                {g.status !== 'open' && <span className="pill pill-muted">{g.status === 'ended' ? 'Picking up' : g.status}</span>}
                <div className="muted small item-card-owner">{g.owner?.name}</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty icon={<GiftIcon size={30} />} title={tab === 'open' ? 'No giveaways right now' : 'Nothing finished yet'}
          action={tab === 'open' && <Link to={`/c/${circle.id}/giveaways/new`} className="btn btn-primary">Give something away</Link>}>
          Old books, notes, lab coats… someone junior might need them.
        </Empty>
      ))}
    </div>
  );
}

function defaultEnd() {
  const d = new Date(Date.now() + 3 * 864e5);
  d.setMinutes(0, 0, 0); d.setHours(20);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ModeFields({ m, setM }) {
  return (
    <>
      <div className="choice-row">
        <button type="button" className={`choice ${m.mode === 'free' ? 'on ok' : ''}`} onClick={() => setM({ ...m, mode: 'free' })}>🎁<b>Free</b><span className="muted small">People say “I want this”, you pick who gets it</span></button>
        <button type="button" className={`choice ${m.mode === 'auction' ? 'on ok' : ''}`} onClick={() => setM({ ...m, mode: 'auction' })}>🔨<b>Auction</b><span className="muted small">Highest bid when it ends gets it</span></button>
      </div>
      {m.mode === 'auction' && (
        <>
          <div className="grid-2 tight">
            <Field label="Minimum start price (₹)"><input type="number" min={0} value={m.start_price} onChange={(e) => setM({ ...m, start_price: e.target.value })} required /></Field>
            <Field label="Auction ends on"><input type="datetime-local" value={m.ends_at} onChange={(e) => setM({ ...m, ends_at: e.target.value })} required /></Field>
          </div>
          <p className="notice small">💬 {MONEY_NOTE}</p>
        </>
      )}
    </>
  );
}

export function GiveawayNew() {
  const { circle, showToast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', category: '', condition: 'Used', condition_notes: '', description: '' });
  const [m, setM] = useState({ mode: 'free', start_price: 50, ends_at: defaultEnd() });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.category) { showToast('Pick a category', 'error'); return; }
    const body = { ...f, mode: m.mode };
    if (m.mode === 'auction') { body.start_price = Number(m.start_price); body.ends_at = new Date(m.ends_at).getTime(); }
    setBusy(true);
    try {
      const r = await post(`/circles/${circle.id}/giveaways`, body);
      showToast('Giveaway posted 🎁');
      nav(`/giveaways/${r.giveaway.id}`, { replace: true });
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="page narrow">
      <PageHead back={<button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><BackIcon /></button>} title="Give something away" sub={`Only ${circle.name} members can see it.`} />
      <form className="stack" onSubmit={submit}>
        <section className="card stack">
          <h3>Free or auction?</h3>
          <ModeFields m={m} setM={setM} />
        </section>
        <section className="card stack"><ItemFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} lend={false} /></section>
        <p className="notice small">💼 Sell 3 things in auctions within 6 months to earn the <b>Businessperson</b> badge.</p>
        <VideoNote who="owner" />
        <div className="sticky-actions">
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post giveaway'}</button>
        </div>
      </form>
    </div>
  );
}

export function GiveawayDetail() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading, setData, reload } = useLoad(() => get(`/giveaways/${id}`), [id]);
  const [busy, run] = useAction(showToast);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [thanks, setThanks] = useState('');
  const [relist, setRelist] = useState(null);

  // refresh auctions every 15s so new bids show up
  useEffect(() => {
    if (data?.giveaway.mode !== 'auction' || data.giveaway.status !== 'open') return undefined;
    const t = setInterval(() => { if (!document.hidden) reload(true); }, 15000);
    return () => clearInterval(t);
  }, [data?.giveaway.mode, data?.giveaway.status, reload]);

  if (loading && !data) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const g = data.giveaway;
  const act = async (path, body, msg) => { const r = await run(() => post(`/giveaways/${id}/${path}`, body), msg); if (r?.giveaway) setData({ giveaway: r.giveaway }); return r; };
  const minBid = g.highest_bid ? g.highest_bid.amount + 1 : g.start_price;

  return (
    <div className="page item-page">
      <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>
      <div className="item-layout">
        <div className="item-media"><div className="item-hero"><CategoryArt category={g.item.category} size="lg" /><span className="muted small">{g.item.category}</span></div></div>
        <div className="stack">
          <section className="card stack">
            <div className="row gap-s wrap">
              <span className={`pill ${g.mode === 'auction' ? 'pill-sun' : 'pill-ok'}`}>{g.mode === 'auction' ? '🔨 Auction' : '🎁 Free giveaway'}</span>
              {g.status !== 'open' && <span className="pill pill-muted">{g.status === 'ended' ? (g.winner ? 'Winner picked' : 'Ended – no one yet') : g.status}</span>}
            </div>
            <h1>{g.item.name}</h1>
            <p className="muted">{g.item.category} · Condition: <b>{g.item.condition}</b></p>
            {g.item.description && <p>{g.item.description}</p>}
            {g.item.condition_notes && <div className="cond-notes">🩹 <b>Already noted:</b> {g.item.condition_notes}</div>}
            <UserChip user={g.owner} sub="Giving it away" />
          </section>

          {g.mode === 'auction' && (
            <section className="card stack">
              <div className="auction-top">
                <div><span className="muted small">{g.highest_bid ? 'Highest bid' : 'Starting price'}</span><div className="big-num">₹{g.highest_bid ? g.highest_bid.amount : g.start_price}</div>
                  {g.highest_bid && <span className="small">by {g.highest_bid.mine ? 'you 🎉' : g.highest_bid.user.name}</span>}</div>
                <div className="right"><span className="muted small">{g.status === 'open' ? 'Ends in' : 'Ended'}</span><div className="big-num small-num">{g.status === 'open' ? <Countdown endsAt={g.ends_at} serverNow={g.server_now} /> : fmtDateTime(g.ends_at)}</div>
                  <span className="muted small">{g.bid_count} bid{g.bid_count === 1 ? '' : 's'}</span></div>
              </div>
              {g.status === 'open' && !g.is_owner && !g.highest_bid?.mine && (
                <form className="row gap-s" onSubmit={async (e) => { e.preventDefault(); const r = await act('bids', { amount: Number(amount) }, 'Bid placed'); if (r) setAmount(''); }}>
                  <input type="number" min={minBid} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`₹${minBid} or more`} required className="grow" />
                  <button className="btn btn-primary" disabled={busy}>Place bid</button>
                </form>
              )}
              <p className="muted small">💬 {MONEY_NOTE} Bids can't be taken back.</p>
              {g.bids.length > 0 && (
                <details>
                  <summary className="small">All bids</summary>
                  <ul className="plain-list small">{g.bids.map((b) => <li key={b.id}>₹{b.amount} – {b.name} · {fmtDateTime(b.created_at)}</li>)}</ul>
                </details>
              )}
            </section>
          )}

          {g.mode === 'free' && g.status === 'open' && (
            <section className="card stack">
              {g.is_owner ? (
                <>
                  <h3>Who wants it ({g.interest.length})</h3>
                  {g.interest.length ? g.interest.map((i) => (
                    <div key={i.id} className="row-between wrap gap-s interest">
                      <span><UserChip user={i.user} size={28} />{i.note && <span className="muted small"> “{i.note}”</span>}</span>
                      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act('pick', { userId: i.user.id }, `${i.user.name} will get it`)}>Give to {i.user.name.split(' ')[0]}</button>
                    </div>
                  )) : <p className="muted">No one yet. We'll notify you.</p>}
                </>
              ) : g.i_am_interested ? (
                <div className="row-between wrap gap-s"><span>✅ You asked for it. The owner will pick someone.</span><button className="btn btn-sm" disabled={busy} onClick={() => act('interest', { remove: true }, 'Removed')}>Take back</button></div>
              ) : (
                <form className="stack-s" onSubmit={(e) => { e.preventDefault(); act('interest', { note }, 'The owner was told'); }}>
                  <Field label="Short note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I'm in 1st year, need it for this sem" maxLength={200} /></Field>
                  <button className="btn btn-primary" disabled={busy}>I want this</button>
                </form>
              )}
              {!g.is_owner && <p className="muted small">{g.interest_count} person{g.interest_count === 1 ? '' : 's'} asked so far.</p>}
            </section>
          )}

          {g.winner && (
            <section className="card stack">
              <h3>{g.is_winner ? `You ${g.mode === 'auction' ? 'won' : 'are getting'} it! 🎉` : `Going to ${g.winner.name}`}</h3>
              {g.final_price != null && <p>Final price: <b>₹{g.final_price}</b> <span className="muted small">(paid in person)</span></p>}
              {g.is_owner && g.status === 'ended' && <button className="btn btn-primary self-start" disabled={busy} onClick={() => act('given', {}, 'Marked as given 🎉')}>I handed it over</button>}
              {g.status === 'given' && <p className="muted">Handed over. 🎓</p>}
              {g.is_winner && g.status === 'given' && (g.thanked ? <p className="muted small"><HeartIcon size={14} /> You left a thank-you note.</p> : (
                <form className="thanks" onSubmit={(e) => { e.preventDefault(); act('thanks', { message: thanks }, 'Thank-you note sent 💌'); }}>
                  <label className="field"><span className="field-label">💌 Thank {g.owner.name}</span><input value={thanks} onChange={(e) => setThanks(e.target.value)} maxLength={200} /></label>
                  <button className="btn btn-sm" disabled={busy || thanks.trim().length < 2}>Send</button>
                </form>
              ))}
            </section>
          )}

          {g.is_owner && g.status === 'ended' && !g.winner && (
            <section className="card stack">
              <h3>No one got it yet</h3>
              {relist ? (
                <form className="stack" onSubmit={async (e) => {
                  e.preventDefault();
                  const body = { mode: relist.mode, start_price: relist.start_price, ends_at: new Date(relist.ends_at).getTime() };
                  const r = await act('relist', body, 'Listed again'); if (r) setRelist(null);
                }}>
                  <ModeFields m={relist} setM={setRelist} />
                  <button className="btn btn-primary" disabled={busy}>List again</button>
                </form>
              ) : <button className="btn self-start" onClick={() => setRelist({ mode: 'free', start_price: g.start_price || 0, ends_at: defaultEnd() })}>Run again or make it free</button>}
            </section>
          )}

          {g.is_owner && ['open', 'ended'].includes(g.status) && !(g.mode === 'auction' && g.bid_count > 0) && (
            <button className="btn btn-sm btn-danger-ghost self-start" disabled={busy} onClick={async () => { if (confirm('Cancel this giveaway?')) { const r = await act('cancel', {}, 'Cancelled'); if (r) nav(-1); } }}>Cancel giveaway</button>
          )}

          {g.chat_open && <Chat base={`/giveaways/${id}`} title={g.is_owner ? `Chat with ${g.winner.name}` : `Chat with ${g.owner.name}`} />}
        </div>
      </div>
    </div>
  );
}
