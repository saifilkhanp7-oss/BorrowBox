import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { ItemCard, PageHead, Skeleton, ErrorBox, Empty, useLoad } from '../components/ui.jsx';
import { PlusIcon, SearchIcon } from '../components/Icons.jsx';

export const CATEGORIES = [
  'Books', 'Electronics & Chargers', 'Calculators & Stationery', 'Cycles & Vehicles',
  'Home & Kitchen', 'Tools', 'Sports', 'Clothes & Formal wear', 'Games & Fun', 'Other',
];
export const CONDITIONS = ['New', 'Like new', 'Good', 'Used', 'Worn'];

export default function Items() {
  const { circle } = useApp();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [available, setAvailable] = useState(false);
  const [shared, setShared] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ q: debounced, category, available: available ? '1' : '', shared: shared ? '1' : '' });
  const { data, error, loading, reload } = useLoad(() => get(`/circles/${circle.id}/items?${params}`), [circle.id, debounced, category, available, shared]);

  return (
    <div className="page">
      <PageHead title="Items" sub={`Things people share in ${circle.name}`}
        action={<Link to={`/c/${circle.id}/items/new`} className="btn btn-primary"><PlusIcon size={18} /> Share</Link>} />

      <div className="filters">
        <label className="search">
          <SearchIcon size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search books, chargers, cycle…" />
        </label>
        <div className="chips">
          <button className={`chip ${!category ? 'on' : ''}`} onClick={() => setCategory('')}>All</button>
          {CATEGORIES.map((c) => <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c === category ? '' : c)}>{c}</button>)}
        </div>
        <div className="row gap-m wrap">
          <label className="toggle"><input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} /> <span>Available now</span></label>
          <label className="toggle"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> <span>Circle's shared items</span></label>
        </div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={6} card />}
      {data && (data.items.length ? (
        <div className="grid-items">{data.items.map((i) => <ItemCard key={i.id} item={i} />)}</div>
      ) : (
        <Empty title={debounced || category || available || shared ? 'Nothing matches' : 'No items yet'}
          action={<Link to={`/c/${circle.id}/items/new`} className="btn btn-primary">Share an item</Link>}>
          {debounced || category ? 'Try another search, or post it on the Wanted board.' : 'Share something you don’t use every day.'}
        </Empty>
      ))}
    </div>
  );
}
