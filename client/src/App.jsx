import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useApp } from './AppContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Auth from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Circles, { JoinCircle } from './pages/Circles.jsx';
import Items from './pages/Items.jsx';
import ItemForm from './pages/ItemForm.jsx';
import ItemDetail from './pages/ItemDetail.jsx';
import ItemReshare from './pages/ItemReshare.jsx';
import ItemQR from './pages/ItemQR.jsx';
import Borrow from './pages/Borrow.jsx';
import Wanted from './pages/Wanted.jsx';
import Skills, { Favour } from './pages/Skills.jsx';
import Giveaways, { GiveawayDetail, GiveawayNew } from './pages/Giveaways.jsx';
import Report from './pages/Report.jsx';
import Shelf from './pages/Shelf.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import Notifications from './pages/Notifications.jsx';
import { QrLanding } from './pages/QrLanding.jsx';

const Scan = lazy(() => import('./pages/Scan.jsx'));
import Settings from './pages/Settings.jsx';
import More from './pages/More.jsx';
import Things from './pages/Things.jsx';

// /c/:circleId/... switches the current circle to the one in the link (if the user is a member)
function CircleRoute() {
  const { circleId } = useParams();
  const { circles, setCircleId, circleId: current } = useApp();
  const id = Number(circleId);
  const member = circles.find((c) => c.id === id);
  useEffect(() => { if (member && current !== id) setCircleId(id); }, [member, id, current, setCircleId]);
  if (!circles.length) return <Spinner />;
  if (!member) return <div className="card center"><h3>Circle not found</h3><p className="muted">You are not a member of this circle.</p></div>;
  return <Outlet />;
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>;
}

export default function App() {
  const { user } = useApp();
  const loc = useLocation();

  if (user === undefined) return <div className="boot"><Spinner label="Opening BorrowBox…" /></div>;

  if (!user) {
    // remember where they wanted to go (invite link, QR code…)
    if (!['/login', '/signup', '/'].includes(loc.pathname)) {
      try { sessionStorage.setItem('bb_next', loc.pathname + loc.search); } catch { /* ignore */ }
    }
    return (
      <>
        <Routes>
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route path="*" element={<Auth mode="login" />} />
        </Routes>
        <Toast />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="signup" element={<Navigate to="/" replace />} />
          <Route path="circles" element={<Circles />} />
          <Route path="join/:code" element={<JoinCircle />} />
          <Route path="c/:circleId" element={<CircleRoute />}>
            <Route index element={<Navigate to="items" replace />} />
            <Route path="items" element={<Items />} />
            <Route path="items/new" element={<ItemForm />} />
            <Route path="wanted" element={<Wanted />} />
            <Route path="skills" element={<Skills />} />
            <Route path="giveaways" element={<Giveaways />} />
            <Route path="giveaways/new" element={<GiveawayNew />} />
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route path="items/:id" element={<ItemDetail />} />
          <Route path="items/:id/edit" element={<ItemForm edit />} />
          <Route path="items/:id/reshare" element={<ItemReshare />} />
          <Route path="items/:id/qr" element={<ItemQR />} />
          <Route path="borrows/:id" element={<Borrow />} />
          <Route path="favours/:id" element={<Favour />} />
          <Route path="giveaways/:id" element={<GiveawayDetail />} />
          <Route path="reports/:id" element={<Report />} />
          <Route path="shelf" element={<Shelf />} />
          <Route path="things" element={<Things />} />
          <Route path="u/:id" element={<Profile />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="scan" element={<Suspense fallback={<Spinner />}><Scan /></Suspense>} />
          <Route path="i/:token" element={<QrLanding />} />
          <Route path="settings" element={<Settings />} />
          <Route path="more" element={<More />} />
          <Route path="*" element={<div className="card center"><h3>Page not found</h3></div>} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}
