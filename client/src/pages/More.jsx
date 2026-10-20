import { Link } from 'react-router-dom';
import { useApp } from '../AppContext.jsx';
import { navLinks } from '../components/Layout.jsx';
import { Avatar, BadgeIcons } from '../components/ui.jsx';
import { ChevronIcon, LogoutIcon } from '../components/Icons.jsx';

export default function More() {
  const { circle, user, logout } = useApp();
  const links = navLinks(circle).filter((l) => !l.main && (!l.needs || circle));
  return (
    <div className="page narrow">
      <Link to={`/u/${user.id}`} className="card me-card">
        <Avatar name={user.name} size={48} />
        <span className="list-main"><b>{user.name} <BadgeIcons badges={[]} /></b><span className="muted small">View my profile, badges and thank-you notes</span></span>
        <ChevronIcon />
      </Link>
      <div className="card list">
        {links.map((l) => (
          <Link key={l.label} to={l.to} className="list-row"><span className="list-icon"><l.icon /></span><span className="list-main">{l.label}</span><ChevronIcon /></Link>
        ))}
        <button className="list-row" onClick={logout}><span className="list-icon"><LogoutIcon /></span><span className="list-main">Log out</span></button>
      </div>
    </div>
  );
}
