import { Router } from 'express';
import db from '../db.js';
import { h, bad, now, optStr, str, idParam, forbidden, notFound, today, isDate, addDays, prettyDate, bool } from '../lib/util.js';
import {
  itemForMember, isLender, itemLenders, borrowRole, userCard, hasBadge, membership,
} from '../lib/access.js';
import { notify, notifyMany, systemMessage } from '../lib/notify.js';
import { recheckBadges } from '../lib/badges.js';
import { itemSummary, rangeClash, checkDates, activeBorrowOf, VIDEO_MSG, CHECK_MSG } from './items.js';

export const borrowsRouter = Router();

const OPEN = ['requested', 'countered', 'approved', 'active'];

export async function loadBorrow(id, userId) {
  const b = await db.get('SELECT * FROM borrows WHERE id=?', id);
  if (!b) throw notFound('Borrow not found');
  const item = await db.get('SELECT * FROM items WHERE id=?', b.item_id);
  const role = await borrowRole(b, item, userId);
  return { b, item, role };
}

const range = (s, e) => (s === e ? prettyDate(s) : `${prettyDate(s)} – ${prettyDate(e)}`);
const link = (b) => `/borrows/${b.id}`;
const tellLenders = async (item, b, payload) => notifyMany(await itemLenders(item), { circleId: item.circle_id, link: link(b), ...payload });
const tellBorrower = (item, b, payload) => notify(b.borrower_id, { circleId: item.circle_id, link: link(b), ...payload });

export async function chatOpen(b) {
  if (OPEN.includes(b.status)) return true;
  if (b.status !== 'returned') return false;
  const openReport = await db.get(`SELECT 1 AS x FROM reports WHERE borrow_id=? AND status<>'resolved'`, b.id);
  return !!openReport || now() - (b.return_lender_at || b.updated_at) < 3 * 86400000;
}

export async function borrowOut(b, item, role, userId) {
  const t = today();
  const [sum, borrower, lender, extensions, reports, thanked, chat, circle] = await Promise.all([
    itemSummary(item),
    userCard(b.borrower_id),
    b.lender_id ? userCard(b.lender_id) : (item.is_shared ? null : userCard(item.owner_id)),
    db.all('SELECT * FROM extensions WHERE borrow_id=? ORDER BY id DESC', b.id),
    db.all('SELECT id, type, status, created_at FROM reports WHERE borrow_id=? ORDER BY id DESC', b.id),
    db.get(`SELECT 1 AS x FROM thank_you_notes WHERE from_user=? AND thread_type='borrow' AND thread_id=?`, userId, b.id),
    chatOpen(b),
    item.is_shared ? db.get('SELECT name FROM circles WHERE id=?', item.circle_id) : null,
  ]);
  return {
    ...b,
    overdue: b.status === 'active' && b.end_date < t,
    due_today: b.status === 'active' && b.end_date === t,
    role,
    item: { ...sum, rules: item.rules },
    borrower,
    lender,
    owner_label: circle?.name || null,
    extensions,
    reports,
    thanked: !!thanked,
    chat_open: chat,
    video_msg: VIDEO_MSG,
    check_msg: CHECK_MSG,
    today: t,
  };
}

async function reload(b, item, role, uid) {
  const fresh = await db.get('SELECT * FROM borrows WHERE id=?', b.id);
  return borrowOut(fresh, await db.get('SELECT * FROM items WHERE id=?', item.id), role, uid);
}
function mustLender(role, item) {
  if (role !== 'lender') throw forbidden(item.is_shared ? 'Only the circle admin manages shared items' : 'Only the owner can do this');
}

// ---------- request ----------
borrowsRouter.post('/items/:id/borrows', h(async (req, res) => {
  const item = await itemForMember(idParam(req.params.id), req.user.id);
  const uid = req.user.id;
  if (item.listing_type !== 'lend') throw bad('This item is a giveaway, not for borrowing');
  if (await isLender(item, uid)) throw bad('You cannot borrow your own item');
  if (item.status === 'paused') throw bad('The owner is not sharing this item right now');
  if (item.trusted_only && !(await hasBadge(uid, 'on_time'))) throw forbidden('The owner lends this item only to people with the On-Time Returner badge.');
  const { start_date: start, end_date: end } = req.body || {};
  if (!isDate(start) || !isDate(end)) throw bad('Pick valid dates');
  checkDates(item, start, end);
  if (await rangeClash(item.id, start, end)) throw bad('Those dates are already booked. Pick other dates or join the waitlist.');
  const dup = await db.get(`SELECT 1 AS x FROM borrows WHERE item_id=? AND borrower_id=? AND status IN ('requested','countered','approved','active')`, item.id, uid);
  if (dup) throw bad('You already have an open request for this item');
  const message = optStr(req.body?.message, 300, 'Message');
  const id = await db.insert(`INSERT INTO borrows(item_id,circle_id,borrower_id,lender_id,start_date,end_date,original_end_date,message,status,created_at,updated_at)
                              VALUES(?,?,?,?,?,?,?,?,'requested',?,?)`,
  item.id, item.circle_id, uid, item.is_shared ? null : item.owner_id, start, end, end, message, now(), now());
  const b = await db.get('SELECT * FROM borrows WHERE id=?', id);
  await systemMessage('borrow', b.id, `${req.user.name} asked to borrow ${item.name} for ${range(start, end)}.`);
  if (message) await db.run('INSERT INTO messages(thread_type,thread_id,sender_id,body,created_at) VALUES(?,?,?,?,?)', 'borrow', b.id, uid, message, now());
  await tellLenders(item, b, { type: 'borrow_request', title: `${req.user.name} wants to borrow ${item.name}`, body: range(start, end), email: 'borrow' });
  res.json({ borrow: await borrowOut(b, item, 'borrower', uid) });
}));

borrowsRouter.get('/borrows/:id', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  res.json({ borrow: await borrowOut(b, item, role, req.user.id) });
}));

// ---------- owner answers ----------
borrowsRouter.post('/borrows/:id/approve', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  mustLender(role, item);
  if (b.status !== 'requested') throw bad('This request is not waiting for an answer');
  if (b.start_date < today()) throw bad('The start date has passed. Suggest new dates instead.');
  if (await rangeClash(item.id, b.start_date, b.end_date, b.id)) throw bad('These dates now clash with another booking. Suggest other dates.');
  await db.run(`UPDATE borrows SET status='approved', lender_id=?, updated_at=? WHERE id=?`, req.user.id, now(), b.id);
  await systemMessage('borrow', b.id, `${req.user.name} approved ${range(b.start_date, b.end_date)}. Meet up and confirm the handover in the app.`);
  await tellBorrower(item, b, { type: 'borrow_approved', title: `Approved: you can borrow ${item.name}`, body: range(b.start_date, b.end_date), email: 'borrow' });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

borrowsRouter.post('/borrows/:id/decline', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  mustLender(role, item);
  if (!['requested', 'countered'].includes(b.status)) throw bad('This request cannot be declined now');
  const reason = optStr(req.body?.reason, 200, 'Reason');
  await db.run(`UPDATE borrows SET status='declined', decline_reason=?, lender_id=?, updated_at=? WHERE id=?`, reason, req.user.id, now(), b.id);
  await systemMessage('borrow', b.id, `Request declined${reason ? `: ${reason}` : '.'}`);
  await tellBorrower(item, b, { type: 'borrow_declined', title: `Request for ${item.name} was declined`, body: reason, email: 'borrow' });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

borrowsRouter.post('/borrows/:id/counter', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  mustLender(role, item);
  if (b.status !== 'requested') throw bad('You can suggest dates only for a new request');
  const { start_date: s, end_date: e } = req.body || {};
  if (!isDate(s) || !isDate(e)) throw bad('Pick valid dates');
  checkDates(item, s, e);
  if (await rangeClash(item.id, s, e, b.id)) throw bad('Those dates are already booked');
  await db.run(`UPDATE borrows SET status='countered', counter_start=?, counter_end=?, lender_id=?, updated_at=? WHERE id=?`, s, e, req.user.id, now(), b.id);
  await systemMessage('borrow', b.id, `${req.user.name} suggested other dates: ${range(s, e)}.`);
  await tellBorrower(item, b, { type: 'borrow_counter', title: `New dates suggested for ${item.name}`, body: range(s, e), email: 'borrow' });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

borrowsRouter.post('/borrows/:id/accept-counter', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (role !== 'borrower') throw forbidden();
  if (b.status !== 'countered') throw bad('There are no suggested dates to accept');
  if (b.counter_start < today()) throw bad('The suggested start date has passed. Cancel and send a new request.');
  if (await rangeClash(item.id, b.counter_start, b.counter_end, b.id)) throw bad('Those dates got booked by someone else. Cancel and send a new request.');
  await db.run(`UPDATE borrows SET status='approved', start_date=counter_start, end_date=counter_end, original_end_date=counter_end, updated_at=? WHERE id=?`, now(), b.id);
  await systemMessage('borrow', b.id, `${req.user.name} accepted ${range(b.counter_start, b.counter_end)}. Approved!`);
  await tellLenders(item, b, { type: 'borrow_approved', title: `${req.user.name} accepted your dates for ${item.name}`, body: range(b.counter_start, b.counter_end), email: 'borrow' });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

borrowsRouter.post('/borrows/:id/cancel', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (!['requested', 'countered', 'approved'].includes(b.status)) throw bad('This can no longer be cancelled');
  if (role === 'admin') throw forbidden();
  const reason = optStr(req.body?.reason, 200, 'Reason');
  await db.run(`UPDATE borrows SET status='cancelled', decline_reason=?, updated_at=? WHERE id=?`, reason, now(), b.id);
  await systemMessage('borrow', b.id, `${req.user.name} cancelled${reason ? `: ${reason}` : '.'}`);
  const payload = { type: 'borrow_cancelled', title: `${item.name}: ${req.user.name} cancelled`, body: reason, email: 'borrow' };
  if (role === 'borrower') await tellLenders(item, b, payload); else await tellBorrower(item, b, payload);
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

// ---------- handover ----------
// Owner must confirm they took a video of the item; borrower must confirm they checked it.
borrowsRouter.post('/borrows/:id/handover', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  const uid = req.user.id;
  if (b.status !== 'approved') throw bad('This borrow is not waiting for a handover');
  const other = await activeBorrowOf(item.id);
  if (other && other.id !== b.id) throw bad('The item has not come back from the last borrower yet');
  if (role === 'borrower') {
    if (b.handover_borrower_at) throw bad('You already confirmed');
    if (!bool(req.body?.checked)) throw bad(`Please check the item first. ${CHECK_MSG}`);
    await db.run('UPDATE borrows SET handover_borrower_at=?, handover_checked=1, updated_at=? WHERE id=?', now(), now(), b.id);
    await systemMessage('borrow', b.id, `${req.user.name} checked the item and confirmed they received it.`);
  } else if (role === 'lender') {
    if (b.handover_lender_at) throw bad('You already confirmed');
    if (!bool(req.body?.video_taken)) throw bad(`Please take a video of the item first. ${VIDEO_MSG}`);
    const note = optStr(req.body?.note, 300, 'Note');
    const cond = `${item.condition}${item.condition_notes ? ` – ${item.condition_notes}` : ''}`;
    await db.run('UPDATE borrows SET handover_lender_at=?, handover_video=1, handover_condition=?, handover_note=?, lender_id=?, updated_at=? WHERE id=?',
      now(), cond, note, uid, now(), b.id);
    await systemMessage('borrow', b.id, `${req.user.name} took a video of the item and confirmed the handover.${note ? ` Note: ${note}` : ''}`);
  } else throw forbidden();

  const fresh = await db.get('SELECT * FROM borrows WHERE id=?', b.id);
  if (fresh.handover_borrower_at && fresh.handover_lender_at) {
    await db.tx(async (t) => {
      await t.run(`UPDATE borrows SET status='active', updated_at=? WHERE id=?`, now(), b.id);
      await t.run(`UPDATE items SET status='borrowed', updated_at=? WHERE id=?`, now(), item.id);
      await t.run('DELETE FROM waitlist WHERE item_id=? AND user_id=?', item.id, b.borrower_id);
      await t.run('UPDATE waitlist SET notified_at=NULL WHERE item_id=?', item.id);
    });
    await systemMessage('borrow', b.id, `Handover done. Due back on ${prettyDate(fresh.end_date)}.`);
    await tellBorrower(item, b, { type: 'handover', title: `You have ${item.name} now`, body: `Please return it by ${prettyDate(fresh.end_date)}.` });
    await tellLenders(item, b, { type: 'handover', title: `${item.name} handed over`, body: `Due back on ${prettyDate(fresh.end_date)}.` });
    await recheckBadges(fresh.lender_id);
    for (const o of await db.all('SELECT offered_by FROM wanted_offers WHERE borrow_id=?', b.id)) await recheckBadges(o.offered_by);
  } else if (role === 'lender') {
    await tellBorrower(item, b, { type: 'handover', title: `Check ${item.name} and confirm you received it` });
  } else {
    await tellLenders(item, b, { type: 'handover', title: `${req.user.name} says they got ${item.name}`, body: 'Take a video of the item and confirm the handover.' });
  }
  res.json({ borrow: await reload(b, item, role, uid) });
}));

// ---------- return ----------
// The borrower's "I gave it back" is a signal; the return is complete when the owner confirms they got it.
borrowsRouter.post('/borrows/:id/return', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  const uid = req.user.id;
  if (b.status !== 'active') throw bad('This item is not out right now');
  if (role === 'borrower') {
    if (b.return_borrower_at) throw bad('You already confirmed');
    await db.run('UPDATE borrows SET return_borrower_at=?, updated_at=? WHERE id=?', now(), now(), b.id);
    await systemMessage('borrow', b.id, `${req.user.name} says they returned the item.`);
    await tellLenders(item, b, { type: 'return', title: `${req.user.name} returned ${item.name}`, body: 'Check it against your video and confirm the return.', email: 'borrow' });
    return res.json({ borrow: await reload(b, item, role, uid) });
  }
  if (role !== 'lender') throw forbidden();
  const condition = req.body?.condition;
  if (!['fine', 'damaged'].includes(condition)) throw bad('Choose "Came back fine" or "Came back damaged"');
  const note = optStr(req.body?.note, 300, 'Note');
  const returnedDay = today(b.return_borrower_at || now());
  const onTime = returnedDay <= b.end_date ? 1 : 0;
  const ownerStillMember = item.is_shared || (await membership(item.circle_id, item.owner_id));
  await db.tx(async (t) => {
    await t.run(`UPDATE borrows SET status='returned', return_lender_at=?, return_borrower_at=COALESCE(return_borrower_at, ?),
                 return_condition=?, return_note=?, returned_on_time=?, updated_at=? WHERE id=?`, now(), now(), condition, note, onTime, now(), b.id);
    // not available again until the owner updates the condition and shares it again
    await t.run('UPDATE items SET status=?, needs_review=?, updated_at=? WHERE id=?',
      ownerStillMember ? 'paused' : 'removed', ownerStillMember ? 1 : 0, now(), item.id);
  });
  await systemMessage('borrow', b.id, `Return confirmed: came back ${condition === 'fine' ? 'fine 👍' : 'damaged'}. ${onTime ? 'Returned on time.' : 'Returned late.'}${note ? ` Note: ${note}` : ''}`);
  await tellBorrower(item, b, {
    type: 'returned', title: `Return of ${item.name} confirmed`,
    body: condition === 'fine' ? 'It came back fine. Thanks for borrowing responsibly!' : 'The owner marked it as damaged. You can talk about it in the chat.',
    email: 'borrow',
  });
  await recheckBadges(b.borrower_id);
  if (item.owner_id) await recheckBadges(item.owner_id);
  res.json({ borrow: await reload(b, item, role, uid), suggest_report: condition === 'damaged', reshare_item_id: ownerStillMember ? item.id : null });
}));

// ---------- extensions ----------
borrowsRouter.post('/borrows/:id/extensions', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (role !== 'borrower') throw forbidden();
  if (b.status !== 'active') throw bad('You can ask for more time only while you have the item');
  if (await db.get(`SELECT 1 AS x FROM extensions WHERE borrow_id=? AND status='pending'`, b.id)) throw bad('You already asked. Wait for the owner to answer.');
  const date = req.body?.requested_end_date;
  if (!isDate(date)) throw bad('Pick a new end date');
  if (date <= b.end_date) throw bad('The new date must be after the current due date');
  if (date < today()) throw bad('The new date cannot be in the past');
  if (date > addDays(b.end_date, item.max_days)) throw bad(`You can extend by at most ${item.max_days} day(s) at a time`);
  if (await rangeClash(item.id, addDays(b.end_date, 1), date, b.id)) throw bad('Someone else has booked the item for those days');
  const reason = optStr(req.body?.reason, 200, 'Reason');
  await db.run('INSERT INTO extensions(borrow_id,requested_end_date,reason,status,created_at) VALUES(?,?,?,?,?)', b.id, date, reason, 'pending', now());
  await systemMessage('borrow', b.id, `${req.user.name} asked to keep it until ${prettyDate(date)}${reason ? ` (${reason})` : ''}.`);
  await tellLenders(item, b, { type: 'extension', title: `${req.user.name} wants to keep ${item.name} longer`, body: `Until ${prettyDate(date)}`, email: 'borrow' });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));

function decideExtension(approve) {
  return h(async (req, res) => {
    const ext = await db.get('SELECT * FROM extensions WHERE id=?', idParam(req.params.id));
    if (!ext) throw notFound();
    const { b, item, role } = await loadBorrow(ext.borrow_id, req.user.id);
    mustLender(role, item);
    if (ext.status !== 'pending') throw bad('Already answered');
    if (approve) {
      if (b.status !== 'active') throw bad('The item is no longer out');
      if (await rangeClash(item.id, addDays(b.end_date, 1), ext.requested_end_date, b.id)) throw bad('Those days are now booked by someone else');
      await db.run(`UPDATE borrows SET end_date=?, remind_before_sent=0, remind_due_sent=0, overdue_reminders=0, last_overdue_reminder=NULL, updated_at=? WHERE id=?`,
        ext.requested_end_date, now(), b.id);
    }
    await db.run('UPDATE extensions SET status=?, decided_at=? WHERE id=?', approve ? 'approved' : 'rejected', now(), ext.id);
    await systemMessage('borrow', b.id, approve ? `Extension approved. New due date: ${prettyDate(ext.requested_end_date)}.` : 'Extension not approved. Please return on the original date.');
    await tellBorrower(item, b, { type: 'extension', title: approve ? `You can keep ${item.name} until ${prettyDate(ext.requested_end_date)}` : `Extension for ${item.name} not approved`, email: 'borrow' });
    res.json({ borrow: await reload(b, item, role, req.user.id) });
  });
}
borrowsRouter.post('/extensions/:id/approve', decideExtension(true));
borrowsRouter.post('/extensions/:id/reject', decideExtension(false));

// ---------- chat ----------
export function threadMessages(type, id, after = 0) {
  return db.all(`SELECT m.id, m.sender_id, m.body, m.is_system, m.created_at, u.name AS sender_name FROM messages m
                 LEFT JOIN users u ON u.id=m.sender_id WHERE m.thread_type=? AND m.thread_id=? AND m.id>? ORDER BY m.id LIMIT 500`,
  type, id, Number(after) || 0);
}
export async function postMessage(type, id, userId, body) {
  const text = str(body, { min: 1, max: 1000, field: 'Message' });
  await db.run('INSERT INTO messages(thread_type,thread_id,sender_id,body,created_at) VALUES(?,?,?,?,?)', type, id, userId, text, now());
}

borrowsRouter.get('/borrows/:id/messages', h(async (req, res) => {
  const { b } = await loadBorrow(idParam(req.params.id), req.user.id);
  res.json({ messages: await threadMessages('borrow', b.id, req.query.after), open: await chatOpen(b) });
}));

borrowsRouter.post('/borrows/:id/messages', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (!(await chatOpen(b))) throw bad('This chat is closed');
  await postMessage('borrow', b.id, req.user.id, req.body?.body);
  // one notification per 10 minutes per sender, so a chat doesn't spam the bell
  const recent = await db.get(`SELECT 1 AS x FROM notifications WHERE type='message' AND link=? AND created_at>? AND body LIKE ?`,
    link(b), now() - 10 * 60 * 1000, `${req.user.name}:%`);
  if (!recent) {
    const payload = { type: 'message', title: `${req.user.name} sent a message about ${item.name}`, body: `${req.user.name}: ${String(req.body.body).slice(0, 80)}` };
    if (role === 'borrower') await tellLenders(item, b, payload); else await tellBorrower(item, b, payload);
  }
  res.json({ messages: await threadMessages('borrow', b.id, req.body?.after) });
}));

// ---------- thank-you note ----------
borrowsRouter.post('/borrows/:id/thanks', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (role !== 'borrower') throw forbidden();
  if (b.status !== 'returned') throw bad('You can say thanks after returning the item');
  const message = str(req.body?.message, { min: 2, max: 200, field: 'Note' });
  const to = item.is_shared ? b.lender_id : item.owner_id;
  if (!to) throw bad('No one to thank');
  await db.run(`INSERT INTO thank_you_notes(from_user,to_user,thread_type,thread_id,message,created_at) VALUES(?,?,'borrow',?,?,?) ON CONFLICT DO NOTHING`,
    req.user.id, to, b.id, message, now());
  await notify(to, { circleId: item.circle_id, type: 'thanks', title: `${req.user.name} left you a thank-you note 💌`, body: message, link: `/u/${to}` });
  res.json({ borrow: await reload(b, item, role, req.user.id) });
}));
