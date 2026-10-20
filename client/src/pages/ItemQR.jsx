import { useNavigate, useParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import { Spinner, ErrorBox, useLoad } from '../components/ui.jsx';
import { BackIcon, LogoMark } from '../components/Icons.jsx';

export default function ItemQR() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => get(`/items/${id}/qr`), [id]);
  if (loading) return <Spinner />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  return (
    <div className="page narrow">
      <div className="no-print row-between">
        <button className="back-link" onClick={() => nav(-1)}><BackIcon size={18} /> Back</button>
        <button className="btn btn-primary" onClick={() => window.print()}>Print label</button>
      </div>
      <p className="muted small no-print">Stick this on the item. At handover or return, scan it to jump straight to the confirm screen. People outside your circle who scan it see nothing.</p>
      <div className="qr-label">
        <div className="qr-svg" dangerouslySetInnerHTML={{ __html: data.svg }} />
        <div className="qr-text">
          <div className="qr-brand"><LogoMark size={22} /> BorrowBox</div>
          <div className="qr-name">{data.name}</div>
          <div className="qr-circle">{data.circle}</div>
          <div className="qr-hint">Scan to borrow or return</div>
        </div>
      </div>
    </div>
  );
}
