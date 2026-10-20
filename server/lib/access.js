import db from '../db.js';
import { notFound, forbidden } from './util.js';

// ---------- circles ----------
export const membership = (circleId, userId) =>
  db.get('SELECT role FROM circle_members WHERE circle_id=? AND user_id=?', circleId, userId);

// Non-members get 404 so they can't even tell the circle exists.
export async function requireMember(circleId, userId) {
  const m = await membership(circleId, userId);
  if (!m) throw notFound('Circle not found');
  return m;
}
export async function requireAdmin(circleId, userId) {
  const m = await requireMember(circleId, userId);
  if (m.role !== 'admin') throw forbidden('Only the circle admin can do this');
  return m;
}
export const isAdmin = async (circleId, userId) => (await membership(circleId, userId))?.role === 'admin';

export async function shareCircle(a, b) {
  if (a === b) return true;
  return !!(await db.get(`SELECT 1 AS x FROM circle_members m1 JOIN circle_members m2 ON m1.circle_id=m2.circle_id
                          WHERE m1.user_id=? AND m2.user_id=? LIMIT 1`, a, b));
}

export const circleAdmins = async (circleId) =>
  (await db.all(`SELECT user_id FROM circle_members WHERE circle_id=? AND role='admin'`, circleId)).map((r) => r.user_id);

// ---------- items ----------
export async function loadItem(id) {
  const item = await db.get('SELECT * FROM items WHERE id=?', id);
  if (!item || item.status === 'removed') throw notFound('Item not found');
  return item;
}
export async function itemForMember(id, userId) {
  const item = await loadItem(id);
  await requireMember(item.circle_id, userId);
  return item;
}
// The person who decides on requests: the owner, or any circle admin for shared items.
export const isLender = async (item, userId) => (item.is_shared ? isAdmin(item.circle_id, userId) : item.owner_id === userId);
export const itemLenders = async (item) => (item.is_shared ? circleAdmins(item.circle_id) : [item.owner_id]);
export async function requireLender(item, userId) {
  if (!(await isLender(item, userId))) throw forbidden(item.is_shared ? 'Only the circle admin manages shared items' : 'Only the owner can do this');
}

// ---------- borrows ----------
// 'borrower' | 'lender' | 'admin', or 404.
export async function borrowRole(borrow, item, userId) {
  if (borrow.borrower_id === userId) return 'borrower';
  if (borrow.lender_id === userId || (await isLender(item, userId))) return 'lender';
  if (await isAdmin(borrow.circle_id, userId)) return 'admin';
  throw notFound('Borrow not found');
}

// ---------- users ----------
export async function badgesFor(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  const map = new Map(list.map((id) => [id, []]));
  if (!list.length) return map;
  for (const r of await db.all('SELECT user_id, badge FROM user_badges WHERE lost_at IS NULL AND user_id = ANY(?) ORDER BY earned_at', list)) {
    map.get(r.user_id)?.push(r.badge);
  }
  return map;
}
export async function userCards(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (!list.length) return map;
  const badges = await badgesFor(list);
  for (const u of await db.all('SELECT id, name, room_no FROM users WHERE id = ANY(?)', list)) {
    map.set(u.id, { ...u, badges: badges.get(u.id) || [] });
  }
  return map;
}
export async function userCard(id) {
  if (!id) return null;
  return (await userCards([id])).get(id) || null;
}
export const hasBadge = async (userId, badge) =>
  !!(await db.get('SELECT 1 AS x FROM user_badges WHERE user_id=? AND badge=? AND lost_at IS NULL', userId, badge));
