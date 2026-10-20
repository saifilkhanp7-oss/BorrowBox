import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, fmtRange, dueText } from '../lib/api.js';
import { PageHead, Skeleton, ErrorBox, ItemStatus, CategoryArt, useLoad } from '../components/ui.jsx';
import { ChevronIcon } from '../components/Icons.jsx';

const STATUS = { requested: 'Waiting for answer', countered: 'New dates suggested', approved: 'Approved · handover next', active: 'Out', returned: 'Returned', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' };

function Row({ b, mode }) {
  let right;
  if (b.status === 'active') right = <span className={`pill ${b.overdue ? 'pill-danger' : b.due_today ? 'pill-warn' : 'pill-muted'}`}>{dueText(b.end_date)}</span>;
  else if (b.status === 'returned') right = <span className={`pill ${b.return_condition === 'damaged' ? 'pill-danger' : 'pill-ok'}`}>{b.return_condition === 'damaged' ? 'Damaged' : 'Fine'}{b.returned_on_time === 0 ? ' · late' : ''}</span>;
  else right = <span className="pill pill-muted">{STATUS[b.status]}</span>;
  const who = mode === 'borrowed' ? `from ${b.other?.name}` : mode === 'lent' ? `with ${b.other?.name}` : b.i_borrow ? `from ${b.other?.name}` : `to ${b.other?.name}`;
  return (
    <Link to={`/borrows/${b.id}`} className={`shelf-row ${b.overdue ? 'overdue' : ''}`}>
      <span className="shelf-thumb"><CategoryArt category={b.item.category} size="sm" /></span>
      <span className="list-main">
        <b>{b.item.name}</b>
        <span className="muted small">{who} · {fmtRange(b.status === 'countered' ? b.counter_start : b.start_date, b.status === 'countered' ? b.counter_end : b.end_date)} · {b.circle}</span>
        {b.pending_extension && <span className="small warn-text">Extension asked</span>}
        {mode === 'lent' && b.return_borrower_at && b.status === 'active' && <span className="small warn-text">Says returned – confirm</span>}
      </span>
      {right}
    </Link>
  );
}

const Section = ({ title, children, empty }) => (
  <section className="card">
    <h3>{title}</h3>
    {children && (Array.isArray(children) ? children.length > 0 : true) ? <div className="shelf-list">{children}</div> : <p className="muted small">{empty}</p>}
  </section>
);

export default function Shelf() {
  const { data, error, loading, reload } = useLoad(() => get('/shelf'), []);
  const [tab, setTab] = useState('now');
  const tabs = [
    ['now', 'Due & out'],
    ['requests', `Requests${data ? ` (${data.incoming.length + data.outgoing.length})` : ''}`],
    ['items', 'My items'],
    ['history', 'History'],
  ];
  return (
    <div className="page">
      <PageHead title="My Shelf" sub="What you borrowed, what you lent and what is due." />
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={4} />}
      {data && tab === 'now' && (
        <div className="stack">
          <Section title="Borrowed by me" empty="You are not borrowing anything right now.">{data.borrowed.map((b) => <Row key={b.id} b={b} mode="borrowed" />)}</Section>
          <Section title="Lent by me" empty="Nothing of yours is out right now.">{data.lent.map((b) => <Row key={b.id} b={b} mode="lent" />)}</Section>
          {data.favours.length > 0 && (
            <Section title="Favours">{data.favours.map((f) => (
              <Link key={f.id} to={`/favours/${f.id}`} className="shelf-row"><span className="list-main"><b>{f.title}</b><span className="muted small">{f.i_asked ? `asked ${f.other.name}` : `${f.other.name} asked you`}</span></span><span className="pill pill-muted">{f.status}</span></Link>
            ))}</Section>
          )}
          {data.giveaways.length > 0 && (
            <Section title="Giveaways to pick up">{data.giveaways.map((g) => (
              <Link key={g.id} to={`/giveaways/${g.id}`} className="shelf-row"><span className="list-main"><b>{g.item_name}</b><span className="muted small">{g.i_won ? `from ${g.other.name}` : `to ${g.other.name}`}{g.final_price != null ? ` · ₹${g.final_price} (in person)` : ''}</span></span><ChevronIcon /></Link>
            ))}</Section>
          )}
        </div>
      )}
      {data && tab === 'requests' && (
        <div className="stack">
          <Section title="Asked from me" empty="No requests to answer.">{data.incoming.map((b) => <Row key={b.id} b={b} />)}</Section>
          <Section title="Sent by me" empty="You have no open requests.">{data.outgoing.map((b) => <Row key={b.id} b={b} />)}</Section>
        </div>
      )}
      {data && tab === 'items' && (
        <Link to="/things" className="card notice-card">
          <b>📋 My things</b>
          <span className="muted small">Your private list of everything you own, with a counter →</span>
        </Link>
      )}
      {data && tab === 'items' && (
        <Section title="My items" empty="You haven't shared anything yet.">
          {data.myItems.map((i) => (
            <Link key={i.id} to={i.needs_review ? `/items/${i.id}/reshare` : `/items/${i.id}`} className="shelf-row">
              <span className="shelf-thumb"><CategoryArt category={i.category} size="sm" /></span>
              <span className="list-main"><b>{i.name}</b><span className="muted small">{i.circle}{i.is_shared ? ' · shared circle item' : ''}{i.listing_type === 'giveaway' ? ' · giveaway' : ''}</span>
                {i.needs_review && <span className="small warn-text">Came back – update condition & share again</span>}</span>
              <ItemStatus item={i} />
            </Link>
          ))}
        </Section>
      )}
      {data && tab === 'history' && (
        <Section title="Past borrows and lends" empty="Nothing here yet.">{data.history.map((b) => <Row key={b.id} b={b} />)}</Section>
      )}
    </div>
  );
}
