import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { get, post, timeAgo } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { PageHead, Skeleton, Empty, ErrorBox, useLoad } from '../components/ui.jsx';
import { BellIcon } from '../components/Icons.jsx';

export default function Notifications() {
  const { refreshUnread } = useApp();
  const { data, error, loading, reload } = useLoad(() => get('/notifications'), []);
  useEffect(() => {
    if (data?.notifications.some((n) => !n.read_at)) post('/notifications/read').then(refreshUnread).catch(() => {});
  }, [data, refreshUnread]);
  return (
    <div className="page narrow">
      <PageHead title="Notifications" />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Skeleton rows={5} />}
      {data && (data.notifications.length ? (
        <div className="card list">
          {data.notifications.map((n) => {
            const inner = (
              <>
                <span className={`dot ${n.read_at ? '' : 'on'}`} />
                <span className="list-main"><b>{n.title}</b>{n.body && <span className="muted small">{n.body}</span>}<span className="muted small">{timeAgo(n.created_at)}</span></span>
              </>
            );
            return n.link ? <Link key={n.id} to={n.link} className="list-row">{inner}</Link> : <div key={n.id} className="list-row static">{inner}</div>;
          })}
        </div>
      ) : <Empty icon={<BellIcon size={30} />} title="All quiet">You'll see requests, reminders and updates here.</Empty>)}
    </div>
  );
}
