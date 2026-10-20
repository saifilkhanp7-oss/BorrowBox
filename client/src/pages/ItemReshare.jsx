import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { Field, PageHead, Spinner, ErrorBox, VideoNote, useLoad } from '../components/ui.jsx';
import { BackIcon } from '../components/Icons.jsx';
import { CONDITIONS } from './Items.jsx';

// After an item comes back: check it, update the condition (and notes), then share it again.
export default function ItemReshare() {
  const { id } = useParams();
  const { showToast } = useApp();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => get(`/items/${id}`), [id]);
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) { setCondition(data.item.condition); setNotes(data.item.condition_notes || ''); }
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const it = data.item;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/items/${id}/reshare`, { condition, condition_notes: notes });
      showToast(`${it.name} is shared again`);
      nav(`/items/${id}`, { replace: true });
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="page narrow">
      <PageHead back={<button className="icon-btn" onClick={() => nav(-1)} aria-label="Back"><BackIcon /></button>}
        title="Update & share again" sub={it.name} />
      <form className="stack" onSubmit={submit}>
        <section className="card stack">
          <p>Check the item now that it is back, and compare it with the video you took before giving it. Pick its <b>current condition</b> and write down anything new (a scratch, a dent), so the next borrower knows.</p>
          <Field label="Condition now">
            <div className="seg">
              {CONDITIONS.map((c) => (
                <button type="button" key={c} className={`seg-btn ${condition === c ? 'on' : ''}`} onClick={() => setCondition(c)}>{c}</button>
              ))}
            </div>
          </Field>
          <Field label="Condition notes (optional)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. small scratch on the back" maxLength={300} />
          </Field>
        </section>
        <VideoNote who="owner" />
        <div className="sticky-actions">
          <button type="button" className="btn" onClick={() => nav(`/items/${id}`)}>Keep hidden for now</button>
          <button className="btn btn-primary" disabled={busy || !condition}>{busy ? 'Saving…' : 'Share again'}</button>
        </div>
      </form>
    </div>
  );
}
