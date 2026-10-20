import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { dueText } from '../lib/api.js';
import { XIcon, BoxIcon, ShieldIcon } from './Icons.jsx';

export const BADGE_INFO = {
  on_time: { name: 'On-Time Returner', emoji: '⏰', desc: 'Returns things on time' },
  generous: { name: 'Generous Lender', emoji: '🤝', desc: 'Has lent things 5+ times' },
  helpful: { name: 'Helpful Neighbour', emoji: '🌱', desc: 'Helps with wanted posts and favours' },
  semester_saver: { name: 'Semester Saver', emoji: '🎓', desc: 'Gave away 3+ things' },
  businessperson: { name: 'Businessperson', emoji: '💼', desc: 'Sells things in auctions often' },
};

// Each category gets an emoji + colour instead of a photo
export const CATEGORY_ART = {
  Books: { emoji: '📚', hue: 28 },
  'Electronics & Chargers': { emoji: '🔌', hue: 210 },
  'Calculators & Stationery': { emoji: '🧮', hue: 265 },
  'Cycles & Vehicles': { emoji: '🚲', hue: 150 },
  'Home & Kitchen': { emoji: '🍳', hue: 15 },
  Tools: { emoji: '🔧', hue: 195 },
  Sports: { emoji: '🏏', hue: 95 },
  'Clothes & Formal wear': { emoji: '👔', hue: 330 },
  'Games & Fun': { emoji: '🎲', hue: 50 },
  Other: { emoji: '📦', hue: 170 },
};
export function CategoryArt({ category, size = 'md' }) {
  const a = CATEGORY_ART[category] || CATEGORY_ART.Other;
  return <span className={`cat-art cat-${size}`} style={{ '--hue': a.hue }} aria-hidden="true">{a.emoji}</span>;
}

// The reminder shown wherever an item changes hands (replaces photos)
export function VideoNote({ who = 'both' }) {
  return (
    <div className="video-note">
      <ShieldIcon size={20} />
      <div>
        {who !== 'borrower' && <p><b>📹 Sharing something?</b> Take a short video of the item on your phone before you give it (all sides, any scratches). Keep it until the item comes back.</p>}
        {who !== 'owner' && <p><b>🔍 Taking something?</b> Check the item carefully before you take it. If anything is already broken or missing, write it in the chat first.</p>}
      </div>
    </div>
  );
}

// ---------- data loading ----------
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const run = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (alive.current) setState({ data: null, error, loading: false });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

// Runs an action with a busy flag and shows errors as a toast
export function useAction(showToast) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) showToast(okMsg);
      return r;
    } catch (e) {
      showToast(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [showToast]);
  return [busy, run];
}

// ---------- small pieces ----------
export function Avatar({ name = '?', size = 36 }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, '--hue': hash }}>{initials}</span>
  );
}

export function BadgeIcons({ badges = [] }) {
  if (!badges.length) return null;
  return (
    <span className="badge-icons">
      {badges.map((b) => BADGE_INFO[b] && <span key={b} title={BADGE_INFO[b].name}>{BADGE_INFO[b].emoji}</span>)}
    </span>
  );
}

export function UserChip({ user, sub, to = true, size = 32 }) {
  if (!user) return null;
  const inner = (
    <>
      <Avatar name={user.name} size={size} />
      <span className="user-chip-text">
        <span className="user-chip-name">{user.name} <BadgeIcons badges={user.badges} /></span>
        {(sub || user.room_no) && <span className="muted small">{sub || `Room ${user.room_no}`}</span>}
      </span>
    </>
  );
  return to && user.id ? <Link to={`/u/${user.id}`} className="user-chip">{inner}</Link> : <span className="user-chip">{inner}</span>;
}

export function Spinner({ label }) {
  return <div className="spinner-wrap"><span className="spinner" />{label && <span className="muted">{label}</span>}</div>;
}

export function Skeleton({ rows = 3, card = false }) {
  return (
    <div className={card ? 'grid-items' : 'stack'}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className={`skeleton ${card ? 'skeleton-card' : ''}`} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="card error-box">
      <p>{error.message || String(error)}</p>
      {onRetry && <button className="btn btn-sm" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}

export function Empty({ icon, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <BoxIcon size={30} />}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, error }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function PageHead({ title, sub, back, action }) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {back}
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </div>
  );
}

// ---------- item card ----------
export function ItemStatus({ item }) {
  if (item.listing_type === 'giveaway') return <span className="pill pill-sun">Giveaway</span>;
  if (item.status === 'available') return <span className="pill pill-ok">Available</span>;
  if (item.status === 'borrowed') return <span className="pill pill-warn">Unavailable at this moment</span>;
  if (item.status === 'paused' && item.needs_review) return <span className="pill pill-muted">Came back · not shared yet</span>;
  if (item.status === 'paused') return <span className="pill pill-muted">Not shared right now</span>;
  return <span className="pill pill-muted">{item.status}</span>;
}

export function ItemCard({ item, to }) {
  return (
    <Link to={to || `/items/${item.id}`} className="item-card">
      <div className="item-card-photo">
        <CategoryArt category={item.category} />
        {item.trusted_only && <span className="corner-tag" title="Only for On-Time Returners">⏰ Trusted only</span>}
      </div>
      <div className="item-card-body">
        <div className="item-card-name">{item.name}</div>
        <div className="muted small">{item.category} · {item.condition}</div>
        <ItemStatus item={item} />
        {item.status === 'borrowed' && item.due_back && <div className="muted small">Back around {dueText(item.due_back).replace('Due ', '')}</div>}
        <div className="muted small item-card-owner">{item.is_shared ? `🏠 ${item.shared_by}` : item.owner?.name}</div>
      </div>
    </Link>
  );
}
