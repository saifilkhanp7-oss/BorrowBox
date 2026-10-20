import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext.jsx';
import {
  LogoMark, HomeIcon, BoxIcon, MegaphoneIcon, ShelfIcon, MenuIcon, BellIcon, SunIcon, MoonIcon,
  ChevronDownIcon, SparkIcon, GiftIcon, UsersIcon, ShieldIcon, ScanIcon, SettingsIcon, CheckIcon, PlusIcon, ListIcon,
} from './Icons.jsx';

export function ThemeToggle() {
  const { theme, toggleTheme } = useApp();
  return (
    <button className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Light / dark mode">
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function CircleSwitcher() {
  const { circles, circle, setCircleId } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!circles.length) return null;
  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="switcher-name">{circle?.name || 'Pick a circle'}</span>
        <ChevronDownIcon size={16} />
      </button>
      {open && (
        <div className="switcher-menu">
          {circles.map((c) => (
            <button key={c.id} className="switcher-item" onClick={() => { setCircleId(c.id); setOpen(false); nav('/'); }}>
              <span>{c.name}<span className="muted small"> · {c.members} member{c.members > 1 ? 's' : ''}</span></span>
              {c.id === circle?.id && <CheckIcon size={16} />}
            </button>
          ))}
          <button className="switcher-item add" onClick={() => { setOpen(false); nav('/circles'); }}><PlusIcon size={16} /> Create or join a circle</button>
        </div>
      )}
    </div>
  );
}

export function navLinks(circle) {
  const c = circle ? `/c/${circle.id}` : '';
  return [
    { to: '/', label: 'Home', icon: HomeIcon, end: true, main: true },
    { to: `${c}/items`, label: 'Items', icon: BoxIcon, main: true, needs: true },
    { to: `${c}/wanted`, label: 'Wanted', icon: MegaphoneIcon, main: true, needs: true },
    { to: '/shelf', label: 'My Shelf', icon: ShelfIcon, main: true },
    { to: '/things', label: 'My things', icon: ListIcon },
    { to: `${c}/skills`, label: 'Skills & favours', icon: SparkIcon, needs: true },
    { to: `${c}/giveaways`, label: 'Giveaways', icon: GiftIcon, needs: true },
    { to: '/circles', label: 'My circles', icon: UsersIcon },
    ...(circle?.role === 'admin' ? [{ to: `${c}/admin`, label: 'Circle admin', icon: ShieldIcon, needs: true }] : []),
    { to: '/scan', label: 'Scan QR', icon: ScanIcon },
    { to: '/settings', label: 'Settings', icon: SettingsIcon },
  ];
}

export default function Layout() {
  const { circle, unread, user } = useApp();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const links = navLinks(circle).filter((l) => !l.needs || circle);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="BorrowBox home"><LogoMark /><span className="brand-name">BorrowBox</span></Link>
        <CircleSwitcher />
        <div className="topbar-actions">
          <ThemeToggle />
          <Link to="/notifications" className="icon-btn bell" aria-label={`Notifications${unread ? ` (${unread} new)` : ''}`}>
            <BellIcon />
            {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
          </Link>
        </div>
      </header>

      <aside className="sidenav">
        <nav>
          {links.map((l) => (
            <NavLink key={l.label} to={l.to} end={l.end} className="sidenav-link"><l.icon /> {l.label}</NavLink>
          ))}
        </nav>
        <Link to={`/u/${user.id}`} className="sidenav-me">My profile</Link>
      </aside>

      <main className="main"><Outlet /></main>

      <nav className="bottomnav">
        {links.filter((l) => l.main).map((l) => (
          <NavLink key={l.label} to={l.to} end={l.end} className="bottomnav-link"><l.icon size={22} /><span>{l.label === 'My Shelf' ? 'Shelf' : l.label}</span></NavLink>
        ))}
        <NavLink to="/more" className="bottomnav-link"><MenuIcon size={22} /><span>More</span></NavLink>
      </nav>
    </div>
  );
}
