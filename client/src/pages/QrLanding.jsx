import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import { Spinner, ErrorBox, useLoad } from '../components/ui.jsx';
import { BoxIcon } from '../components/Icons.jsx';

export function QrLanding() {
  const { token } = useParams();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => get(`/qr/${token}`), [token]);
  useEffect(() => {
    if (!data || data.stranger) return;
    nav(data.borrowId ? `/borrows/${data.borrowId}` : `/items/${data.itemId}`, { replace: true });
  }, [data, nav]);
  if (loading) return <Spinner label="Opening item…" />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (data?.stranger) {
    return (
      <div className="page narrow">
        <div className="card center stack">
          <div className="empty-icon"><BoxIcon size={30} /></div>
          <h2>This item belongs to a BorrowBox circle</h2>
          <p className="muted">Only members of that circle can see it. If you found it, please give it back to its owner.</p>
          <Link to="/" className="btn">Go home</Link>
        </div>
      </div>
    );
  }
  return <Spinner />;
}
