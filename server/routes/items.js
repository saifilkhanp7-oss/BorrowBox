import { Router } from 'express';
import QRCode from 'qrcode';
import db from '../db.js';
import {
  h, bad, now, str, optStr, int, bool, idParam, forbidden, today, addDays, randomToken, CATEGORIES, CONDITIONS, publicBaseUrl,
} from '../lib/util.js';
import {
  requireMember, isAdmin, loadItem, itemForMember, isLender, requireLender, userCard, userCards, hasBadge,
} from '../lib/access.js';
import { notify, systemMessage } from '../lib/notify.js';
import { linkThing } from './things.js';

export const itemsRouter = Router();

export const VIDEO_MSG = 'Before you give this item to anyone, take a short video of it on your phone (all sides, any scratches). Keep the video until the item comes back. It protects you if the item comes back damaged.';
export const CHECK_MSG = 'Before you take an item, check it carefully in front of the owner. If something is already broken or missing, write it in the chat before you take it.';

// ---------- summaries (batched: few queries even for long lists) ----------
const ITEM_SELECT = `SELECT i.*, c.name AS circle_name,
  (SELECT b.end_date FROM borrows b WHERE b.item_id=i.id AND b.status='active' ORDER BY b.id DESC LIMIT 1) AS due_back
  FROM items i JOIN circles c ON c.id=i.circle_id`;

function summary(row, cards) {
  return {
    id: row.id, circle_id: row.circle_id, name: row.name, category: row.category, condition: row.condition,
    condition_notes: row.condition_notes,
    status: row.status, listing_type: row.listing_type, is_shared: !!row.is_shared, trusted_only: !!row.trusted_only,
    needs_review: !!row.needs_review, max_days: row.max_days,
    owner: row.is_shared ? null : cards.get(row.owner_id) || null,
    shared_by: row.is_shared ? row.circle_name : null,
    circle: row.circle_name,
    due_back: row.status === 'borrowed' ? row.due_back : null,
    created_at: row.created_at,
  };
}

export async function itemSummaries(where, args = [], tail = '') {
  const rows = await db.all(`${ITEM_SELECT} WHERE ${where} ${tail}`, ...args);
  const cards = await userCards(rows.map((r) => r.owner_id));
  return rows.map((r) => summary(r, cards));
}
export async function itemSummary(itemOrId) {
  const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId;
  return (await itemSummaries('i.id=?', [id]))[0];
}

export const activeBorrowOf = (itemId) =>
  db.get(`SELECT * FROM borrows WHERE item_id=? AND status='active' ORDER BY id DESC LIMIT 1`, itemId);

// Is the date range free? Looks at approved and active borrows (an overdue active borrow blocks until today).
export async function rangeClash(itemId, start, end, excludeId = 0) {
  const rows = await db.all(`SELECT id, start_date, end_date, status FROM borrows WHERE item_id=? AND id<>?
                             AND status IN ('approved','active')`, itemId, excludeId);
  const t = today();
  return rows.find((b) => {
    const bEnd = b.status === 'active' && b.end_date < t ? t : b.end_date;
    return start <= bEnd && end >= b.start_date;
  }) || null;
}

export function checkDates(item, start, end) {
  const t = today();
  if (!start || !end) throw bad('Pick a start and end date');
  if (start < t) throw bad('Start date cannot be in the past');
  if (end < start) throw bad('End date must be after the start date');
  if (start > addDays(t, 90)) throw bad('You can book at most 90 days ahead');
  const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  if (days > item.max_days) throw bad(`This item can be borrowed for at most ${item.max_days} day(s)`);
}

function readFields(body, { partial = false, lend = true } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { min: 2, max: 60, field: 'Item name' });
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) throw bad('Pick a category');
    out.category = body.category;
  }
  if (!partial || body.condition !== undefined) {
    if (!CONDITIONS.includes(body.condition)) throw bad('Pick the condition of the item');
    out.condition = body.condition;
  }
  if (!partial || body.condition_notes !== undefined) out.condition_notes = optStr(body.condition_notes, 300, 'Condition notes');
  if (!partial || body.description !== undefined) out.description = optStr(body.description, 600, 'Description');
  if (lend) {
    if (!partial || body.rules !== undefined) out.rules = optStr(body.rules, 300, 'Rules');
    if (!partial || body.max_days !== undefined) out.max_days = int(body.max_days ?? 7, { min: 1, max: 60, field: 'Max days' });
    if (!partial || body.trusted_only !== undefined) out.trusted_only = bool(body.trusted_only) ? 1 : 0;
  }
  return out;
}

// Creates an item (lend or giveaway). Pass `t` to create it inside a transaction.
export async function createItem(body, circleId, userId, { listingType = 'lend', shared = false } = {}, t = db) {
  const f = readFields(body || {}, { lend: listingType === 'lend' });
  return t.insert(`INSERT INTO items(circle_id,owner_id,is_shared,listing_type,name,category,condition,condition_notes,description,
                   max_days,rules,trusted_only,status,available_since,qr_token,created_by,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'available',?,?,?,?,?)`,
  circleId, shared ? null : userId, shared ? 1 : 0, listingType, f.name, f.category, f.condition, f.condition_notes,
  f.description, f.max_days || 1, f.rules || null, f.trusted_only || 0, now(), randomToken(12), userId, now(), now());
}

// First person on the waitlist hears right away; the rest after 12 hours (scheduler).
export async function notifyWaitlistFirst(item) {
  await db.run('UPDATE waitlist SET notified_at=NULL WHERE item_id=?', item.id);
  const first = await db.get('SELECT * FROM waitlist WHERE item_id=? ORDER BY created_at LIMIT 1', item.id);
  if (!first) return;
  await db.run('UPDATE waitlist SET notified_at=? WHERE id=?', now(), first.id);
  await notify(first.user_id, {
    circleId: item.circle_id, type: 'waitlist', title: `${item.name} is available again`,
    body: 'You were first on the waitlist. Send a request before someone else does.', link: `/items/${item.id}`, email: 'borrow',
  });
}

async function canRequest(item, userId, lender) {
  if (item.listing_type !== 'lend') return { ok: false, reason: 'This is a giveaway item' };
  if (lender) return { ok: false, reason: item.is_shared ? 'You manage this shared item' : 'This is your item' };
  if (item.status === 'paused') return { ok: false, reason: 'Not shared right now' };
  if (item.trusted_only && !(await hasBadge(userId, 'on_time'))) return { ok: false, reason: 'Only for On-Time Returners', trusted: true };
  return { ok: true };
}

export async function itemDetail(item, userId) {
  const lender = await isLender(item, userId);
  const [sum, active, mine, wl, admin, giveaway, req] = await Promise.all([
    itemSummary(item),
    activeBorrowOf(item.id),
    db.get(`SELECT id, status, start_date, end_date FROM borrows WHERE item_id=? AND borrower_id=?
            AND status IN ('requested','countered','approved','active') ORDER BY id DESC LIMIT 1`, item.id, userId),
    db.all('SELECT user_id, created_at FROM waitlist WHERE item_id=? ORDER BY created_at', item.id),
    isAdmin(item.circle_id, userId),
    item.listing_type === 'giveaway' ? db.get('SELECT id FROM giveaways WHERE item_id=? ORDER BY id DESC LIMIT 1', item.id) : null,
    canRequest(item, userId, lender),
  ]);
  const pos = wl.findIndex((w) => w.user_id === userId) + 1;
  return {
    ...sum,
    description: item.description, rules: item.rules,
    is_lender: lender,
    is_admin: admin,
    can_request: req,
    my_borrow: mine || null,
    on_waitlist: pos > 0,
    waitlist_position: pos || null,
    waitlist_count: wl.length,
    // who has it: only the lender side and the borrower; others just see "unavailable at this moment"
    active_borrow: active && (lender || active.borrower_id === userId)
      ? { id: active.id, end_date: active.end_date, borrower: await userCard(active.borrower_id) } : null,
    giveaway_id: giveaway?.id || null,
    video_msg: VIDEO_MSG,
    check_msg: CHECK_MSG,
  };
}

// ---------- routes ----------
itemsRouter.get('/circles/:id/items', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const { q, category, available, type = 'lend', mine } = req.query;
  let where = `i.circle_id=? AND i.listing_type=? AND i.status NOT IN ('removed','given')`;
  const args = [circleId, type === 'giveaway' ? 'giveaway' : 'lend'];
  if (q) { where += ' AND (i.name ILIKE ? OR i.description ILIKE ? OR i.category ILIKE ?)'; const like = `%${String(q).slice(0, 50)}%`; args.push(like, like, like); }
  if (category && CATEGORIES.includes(category)) { where += ' AND i.category=?'; args.push(category); }
  if (available === '1') where += ` AND i.status='available'`;
  if (mine === '1') { where += ' AND i.owner_id=?'; args.push(req.user.id); }
  if (req.query.shared === '1') where += ' AND i.is_shared=1';
  // paused items are only shown to their owner / the admin
  where += ` AND (i.status<>'paused' OR i.owner_id=? OR (i.is_shared=1 AND EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id=i.circle_id AND m.user_id=? AND m.role='admin')))`;
  args.push(req.user.id, req.user.id);
  const items = await itemSummaries(where, args, `ORDER BY CASE i.status WHEN 'available' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 300`);
  res.json({ items, categories: CATEGORIES });
}));

itemsRouter.post('/circles/:id/items', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  const m = await requireMember(circleId, req.user.id);
  const shared = bool(req.body?.shared);
  if (shared && m.role !== 'admin') throw forbidden('Only the circle admin can add shared items');
  const id = await createItem(req.body, circleId, req.user.id, { listingType: 'lend', shared });
  if (!shared && req.body?.thing_id) await linkThing(req.body.thing_id, id, req.user.id);
  res.json({ item: await itemDetail(await loadItem(id), req.user.id) });
}));

itemsRouter.get('/items/meta', (req, res) => res.json({ categories: CATEGORIES, conditions: CONDITIONS, videoMessage: VIDEO_MSG, checkMessage: CHECK_MSG }));

itemsRouter.get('/items/:id', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  res.json({ item: await itemDetail(item, req.user.id) });
}));

itemsRouter.patch('/items/:id', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  await requireLender(item, req.user.id);
  const f = readFields(req.body || {}, { partial: true, lend: item.listing_type === 'lend' });
  if (req.body?.status !== undefined) {
    const s = req.body.status;
    if (!['available', 'paused'].includes(s)) throw bad('Invalid status');
    if (item.status === 'borrowed') throw bad('The item is lent out right now');
    if (s === 'available' && item.needs_review) throw bad('Please update the condition first using "Share again"');
    f.status = s;
    if (s === 'available' && item.status !== 'available') f.available_since = now();
  }
  const keys = Object.keys(f);
  if (keys.length) {
    await db.run(`UPDATE items SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), now(), item.id);
  }
  const fresh = await loadItem(item.id);
  if (f.status === 'available' && item.status === 'paused') await notifyWaitlistFirst(fresh);
  res.json({ item: await itemDetail(fresh, req.user.id) });
}));

// After a return: owner updates the condition (and notes) and shares the item again.
itemsRouter.post('/items/:id/reshare', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  await requireLender(item, req.user.id);
  if (item.status === 'borrowed') throw bad('The item is still lent out');
  if (!CONDITIONS.includes(req.body?.condition)) throw bad('Pick the current condition of the item');
  const notes = req.body?.condition_notes !== undefined ? optStr(req.body.condition_notes, 300, 'Condition notes') : item.condition_notes;
  await db.run(`UPDATE items SET condition=?, condition_notes=?, status='available', needs_review=0, available_since=?, updated_at=? WHERE id=?`,
    req.body.condition, notes, now(), now(), item.id);
  const fresh = await loadItem(item.id);
  await notifyWaitlistFirst(fresh);
  res.json({ item: await itemDetail(fresh, req.user.id) });
}));

itemsRouter.delete('/items/:id', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  const admin = await isAdmin(item.circle_id, req.user.id);
  if (!(await isLender(item, req.user.id)) && !admin) throw forbidden('Only the owner or the circle admin can remove this item');
  if (item.status === 'borrowed') throw bad('This item is lent out right now. It can be removed after it is returned.');
  const open = await db.all(`SELECT * FROM borrows WHERE item_id=? AND status IN ('requested','countered','approved')`, item.id);
  await db.tx(async (t) => {
    await t.run(`UPDATE items SET status='removed', removed_by=?, updated_at=? WHERE id=?`, req.user.id, now(), item.id);
    await t.run(`UPDATE borrows SET status='cancelled', decline_reason='Item was removed', updated_at=? WHERE item_id=? AND status IN ('requested','countered','approved')`, now(), item.id);
    await t.run(`UPDATE giveaways SET status='cancelled' WHERE item_id=? AND status IN ('open','ended')`, item.id);
    await t.run('DELETE FROM waitlist WHERE item_id=?', item.id);
  });
  for (const b of open) {
    await systemMessage('borrow', b.id, 'Request cancelled because the item was removed.');
    await notify(b.borrower_id, { circleId: item.circle_id, type: 'borrow_cancelled', title: `${item.name} was removed`, body: 'Your request was cancelled.', link: `/borrows/${b.id}` });
  }
  if (admin && item.owner_id && item.owner_id !== req.user.id) {
    await notify(item.owner_id, { circleId: item.circle_id, type: 'item_removed', title: `The admin removed your item "${item.name}"` });
  }
  res.json({ ok: true });
}));

itemsRouter.get('/items/:id/calendar', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  const rows = await db.all(`SELECT id, borrower_id, start_date, end_date, status FROM borrows WHERE item_id=? AND end_date>=?
                             AND status IN ('requested','countered','approved','active')`, item.id, addDays(today(), -40));
  const t = today();
  res.json({
    today: t,
    max_days: item.max_days,
    booked: rows.filter((b) => ['approved', 'active'].includes(b.status))
      .map((b) => ({ start: b.start_date, end: b.status === 'active' && b.end_date < t ? t : b.end_date, mine: b.borrower_id === req.user.id })),
    pending: rows.filter((b) => ['requested', 'countered'].includes(b.status))
      .map((b) => ({ start: b.start_date, end: b.end_date, mine: b.borrower_id === req.user.id })),
  });
}));

itemsRouter.get('/items/:id/qr', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  if (!(await isLender(item, req.user.id)) && !(await isAdmin(item.circle_id, req.user.id))) throw forbidden('Only the owner can print the QR code');
  const url = `${publicBaseUrl(req)}/i/${item.qr_token}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  const circle = await db.get('SELECT name FROM circles WHERE id=?', item.circle_id);
  res.json({ url, svg, name: item.name, circle: circle.name });
}));

// Scanning a QR: members get the item (and any handover/return waiting), strangers get nothing.
itemsRouter.get('/qr/:token', h(async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE qr_token=?', String(req.params.token));
  if (!item || item.status === 'removed'
    || !(await db.get('SELECT 1 AS x FROM circle_members WHERE circle_id=? AND user_id=?', item.circle_id, req.user.id))) {
    return res.json({ stranger: true });
  }
  const lender = await isLender(item, req.user.id);
  const pending = await db.get(`SELECT id, status FROM borrows WHERE item_id=? AND status IN ('approved','active')
                                AND (borrower_id=? OR ?=1) ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, start_date LIMIT 1`,
  item.id, req.user.id, lender ? 1 : 0);
  res.json({ itemId: item.id, borrowId: pending?.id || null, action: pending ? (pending.status === 'approved' ? 'handover' : 'return') : null });
}));

itemsRouter.post('/items/:id/waitlist', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  if (await isLender(item, req.user.id)) throw bad('This is your item');
  if (item.listing_type !== 'lend') throw bad('Giveaway items have no waitlist');
  await db.run('INSERT INTO waitlist(item_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING', item.id, req.user.id, now());
  res.json({ item: await itemDetail(item, req.user.id) });
}));

itemsRouter.delete('/items/:id/waitlist', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  await db.run('DELETE FROM waitlist WHERE item_id=? AND user_id=?', item.id, req.user.id);
  res.json({ item: await itemDetail(item, req.user.id) });
}));
