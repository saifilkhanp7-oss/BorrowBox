import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post } from './lib/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const CIRCLE_KEY = 'bb_circle';
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [circles, setCircles] = useState([]);
  const [circleId, setCircleIdState] = useState(() => Number(safeGet(CIRCLE_KEY)) || null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState(0);

  const setCircleId = useCallback((id) => {
    setCircleIdState(id);
    safeSet(CIRCLE_KEY, id ? String(id) : null);
  }, []);

  const loadCircles = useCallback(async () => {
    const { circles: list } = await get('/circles');
    setCircles(list);
    setCircleIdState((cur) => {
      const keep = list.find((c) => c.id === cur) ? cur : list[0]?.id || null;
      safeSet(CIRCLE_KEY, keep ? String(keep) : null);
      return keep;
    });
    return list;
  }, []);

  useEffect(() => {
    get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    const onLogout = () => setUser(null);
    window.addEventListener('bb:logout', onLogout);
    return () => window.removeEventListener('bb:logout', onLogout);
  }, []);

  useEffect(() => { if (user) loadCircles().catch(() => {}); }, [user, loadCircles]);

  // unread notifications for the bell
  const refreshUnread = useCallback(() => {
    get('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    refreshUnread();
    const t = setInterval(() => { if (!document.hidden) refreshUnread(); }, 30000);
    const onFocus = () => refreshUnread();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [user, refreshUnread]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    safeSet('bb_theme', next);
  };

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, id: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.id >= 3400 ? null : t)), 3500);
  }, []);

  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    setUser(null);
    setCircles([]);
  };

  const circle = circles.find((c) => c.id === circleId) || null;

  return (
    <Ctx.Provider value={{
      user, setUser, circles, circle, circleId, setCircleId, loadCircles, theme, toggleTheme,
      toast, showToast, unread, refreshUnread, logout,
    }}>
      {children}
    </Ctx.Provider>
  );
}
