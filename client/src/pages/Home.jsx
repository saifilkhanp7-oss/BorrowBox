import { Link } from 'react-router-dom';
import { get, fmtDate, fmtDateTime } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { ItemCard, Skeleton, ErrorBox, CategoryArt, useLoad } from '../components/ui.jsx';
import { PlusIcon, MegaphoneIcon, GiftIcon, ChevronIcon, BoxIcon, AlertIcon } from '../components/Icons.jsx';
import { CreateJoinForms, InviteBox } from './Circles.jsx';

export default function Home() {
  const { circle, circles, user } = useApp();
  if (!circles.length) {
    return (
      <div className="page">
        <div className="hero card">
          <h1>Hi {user.name.split(' ')[0]} 👋</h1>
          <p>BorrowBox works inside <b>circles</b> – small private groups like your hostel block, class, apartment or friend group. Create one and invite people, or join with a code.</p>
        </div>
        <CreateJoinForms />
      </div>
    );
  }
  if (!circle) return <Skeleton rows={3} />;
  return <Feed key={circle.id} circle={circle} />;
}

function Feed({ circle }) {
  const { user } = useApp();
  const { data, error, loading, reload } = useLoad(() => get(`/circles/${circle.id}/feed`), [circle.id]);
  const c = `/c/${circle.id}`;
  return (
    <div className="page">
      <div className="hero card">
        <div>
          <p className="muted small">{circle.name}</p>
          <h1>Hi {user.name.split(' ')[0]} 👋</h1>
          <p className="muted">Need something? Ask the circle before you buy.</p>
        </div>
        <div className="quick">
          <Link to={`${c}/items/new`} className="quick-btn"><PlusIcon /> Share an item</Link>
          <Link to={`${c}/wanted?new=1`} className="quick-btn"><MegaphoneIcon /> Ask for something</Link>
          <Link to={`${c}/giveaways/new`} className="quick-btn"><GiftIcon /> Give away</Link>
        </div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && <Skeleton rows={3} />}

      {data && (
        <>
          {data.todo.length > 0 && (
            <section className="card todo">
              <h3><AlertIcon size={18} /> Waiting for you</h3>
              <div className="list">
                {data.todo.map((t, i) => (
                  <Link key={i} to={t.link} className="list-row"><span className="list-main">{t.text}</span><ChevronIcon /></Link>
                ))}
              </div>
            </section>
          )}

          {data.wanted.length > 0 && (
            <section>
              <div className="section-head"><h2>Wanted</h2><Link to={`${c}/wanted`}>See all</Link></div>
              <div className="stack-s">
                {data.wanted.map((w) => (
                  <Link key={w.id} to={`${c}/wanted`} className={`card wanted-mini ${w.urgent ? 'urgent' : ''}`}>
                    {w.urgent ? <span className="pill pill-danger">Urgent</span> : <span className="pill pill-muted">Wanted</span>}
                    <span className="grow"><b>{w.title}</b><span className="muted small"> · {w.user_name}{w.needed_by ? ` · by ${fmtDate(w.needed_by)}` : ''}</span></span>
                    <ChevronIcon />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="section-head"><h2>Recently shared</h2><Link to={`${c}/items`}>Browse all</Link></div>
            {data.items.length ? (
              <div className="grid-items">{data.items.map((i) => <ItemCard key={i.id} item={i} />)}</div>
            ) : (
              <div className="card empty-inline">
                <BoxIcon size={28} />
                <div><b>No items yet.</b> <span className="muted">Be the first to share something useful like a charger, calculator or iron.</span></div>
                <Link to={`${c}/items/new`} className="btn btn-primary btn-sm">Share an item</Link>
              </div>
            )}
          </section>

          {data.giveaways.length > 0 && (
            <section>
              <div className="section-head"><h2>Giveaways</h2><Link to={`${c}/giveaways`}>See all</Link></div>
              <div className="grid-items">
                {data.giveaways.map((g) => (
                  <Link key={g.id} to={`/giveaways/${g.id}`} className="item-card">
                    <div className="item-card-photo"><CategoryArt category={g.category} /></div>
                    <div className="item-card-body">
                      <div className="item-card-name">{g.item_name}</div>
                      <span className={`pill ${g.mode === 'auction' ? 'pill-sun' : 'pill-ok'}`}>{g.mode === 'auction' ? 'Auction' : 'Free'}</span>
                      {g.ends_at && <div className="muted small">Ends {fmtDateTime(g.ends_at)}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h3>Invite people to {circle.name}</h3>
            <p className="muted small">More people = more things to borrow. Only members can see what is shared here.</p>
            <InviteBox circle={circle} />
          </section>
        </>
      )}
    </div>
  );
}
