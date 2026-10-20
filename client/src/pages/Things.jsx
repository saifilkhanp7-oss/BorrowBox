import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Skeleton, ErrorBox, Empty, Modal, Field, CategoryArt, CATEGORY_ART, useLoad, useAction } from '../components/ui.jsx';
import { PlusIcon, SearchIcon, EditIcon, TrashIcon, ShareIcon } from '../components/Icons.jsx';
import { CATEGORIES } from './Items.jsx';

const STATUS = { available: 'Available', borrowed: 'Lent out now', paused: 'Not shared right now' };

function Stepper({ value, onChange, disabled, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={disabled || value <= 1} aria-label="One less">−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled || value >= 999} aria-label="One more">+</button>
    </div>
  );
}

function QuickAdd({ onAdded }) {
  const { showToast } = useApp();
  const [f, setF] = useState({ name: '', category: '', quantity: 1, note: '' });
  const [more, setMore] = useState(false);
  const [busy, run] = useAction(showToast);
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/things', { ...f, category: f.category || 'Other' }));
    if (r) {
      showToast(r.merged ? `Added to your ${f.name} (now ${r.things.find((t) => t.id === r.id)?.quantity})` : `${f.name} added`);
      setF({ name: '', category: f.category, quantity: 1, note: '' });
      setMore(false);
      onAdded(r);
    }
  };
  return (
    <form className="card stack quick-add" onSubmit={submit}>
      <h3>Add a thing</h3>
      <div className="qa-row">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Phone charger, Formal shirt, Cycle" maxLength={60} required aria-label="Thing name" />
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category">
          <option value="">Category…</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ART[c].emoji} {c}</option>)}
        </select>
      </div>
      <div className="qa-row qa-row-2">
        <div className="row gap-s"><span className="muted small">How many</span><Stepper value={f.quantity} onChange={(q) => setF({ ...f, quantity: q })} label="How many" /></div>
        <button type="button" className="link-btn" onClick={() => setMore((m) => !m)}>{more ? 'Hide note' : '+ Add a note'}</button>
        <button className="btn btn-primary" disabled={busy || !f.name.trim()}><PlusIcon size={18} /> Add</button>
      </div>
      {more && <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Note (optional), e.g. kept in the top shelf, bought in 2025" maxLength={200} aria-label="Note" />}
    </form>
  );
}

function EditModal({ thing, onClose, onSaved }) {
  const { showToast } = useApp();
  const [f, setF] = useState({ name: thing.name, category: thing.category, quantity: thing.quantity, note: thing.note || '' });
  const [busy, run] = useAction(showToast);
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => patch(`/things/${thing.id}`, f), 'Saved');
    if (r) onSaved(r);
  };
  return (
    <Modal open onClose={onClose} title="Edit thing">
      <form className="stack" onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required /></Field>
        <Field label="Category">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ART[c].emoji} {c}</option>)}
          </select>
        </Field>
        <Field label="How many"><Stepper value={f.quantity} onChange={(q) => setF({ ...f, quantity: q })} label="How many" /></Field>
        <Field label="Note (optional)"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>Save</button>
      </form>
    </Modal>
  );
}

function ShareModal({ thing, onClose }) {
  const { circles } = useApp();
  const nav = useNavigate();
  const go = (cid) => nav(`/c/${cid}/items/new?thing=${thing.id}&name=${encodeURIComponent(thing.name)}&category=${encodeURIComponent(thing.category)}`);
  return (
    <Modal open onClose={onClose} title={`Share "${thing.name}"`}>
      <div className="stack">
        <p className="muted small">Lend it to people in one of your circles. It stays on your list and shows where it is shared.</p>
        {circles.length ? circles.map((c) => (
          <button key={c.id} className="pick" onClick={() => go(c.id)}><b>{c.name}</b><span className="muted small">{c.members} member{c.members > 1 ? 's' : ''}</span></button>
        )) : <p className="notice">Join or create a circle first.</p>}
      </div>
    </Modal>
  );
}

export default function Things() {
  const { showToast } = useApp();
  const { data, error, loading, reload, setData } = useLoad(() => get('/things'), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [busy, run] = useAction(showToast);

  const apply = (r) => setData({ things: r.things, totals: r.totals });
  const setQty = async (t, quantity) => {
    // update the screen at once, then save
    setData((d) => ({ ...d, things: d.things.map((x) => (x.id === t.id ? { ...x, quantity } : x)) }));
    const r = await run(() => patch(`/things/${t.id}`, { quantity }));
    if (r) apply(r); else reload(true);
  };
  const remove = async (t) => {
    if (!confirm(`Remove "${t.name}" from your list?`)) return;
    const r = await run(() => del(`/things/${t.id}`), 'Removed');
    if (r) apply(r);
  };

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.things.filter((t) => (!cat || t.category === cat) && (!needle || t.name.toLowerCase().includes(needle) || (t.note || '').toLowerCase().includes(needle)));
    const map = new Map();
    for (const t of list) { if (!map.has(t.category)) map.set(t.category, []); map.get(t.category).push(t); }
    return CATEGORIES.filter((c) => map.has(c)).map((c) => ({ category: c, things: map.get(c) }));
  }, [data, q, cat]);

  return (
    <div className="page">
      <PageHead title="My things" sub="Everything you own, in one list. Only you can see this." />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={3} />}
      {data && (
        <>
          <section className="card counter">
            <div className="counter-main">
              <span className="counter-num">{data.totals.total}</span>
              <span className="counter-label">thing{data.totals.total === 1 ? '' : 's'} you have</span>
            </div>
            <div className="counter-sub muted small">
              {data.totals.different} different item{data.totals.different === 1 ? '' : 's'} · {data.totals.shared} shared in circles
            </div>
            {Object.keys(data.totals.by_category).length > 0 && (
              <div className="chips counter-chips">
                <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All · {data.totals.total}</button>
                {CATEGORIES.filter((c) => data.totals.by_category[c]).map((c) => (
                  <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
                    {CATEGORY_ART[c].emoji} {c} · {data.totals.by_category[c]}
                  </button>
                ))}
              </div>
            )}
          </section>

          <QuickAdd onAdded={apply} />

          {data.things.length > 0 && (
            <label className="search">
              <SearchIcon size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your things…" />
            </label>
          )}

          {data.things.length === 0 ? (
            <Empty title="Your list is empty">Add the things you own – chargers, books, clothes, tools… It helps you keep count, and you can share any of them in a circle later.</Empty>
          ) : groups.length === 0 ? (
            <p className="muted center">Nothing matches.</p>
          ) : groups.map((g) => (
            <section key={g.category} className="card thing-group">
              <h3 className="thing-group-head">
                <CategoryArt category={g.category} size="sm" /> {g.category}
                <span className="muted small">{g.things.reduce((n, t) => n + t.quantity, 0)}</span>
              </h3>
              <ul className="thing-list">
                {g.things.map((t) => (
                  <li key={t.id} className="thing">
                    <div className="thing-main">
                      <b>{t.name}</b>
                      {t.note && <span className="muted small">{t.note}</span>}
                      {t.shared && (
                        <Link to={`/items/${t.shared.item_id}`} className="pill pill-ok thing-shared">
                          Shared in {t.shared.circle} · {STATUS[t.shared.status] || t.shared.status}
                        </Link>
                      )}
                    </div>
                    <div className="thing-actions">
                      <Stepper value={t.quantity} onChange={(qv) => setQty(t, qv)} disabled={busy} label={`How many ${t.name}`} />
                      <div className="row gap-s">
                        {!t.shared && <button className="icon-btn" onClick={() => setSharing(t)} aria-label={`Share ${t.name} in a circle`} title="Share in a circle"><ShareIcon size={18} /></button>}
                        <button className="icon-btn" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`} title="Edit"><EditIcon size={18} /></button>
                        <button className="icon-btn danger" onClick={() => remove(t)} aria-label={`Remove ${t.name}`} title="Remove"><TrashIcon size={18} /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {editing && <EditModal thing={editing} onClose={() => setEditing(null)} onSaved={(r) => { apply(r); setEditing(null); }} />}
      {sharing && <ShareModal thing={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
