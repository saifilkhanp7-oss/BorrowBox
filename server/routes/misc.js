// Users/profile, notifications, My Shelf.
import { Router } from 'express';
import db from '../db.js';
import { h, bad, optStr, str, idParam, notFound, forbidden, today, bool } from '../lib/util.js';
import { shareCircle, userCard, userCards } from '../lib/access.js';
import { BADGES } from '../lib/badges.js';
import { itemSummaries } from './items.js';

export const miscRouter = Router();
const USER_COLS = 'id, name, email, room_no, email_borrow, email_reminders, email_urgent, email_auctions, created_at';

// ---------- me / profile ----------
miscRouter.patch('/users/me', h(async (req, res) => {
  const b = req.body || {};
  const name = b.name !== undefined ? str(b.name, { min: 2, max: 40, field: 'Name' }) : req.user.name;
  if (!/^[\p{L}\p{M} .'-]{2,40}$/u.test(name)) throw bad('Name must be 2–40 letters');
  const room = b.room_no !== undefined ? optStr(b.room_no, 30, 'Room / flat number') : req.user.room_no;
  const flag = (k) => (b[k] !== undefined ? (bool(b[k]) ? 1 : 0) : req.user[k]);
  await db.run('UPDATE users SET name=?, room_no=?, email_borrow=?, email_reminders=?, email_urgent=?, email_auctions=? WHERE id=?',
    name, room, flag('email_borrow'), flag('email_reminders'), flag('email_urgent'), flag('email_auctions'), req.user.id);
  res.json({ user: await db.get(`SELECT ${USER_COLS} FROM users WHERE id=?`, req.user.id) });
}));

miscRouter.get('/badges', (req, res) => res.json({ badges: BADGES }));

miscRouter.get('/users/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await shareCircle(req.user.id, id))) throw notFound('Profile not found');
  const card = await userCard(id);
  if (!card) throw notFound('Profile not found');
  // only show listings in circles we both belong to
  const circles = await db.all(`SELECT c.id, c.name FROM circles c JOIN circle_members a ON a.circle_id=c.id AND a.user_id=?
                                JOIN circle_members b ON b.circle_id=c.id AND b.user_id=?`, req.user.id, id);
  const cid = Number(req.query.circleId);
  const ids = circles.map((c) => c.id).filter((x) => !cid || x === cid);
  const own = id === req.user.id;
  const [items, skills, notes] = await Promise.all([
    itemSummaries(`i.owner_id=? AND i.circle_id = ANY(?) AND i.status IN ('available','borrowed')`, [id, ids], 'ORDER BY i.created_at DESC'),
    db.all(`SELECT id, title, description, circle_id FROM skills WHERE user_id=? AND circle_id = ANY(?) AND status='active'`, id, ids),
    db.all(`SELECT id, message, created_at, hidden, from_user FROM thank_you_notes WHERE to_user=? ${own ? '' : 'AND hidden=0'} ORDER BY created_at DESC LIMIT 50`, id),
  ]);
  const cards = await userCards(notes.map((n) => n.from_user));
  res.json({ user: card, badge_info: BADGES, circles, items, skills, notes: notes.map((n) => ({ ...n, from: cards.get(n.from_user) })), own });
}));

miscRouter.patch('/notes/:id', h(async (req, res) => {
  const n = await db.get('SELECT * FROM thank_you_notes WHERE id=?', idParam(req.params.id));
  if (!n) throw notFound();
  if (n.to_user !== req.user.id) throw forbidden();
  await db.run('UPDATE thank_you_notes SET hidden=? WHERE id=?', bool(req.body?.hidden) ? 1 : 0, n.id);
  res.json({ ok: true });
}));

// ---------- notifications ----------
miscRouter.get('/notifications', h(async (req, res) => {
  res.json({ notifications: await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', req.user.id) });
}));
miscRouter.get('/notifications/unread-count', h(async (req, res) => {
  res.json({ count: (await db.get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL', req.user.id)).n });
}));
miscRouter.post('/notifications/read', h(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) {
    await db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id = ANY(?)', Date.now(), req.user.id, ids);
  } else {
    await db.run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', Date.now(), req.user.id);
  }
  res.json({ ok: true });
}));

// ---------- My Shelf ----------
miscRouter.get('/shelf', h(async (req, res) => {
  const uid = req.user.id;
  // borrows where I'm the lender side: my items, or shared items in circles where I'm admin
  const lender = `(i.owner_id=? OR (i.is_shared=1 AND EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id=i.circle_id AND m.user_id=? AND m.role='admin')))`;
  const rows = await db.all(`SELECT b.*, i.name AS item_name, i.category, i.owner_id, i.is_shared, c.name AS circle_name,
      EXISTS(SELECT 1 FROM extensions e WHERE e.borrow_id=b.id AND e.status='pending') AS pending_extension,
      (b.borrower_id=?) AS i_borrow
    FROM borrows b JOIN items i ON i.id=b.item_id JOIN circles c ON c.id=b.circle_id
    WHERE (b.borrower_id=? OR ${lender}) ORDER BY b.updated_at DESC LIMIT 400`, uid, uid, uid, uid);
  const cards = await userCards(rows.flatMap((r) => [r.borrower_id, r.owner_id]));
  const t = today();
  const out = rows.map((b) => ({
    id: b.id, status: b.status, start_date: b.start_date, end_date: b.end_date,
    counter_start: b.counter_start, counter_end: b.counter_end,
    overdue: b.status === 'active' && b.end_date < t, due_today: b.status === 'active' && b.end_date === t,
    return_condition: b.return_condition, returned_on_time: b.returned_on_time,
    return_borrower_at: b.return_borrower_at,
    item: { id: b.item_id, name: b.item_name, category: b.category },
    circle: b.circle_name,
    other: b.i_borrow ? (b.is_shared ? { name: b.circle_name } : cards.get(b.owner_id)) : cards.get(b.borrower_id),
    i_borrow: !!b.i_borrow,
    pending_extension: !!b.pending_extension,
    updated_at: b.updated_at,
  }));
  const pick = (fn) => out.filter(fn);
  const sortDue = (a, b) => (b.overdue - a.overdue) || a.end_date.localeCompare(b.end_date);
  const borrowed = pick((b) => b.i_borrow && ['approved', 'active'].includes(b.status)).sort(sortDue);
  const lent = pick((b) => !b.i_borrow && ['approved', 'active'].includes(b.status)).sort(sortDue);
  const incoming = pick((b) => !b.i_borrow && ['requested', 'countered'].includes(b.status));
  const outgoing = pick((b) => b.i_borrow && ['requested', 'countered'].includes(b.status));
  const history = pick((b) => ['returned', 'declined', 'cancelled', 'expired'].includes(b.status)).slice(0, 200);

  const myItems = await itemSummaries(`(i.owner_id=? OR (i.is_shared=1 AND EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id=i.circle_id AND m.user_id=? AND m.role='admin')))
                                       AND i.status NOT IN ('removed','given')`, [uid, uid], 'ORDER BY i.needs_review DESC, i.created_at DESC');

  const favourRows = await db.all(`SELECT r.*, s.title, s.user_id AS helper_id FROM skill_requests r JOIN skills s ON s.id=r.skill_id
                                   WHERE (r.requester_id=? OR s.user_id=?) AND r.status IN ('pending','accepted') ORDER BY r.updated_at DESC`, uid, uid);
  const giveRows = await db.all(`SELECT g.*, i.name AS item_name, i.owner_id FROM giveaways g JOIN items i ON i.id=g.item_id
                                 WHERE g.status='ended' AND g.winner_id IS NOT NULL AND (g.winner_id=? OR i.owner_id=?)`, uid, uid);
  const more = await userCards([...favourRows.flatMap((r) => [r.requester_id, r.helper_id]), ...giveRows.flatMap((g) => [g.winner_id, g.owner_id])]);
  const favours = favourRows.map((r) => ({ id: r.id, title: r.title, status: r.status, i_asked: r.requester_id === uid, other: more.get(r.requester_id === uid ? r.helper_id : r.requester_id) }));
  const giveaways = giveRows.map((g) => ({ id: g.id, item_name: g.item_name, i_won: g.winner_id === uid, other: more.get(g.winner_id === uid ? g.owner_id : g.winner_id), final_price: g.final_price, mode: g.mode }));

  res.json({ borrowed, lent, incoming, outgoing, history, myItems, favours, giveaways });
}));
