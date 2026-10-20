import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { Field, PageHead, Spinner, ErrorBox, VideoNote, CategoryArt } from '../components/ui.jsx';
import { BackIcon } from '../components/Icons.jsx';
import { CATEGORIES, CONDITIONS } from './Items.jsx';

const EMPTY = { name: '', category: '', condition: 'Good', condition_notes: '', description: '', max_days: 3, rules: '', trusted_only: false };

// Name / category / condition / notes / description (also used for giveaways)
export function ItemFields({ f, set, lend = true }) {
  return (
    <>
      <Field label="Item name"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Casio fx-991EX calculator" maxLength={60} required /></Field>
      <Field label="Category">
        <div className="cat-pick">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={`cat-chip ${f.category === c ? 'on' : ''}`} onClick={() => set('category', c)}>
              <CategoryArt category={c} size="sm" /> {c}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Condition">
        <div className="seg">
          {CONDITIONS.map((c) => (
            <button type="button" key={c} className={`seg-btn ${f.condition === c ? 'on' : ''}`} onClick={() => set('condition', c)}>{c}</button>
          ))}
        </div>
      </Field>
      <Field label="Condition notes (optional)" hint="Write down anything already wrong, so nobody gets blamed for it later.">
        <input value={f.condition_notes} onChange={(e) => set('condition_notes', e.target.value)} placeholder="e.g. small scratch on the back, charger cable a bit loose" maxLength={300} />
      </Field>
      <Field label="Description (optional)"><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Model, size, anything useful to know" maxLength={600} /></Field>
      {lend && (
        <>
          <div className="grid-2 tight">
            <Field label="Max days someone can borrow it" hint="1 to 60 days">
              <input type="number" inputMode="numeric" min={1} max={60} value={f.max_days} onChange={(e) => set('max_days', e.target.value)} required />
            </Field>
            <Field label="Rules / pickup note (optional)">
              <input value={f.rules} onChange={(e) => set('rules', e.target.value)} placeholder='e.g. "Handle with care", "Pick up from room 204"' maxLength={300} />
            </Field>
          </div>
          <label className="toggle-card">
            <input type="checkbox" checked={!!f.trusted_only} onChange={(e) => set('trusted_only', e.target.checked)} />
            <span><b>⏰ Only lend to On-Time Returners</b><span className="muted small">Good for valuable things. Only people who returned things on time before can ask for it.</span></span>
          </label>
        </>
      )}
    </>
  );
}

export default function ItemForm({ edit = false }) {
  const { circle, showToast } = useApp();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const shared = sp.get('shared') === '1';
  const wantedId = sp.get('wanted');
  const thingId = sp.get('thing');
  const [f, setF] = useState(() => ({ ...EMPTY, name: sp.get('name') || '', category: sp.get('category') || '' }));
  const [item, setItem] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!edit) return;
    get(`/items/${id}`).then(({ item: it }) => {
      setItem(it);
      setF({
        name: it.name, category: it.category, condition: it.condition, condition_notes: it.condition_notes || '',
        description: it.description || '', max_days: it.max_days, rules: it.rules || '', trusted_only: it.trusted_only,
      });
    }).catch(setLoadErr);
  }, [edit, id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.category) { showToast('Pick a category', 'error'); return; }
    setBusy(true);
    try {
      const body = { ...f, max_days: Number(f.max_days), ...(shared ? { shared: true } : {}), ...(thingId && !edit ? { thing_id: Number(thingId) } : {}) };
      const r = edit ? await patch(`/items/${id}`, body) : await post(`/circles/${circle.id}/items`, body);
      showToast(edit ? 'Saved' : 'Item shared with the circle 🎉');
      if (wantedId && !edit) nav(`/c/${circle.id}/wanted?offer=${wantedId}&item=${r.item.id}`);
      else nav(`/items/${r.item.id}`, { replace: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setBusy(false); }
  };

  if (loadErr) return <div className="page"><ErrorBox error={loadErr} /></div>;
  if (edit && !item) return <Spinner />;

  return (
    <div className="page narrow">
      <PageHead
        back={<button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><BackIcon /></button>}
        title={edit ? 'Edit item' : shared ? 'Add a shared circle item' : 'Share an item'}
        sub={edit ? item.name : shared ? `Belongs to the whole circle (${circle.name}). You as admin manage requests.` : `Only members of ${circle?.name} can see it.`} />

      <form className="stack" onSubmit={submit}>
        <section className="card stack">
          <ItemFields f={f} set={set} />
        </section>

        <VideoNote />

        <div className="sticky-actions">
          <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Post item'}</button>
        </div>
      </form>
    </div>
  );
}
