import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { h, bad, now, str, optStr, idParam, forbidden, notFound, today } from '../lib/util.js';
import { requireMember, requireAdmin, userCards } from '../lib/access.js';
import { notify, notifyMany } from '../lib/notify.js';
import { itemSummaries } from './items.js';

export const circlesRouter = Router();

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function newCode() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 7; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
    const code = `${s.slice(0, 3)}-${s.slice(3)}`;
    if (!(await db.get('SELECT 1 AS x FROM circles WHERE invite_code=?', code))) return code;
  }
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{3})(.+)$/, '$1-$2');

const CIRCLE_SQL = `SELECT c.*, m.role, (SELECT COUNT(*) FROM circle_members x WHERE x.circle_id=c.id) AS members
                    FROM circles c LEFT JOIN circle_members m ON m.circle_id=c.id AND m.user_id=?`;
const circleOut = (c) => ({
  id: c.id, name: c.name, description: c.description, created_at: c.created_at,
  role: c.role, members: c.members, invite_code: c.invite_code, // members can share the invite too
});
const getCircle = async (id, uid) => circleOut(await db.get(`${CIRCLE_SQL} WHERE c.id=?`, uid, id));

circlesRouter.get('/', h(async (req, res) => {
  const rows = await db.all(`${CIRCLE_SQL} WHERE m.user_id IS NOT NULL ORDER BY m.joined_at`, req.user.id);
  res.json({ circles: rows.map(circleOut) });
}));

circlesRouter.post('/', h(async (req, res) => {
  const name = str(req.body?.name, { min: 2, max: 50, field: 'Circle name' });
  const description = optStr(req.body?.description, 200, 'Description');
  const { n } = await db.get('SELECT COUNT(*) n FROM circles WHERE created_by=?', req.user.id);
  if (n >= 20) throw bad('You can create at most 20 circles.');
  const code = await newCode();
  const id = await db.tx(async (t) => {
    const cid = await t.insert('INSERT INTO circles(name,description,invite_code,created_by,created_at) VALUES(?,?,?,?,?)',
      name, description, code, req.user.id, now());
    await t.run(`INSERT INTO circle_members(circle_id,user_id,role,joined_at) VALUES(?,?,'admin',?)`, cid, req.user.id, now());
    return cid;
  });
  res.json({ circle: await getCircle(id, req.user.id) });
}));

circlesRouter.get('/preview/:code', h(async (req, res) => {
  const c = await db.get(`${CIRCLE_SQL} WHERE c.invite_code=?`, req.user.id, normCode(req.params.code));
  if (!c) throw notFound('This invite code is not valid. Ask for a new one.');
  res.json({ circle: { id: c.id, name: c.name, description: c.description, members: c.members }, member: !!c.role });
}));

circlesRouter.post('/join', h(async (req, res) => {
  const c = await db.get('SELECT * FROM circles WHERE invite_code=?', normCode(req.body?.code));
  if (!c) throw notFound('This invite code is not valid. Ask for a new one.');
  const added = await db.run(`INSERT INTO circle_members(circle_id,user_id,role,joined_at) VALUES(?,?,'member',?) ON CONFLICT DO NOTHING`,
    c.id, req.user.id, now());
  if (added) {
    const admins = (await db.all(`SELECT user_id FROM circle_members WHERE circle_id=? AND role='admin'`, c.id)).map((r) => r.user_id);
    await notifyMany(admins, { circleId: c.id, type: 'member_joined', title: `${req.user.name} joined ${c.name}`, link: `/c/${c.id}/admin` });
  }
  res.json({ circle: await getCircle(c.id, req.user.id) });
}));

circlesRouter.get('/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireMember(id, req.user.id);
  res.json({ circle: await getCircle(id, req.user.id) });
}));

circlesRouter.patch('/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireAdmin(id, req.user.id);
  const name = str(req.body?.name, { min: 2, max: 50, field: 'Circle name' });
  const description = optStr(req.body?.description, 200, 'Description');
  await db.run('UPDATE circles SET name=?, description=? WHERE id=?', name, description, id);
  res.json({ circle: await getCircle(id, req.user.id) });
}));

circlesRouter.post('/:id/regenerate-code', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireAdmin(id, req.user.id);
  await db.run('UPDATE circles SET invite_code=? WHERE id=?', await newCode(), id);
  res.json({ circle: await getCircle(id, req.user.id) });
}));

circlesRouter.get('/:id/members', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireMember(id, req.user.id);
  const rows = await db.all('SELECT user_id, role, joined_at FROM circle_members WHERE circle_id=? ORDER BY role, joined_at', id);
  const cards = await userCards(rows.map((r) => r.user_id));
  res.json({ members: rows.map((r) => ({ ...cards.get(r.user_id), role: r.role, joined_at: r.joined_at })) });
}));

const activeBorrowsIn = async (circleId, userId) => (await db.get(
  `SELECT COUNT(*) n FROM borrows b JOIN items i ON i.id=b.item_id
   WHERE b.circle_id=? AND b.status='active' AND (b.borrower_id=? OR i.owner_id=?)`, circleId, userId, userId)).n;

// When someone leaves or is removed: hide their listings that are not out right now, cancel open requests.
async function cleanupMember(t, circleId, userId) {
  await t.run(`UPDATE items SET status='removed', updated_at=? WHERE circle_id=? AND owner_id=? AND status IN ('available','paused')`, now(), circleId, userId);
  await t.run(`UPDATE borrows SET status='cancelled', updated_at=? WHERE circle_id=? AND status IN ('requested','countered','approved')
               AND (borrower_id=? OR item_id IN (SELECT id FROM items WHERE owner_id=?))`, now(), circleId, userId, userId);
  await t.run(`UPDATE skills SET status='removed' WHERE circle_id=? AND user_id=?`, circleId, userId);
  await t.run(`UPDATE wanted_posts SET status='closed' WHERE circle_id=? AND user_id=? AND status='open'`, circleId, userId);
  await t.run('DELETE FROM waitlist WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE circle_id=?)', userId, circleId);
  await t.run('DELETE FROM circle_members WHERE circle_id=? AND user_id=?', circleId, userId);
}

circlesRouter.delete('/:id/members/:userId', h(async (req, res) => {
  const id = idParam(req.params.id);
  const target = idParam(req.params.userId);
  await requireAdmin(id, req.user.id);
  if (target === req.user.id) throw bad('You cannot remove yourself. Hand the admin role to someone first, then leave.');
  if (!(await db.get('SELECT 1 AS x FROM circle_members WHERE circle_id=? AND user_id=?', id, target))) throw notFound('Member not found');
  await db.tx((t) => cleanupMember(t, id, target));
  const c = await db.get('SELECT name FROM circles WHERE id=?', id);
  await notify(target, { type: 'removed', title: `You were removed from ${c.name}`, body: 'Things you are borrowing or lending there still show in My Shelf until returned.' });
  res.json({ ok: true });
}));

circlesRouter.post('/:id/transfer-admin', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireAdmin(id, req.user.id);
  const target = Number(req.body?.userId);
  if (!(await db.get('SELECT 1 AS x FROM circle_members WHERE circle_id=? AND user_id=?', id, target))) throw notFound('Member not found');
  if (target === req.user.id) throw bad('You are already the admin.');
  await db.tx(async (t) => {
    await t.run(`UPDATE circle_members SET role='admin' WHERE circle_id=? AND user_id=?`, id, target);
    await t.run(`UPDATE circle_members SET role='member' WHERE circle_id=? AND user_id=?`, id, req.user.id);
  });
  const c = await db.get('SELECT name FROM circles WHERE id=?', id);
  await notify(target, { circleId: id, type: 'admin', title: `You are now the admin of ${c.name}`, link: `/c/${id}/admin` });
  res.json({ ok: true });
}));

circlesRouter.post('/:id/leave', h(async (req, res) => {
  const id = idParam(req.params.id);
  const m = await requireMember(id, req.user.id);
  const { n: others } = await db.get('SELECT COUNT(*) n FROM circle_members WHERE circle_id=? AND user_id<>?', id, req.user.id);
  if (m.role === 'admin' && others > 0) throw forbidden('You are the admin. Hand the admin role to another member first.');
  if ((await activeBorrowsIn(id, req.user.id)) > 0) throw forbidden('You have things borrowed or lent out in this circle. Finish those returns first.');
  await db.tx(async (t) => {
    await cleanupMember(t, id, req.user.id);
    if (others === 0) await t.run('DELETE FROM circles WHERE id=?', id); // last person out: the circle disappears
  });
  res.json({ ok: true });
}));

circlesRouter.get('/:id/feed', h(async (req, res) => {
  const id = idParam(req.params.id);
  await requireMember(id, req.user.id);
  const uid = req.user.id;
  const adminHere = `EXISTS(SELECT 1 FROM circle_members cm WHERE cm.circle_id=i.circle_id AND cm.user_id=? AND cm.role='admin')`;
  const [items, wanted, giveaways, borrows, review] = await Promise.all([
    itemSummaries(`i.circle_id=? AND i.listing_type='lend' AND i.status IN ('available','borrowed')`, [id], 'ORDER BY i.created_at DESC LIMIT 8'),
    db.all(`SELECT w.*, u.name AS user_name FROM wanted_posts w JOIN users u ON u.id=w.user_id
            WHERE w.circle_id=? AND w.status='open' ORDER BY w.urgent DESC, w.created_at DESC LIMIT 5`, id),
    db.all(`SELECT g.*, i.name AS item_name, i.category, i.id AS item_id FROM giveaways g JOIN items i ON i.id=g.item_id
            WHERE i.circle_id=? AND g.status='open' ORDER BY (g.ends_at IS NULL), g.ends_at LIMIT 4`, id),
    db.all(`SELECT b.*, i.name AS item_name, i.owner_id, i.is_shared FROM borrows b JOIN items i ON i.id=b.item_id
            WHERE b.circle_id=? AND b.status IN ('requested','countered','approved','active')
            AND (b.borrower_id=? OR i.owner_id=? OR (i.is_shared=1 AND ${adminHere}))
            ORDER BY b.updated_at DESC LIMIT 20`, id, uid, uid, uid),
    db.all(`SELECT i.id, i.name FROM items i WHERE i.circle_id=? AND i.needs_review=1 AND i.status='paused'
            AND (i.owner_id=? OR (i.is_shared=1 AND ${adminHere}))`, id, uid, uid),
  ]);
  // things waiting for me in this circle
  const todo = [];
  for (const b of borrows) {
    const lender = b.borrower_id !== uid;
    let text = null;
    if (b.status === 'requested' && lender) text = `Answer request for ${b.item_name}`;
    else if (b.status === 'countered' && !lender) text = `Owner suggested new dates for ${b.item_name}`;
    else if (b.status === 'approved') text = `${b.item_name}: confirm handover`;
    else if (b.status === 'active' && !lender && b.end_date <= today()) text = `${b.item_name} is due ${b.end_date < today() ? '(overdue)' : 'today'}`;
    if (text) todo.push({ text, link: `/borrows/${b.id}` });
  }
  for (const i of review) todo.push({ text: `${i.name} came back – update condition & share again`, link: `/items/${i.id}/reshare` });
  res.json({ items, wanted, giveaways, todo });
}));
