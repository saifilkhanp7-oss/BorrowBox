// Wanted board + skills & favours
import { Router } from 'express';
import db from '../db.js';
import { h, bad, now, str, optStr, int, bool, idParam, forbidden, notFound, today, isDate, addDays, prettyDate } from '../lib/util.js';
import { requireMember, isAdmin, itemForMember, isLender, userCards } from '../lib/access.js';
import { notify, notifyMany, systemMessage } from '../lib/notify.js';
import { recheckBadges } from '../lib/badges.js';
import { rangeClash } from './items.js';
import { threadMessages, postMessage } from './borrows.js';

export const communityRouter = Router();

// ================= WANTED =================
async function wantedOut(list, uid) {
  if (!list.length) return [];
  const ids = list.map((w) => w.id);
  const offers = await db.all(`SELECT o.id, o.wanted_id, o.offered_by, o.item_id, o.borrow_id, o.created_at, i.name AS item_name, b.status AS borrow_status
                               FROM wanted_offers o JOIN items i ON i.id=o.item_id JOIN borrows b ON b.id=o.borrow_id
                               WHERE o.wanted_id = ANY(?) ORDER BY o.id`, ids);
  const cards = await userCards([...list.map((w) => w.user_id), ...offers.map((o) => o.offered_by)]);
  return list.map((w) => ({
    ...w,
    urgent: !!w.urgent,
    user: cards.get(w.user_id),
    mine: w.user_id === uid,
    offers: offers.filter((o) => o.wanted_id === w.id).map((o) => ({ ...o, offered_by: cards.get(o.offered_by) })),
  }));
}
const oneWanted = async (id, uid) => (await wantedOut([await db.get('SELECT * FROM wanted_posts WHERE id=?', id)], uid))[0];

communityRouter.get('/circles/:id/wanted', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const status = req.query.status === 'closed' ? `status IN ('found','closed')` : `status='open'`;
  const rows = await db.all(`SELECT * FROM wanted_posts WHERE circle_id=? AND ${status} ORDER BY urgent DESC, created_at DESC LIMIT 100`, circleId);
  res.json({ wanted: await wantedOut(rows, req.user.id) });
}));

communityRouter.post('/circles/:id/wanted', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const title = str(req.body?.title, { min: 3, max: 80, field: 'What you need' });
  const details = optStr(req.body?.details, 400, 'Details');
  const neededBy = req.body?.needed_by ? req.body.needed_by : null;
  if (neededBy && (!isDate(neededBy) || neededBy < today())) throw bad('"Needed by" must be today or later');
  const urgent = bool(req.body?.urgent) ? 1 : 0;
  if (urgent) {
    const { n } = await db.get('SELECT COUNT(*) n FROM wanted_posts WHERE user_id=? AND urgent=1 AND created_at>?', req.user.id, now() - 86400000);
    if (n >= 2) throw bad('You can post at most 2 urgent requests per day. Post it as normal instead.');
  }
  const id = await db.insert('INSERT INTO wanted_posts(circle_id,user_id,title,details,needed_by,urgent,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
    circleId, req.user.id, title, details, neededBy, urgent, 'open', now());
  if (urgent) {
    const members = (await db.all('SELECT user_id FROM circle_members WHERE circle_id=? AND user_id<>?', circleId, req.user.id)).map((r) => r.user_id);
    await notifyMany(members, {
      circleId, type: 'urgent_wanted', title: `🚨 Urgent: ${req.user.name} needs ${title}`,
      body: neededBy ? `Needed by ${prettyDate(neededBy)}. Tap "I have this" if you can help.` : 'Tap "I have this" if you can help.',
      link: `/c/${circleId}/wanted`, email: 'urgent',
    });
  }
  res.json({ wanted: await oneWanted(id, req.user.id) });
}));

communityRouter.patch('/wanted/:id', h(async (req, res) => {
  const w = await db.get('SELECT * FROM wanted_posts WHERE id=?', idParam(req.params.id));
  if (!w) throw notFound();
  await requireMember(w.circle_id, req.user.id);
  if (w.user_id !== req.user.id && !(await isAdmin(w.circle_id, req.user.id))) throw forbidden();
  const status = req.body?.status;
  if (status && !['open', 'found', 'closed'].includes(status)) throw bad('Invalid status');
  const title = req.body?.title !== undefined ? str(req.body.title, { min: 3, max: 80, field: 'What you need' }) : w.title;
  const details = req.body?.details !== undefined ? optStr(req.body.details, 400, 'Details') : w.details;
  await db.run('UPDATE wanted_posts SET title=?, details=?, status=? WHERE id=?', title, details, status || w.status, w.id);
  res.json({ wanted: await oneWanted(w.id, req.user.id) });
}));

// "I have this": pick one of your items → becomes a borrow already approved by you.
communityRouter.post('/wanted/:id/offer', h(async (req, res) => {
  const w = await db.get('SELECT * FROM wanted_posts WHERE id=?', idParam(req.params.id));
  if (!w || w.status !== 'open') throw notFound('This request is closed');
  await requireMember(w.circle_id, req.user.id);
  if (w.user_id === req.user.id) throw bad('This is your own request');
  const item = await itemForMember(int(req.body?.item_id, { min: 1, field: 'Item' }), req.user.id);
  if (item.circle_id !== w.circle_id) throw bad('Pick an item from this circle');
  if (!(await isLender(item, req.user.id)) || item.listing_type !== 'lend') throw bad('Pick one of your own items');
  if (item.status !== 'available') throw bad('That item is not available right now');
  const days = int(req.body?.days ?? Math.min(3, item.max_days), { min: 1, max: item.max_days, field: 'Days' });
  const start = today();
  const end = addDays(start, days - 1);
  if (await rangeClash(item.id, start, end)) throw bad('That item is booked in those days');
  if (await db.get(`SELECT 1 AS x FROM borrows WHERE item_id=? AND borrower_id=? AND status IN ('requested','countered','approved','active')`, item.id, w.user_id)) {
    throw bad('They already have a request for this item');
  }
  const borrowId = await db.tx(async (t) => {
    const bid = await t.insert(`INSERT INTO borrows(item_id,circle_id,borrower_id,lender_id,start_date,end_date,original_end_date,message,status,wanted_id,created_at,updated_at)
                                VALUES(?,?,?,?,?,?,?,?,'approved',?,?,?)`,
    item.id, item.circle_id, w.user_id, req.user.id, start, end, end, `Offered for: ${w.title}`, w.id, now(), now());
    await t.run('INSERT INTO wanted_offers(wanted_id,offered_by,item_id,borrow_id,created_at) VALUES(?,?,?,?,?)', w.id, req.user.id, item.id, bid, now());
    await systemMessage('borrow', bid, `${req.user.name} has "${item.name}" for your request "${w.title}" and already approved ${prettyDate(start)} – ${prettyDate(end)}. Meet up and confirm the handover, or cancel if you don't need it.`, t);
    return bid;
  });
  await notify(w.user_id, { circleId: w.circle_id, type: 'wanted_offer', title: `${req.user.name} has ${item.name} for you!`, body: `For your request "${w.title}"`, link: `/borrows/${borrowId}`, email: 'borrow' });
  res.json({ borrowId, wanted: await oneWanted(w.id, req.user.id) });
}));

// ================= SKILLS & FAVOURS =================
async function skillsOut(list, uid) {
  if (!list.length) return [];
  const reqs = await db.all('SELECT * FROM skill_requests WHERE skill_id = ANY(?) ORDER BY id DESC', list.map((s) => s.id));
  const cards = await userCards([...list.map((s) => s.user_id), ...reqs.map((r) => r.requester_id)]);
  return list.map((s) => {
    const mine = reqs.filter((r) => r.skill_id === s.id);
    const owner = s.user_id === uid;
    return {
      ...s,
      user: cards.get(s.user_id),
      mine: owner,
      done_count: mine.filter((r) => r.status === 'done').length,
      requests: (owner ? mine : mine.filter((r) => r.requester_id === uid)).map((r) => ({ ...r, requester: cards.get(r.requester_id) })),
    };
  });
}

communityRouter.get('/circles/:id/skills', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const rows = await db.all(`SELECT * FROM skills WHERE circle_id=? AND (status='active' OR (status='paused' AND user_id=?)) ORDER BY created_at DESC`, circleId, req.user.id);
  res.json({ skills: await skillsOut(rows, req.user.id) });
}));

communityRouter.post('/circles/:id/skills', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const title = str(req.body?.title, { min: 3, max: 80, field: 'Title' });
  const description = optStr(req.body?.description, 400, 'Description');
  const availability = optStr(req.body?.availability_note, 120, 'When you are free');
  const id = await db.insert('INSERT INTO skills(circle_id,user_id,title,description,availability_note,status,created_at) VALUES(?,?,?,?,?,?,?)',
    circleId, req.user.id, title, description, availability, 'active', now());
  res.json({ skill: (await skillsOut([await db.get('SELECT * FROM skills WHERE id=?', id)], req.user.id))[0] });
}));

async function loadSkill(id, uid) {
  const s = await db.get('SELECT * FROM skills WHERE id=?', id);
  if (!s || s.status === 'removed') throw notFound('Not found');
  await requireMember(s.circle_id, uid);
  return s;
}

communityRouter.get('/skills/:id', h(async (req, res) => {
  const s = await loadSkill(idParam(req.params.id), req.user.id);
  res.json({ skill: (await skillsOut([s], req.user.id))[0] });
}));

communityRouter.patch('/skills/:id', h(async (req, res) => {
  const s = await loadSkill(idParam(req.params.id), req.user.id);
  if (s.user_id !== req.user.id) throw forbidden();
  const title = req.body?.title !== undefined ? str(req.body.title, { min: 3, max: 80, field: 'Title' }) : s.title;
  const description = req.body?.description !== undefined ? optStr(req.body.description, 400) : s.description;
  const availability = req.body?.availability_note !== undefined ? optStr(req.body.availability_note, 120) : s.availability_note;
  const status = ['active', 'paused'].includes(req.body?.status) ? req.body.status : s.status;
  await db.run('UPDATE skills SET title=?, description=?, availability_note=?, status=? WHERE id=?', title, description, availability, status, s.id);
  res.json({ skill: (await skillsOut([await db.get('SELECT * FROM skills WHERE id=?', s.id)], req.user.id))[0] });
}));

communityRouter.delete('/skills/:id', h(async (req, res) => {
  const s = await loadSkill(idParam(req.params.id), req.user.id);
  if (s.user_id !== req.user.id && !(await isAdmin(s.circle_id, req.user.id))) throw forbidden();
  await db.run(`UPDATE skills SET status='removed' WHERE id=?`, s.id);
  await db.run(`UPDATE skill_requests SET status='cancelled', updated_at=? WHERE skill_id=? AND status IN ('pending','accepted')`, now(), s.id);
  res.json({ ok: true });
}));

communityRouter.post('/skills/:id/requests', h(async (req, res) => {
  const s = await loadSkill(idParam(req.params.id), req.user.id);
  if (s.status !== 'active') throw bad('This is paused right now');
  if (s.user_id === req.user.id) throw bad('This is your own post');
  if (await db.get(`SELECT 1 AS x FROM skill_requests WHERE skill_id=? AND requester_id=? AND status IN ('pending','accepted')`, s.id, req.user.id)) {
    throw bad('You already asked. Check the chat.');
  }
  const message = optStr(req.body?.message, 300, 'Message');
  const rid = await db.insert('INSERT INTO skill_requests(skill_id,requester_id,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    s.id, req.user.id, message, 'pending', now(), now());
  await systemMessage('skill', rid, `${req.user.name} asked for help: ${s.title}`);
  if (message) await db.run('INSERT INTO messages(thread_type,thread_id,sender_id,body,created_at) VALUES(?,?,?,?,?)', 'skill', rid, req.user.id, message, now());
  await notify(s.user_id, { circleId: s.circle_id, type: 'skill_request', title: `${req.user.name} asked for "${s.title}"`, body: message, link: `/favours/${rid}`, email: 'borrow' });
  res.json({ requestId: rid });
}));

async function loadSkillRequest(id, uid) {
  const r = await db.get('SELECT * FROM skill_requests WHERE id=?', id);
  if (!r) throw notFound();
  const s = await db.get('SELECT * FROM skills WHERE id=?', r.skill_id);
  const role = r.requester_id === uid ? 'requester' : s.user_id === uid ? 'helper' : null;
  if (!role) throw notFound();
  return { r, s, role };
}
const chatOpenFor = (r) => ['pending', 'accepted'].includes(r.status) || (r.status === 'done' && now() - r.updated_at < 3 * 86400000);
async function reqOut(r, s, role, uid) {
  const cards = await userCards([s.user_id, r.requester_id]);
  const thanked = await db.get(`SELECT 1 AS x FROM thank_you_notes WHERE from_user=? AND thread_type='skill' AND thread_id=?`, uid, r.id);
  return {
    ...r, role,
    skill: { id: s.id, title: s.title, description: s.description, availability_note: s.availability_note, circle_id: s.circle_id },
    helper: cards.get(s.user_id), requester: cards.get(r.requester_id),
    chat_open: chatOpenFor(r),
    thanked: !!thanked,
  };
}

communityRouter.get('/skill-requests/:id', h(async (req, res) => {
  const { r, s, role } = await loadSkillRequest(idParam(req.params.id), req.user.id);
  res.json({ request: await reqOut(r, s, role, req.user.id) });
}));

const STEPS = {
  accept: { who: 'helper', from: ['pending'], to: 'accepted', msg: (n) => `${n} said yes! Plan the details here.` },
  decline: { who: 'helper', from: ['pending'], to: 'declined', msg: (n) => `${n} can't help this time.` },
  done: { who: 'any', from: ['accepted'], to: 'done', msg: (n) => `${n} marked this as done. 🎉` },
  cancel: { who: 'requester', from: ['pending', 'accepted'], to: 'cancelled', msg: (n) => `${n} cancelled the request.` },
};
for (const [action, step] of Object.entries(STEPS)) {
  communityRouter.post(`/skill-requests/:id/${action}`, h(async (req, res) => {
    const { r, s, role } = await loadSkillRequest(idParam(req.params.id), req.user.id);
    if (step.who !== 'any' && step.who !== role) throw forbidden();
    if (!step.from.includes(r.status)) throw bad('This cannot be done now');
    await db.run('UPDATE skill_requests SET status=?, updated_at=? WHERE id=?', step.to, now(), r.id);
    await systemMessage('skill', r.id, step.msg(req.user.name));
    const other = role === 'helper' ? r.requester_id : s.user_id;
    await notify(other, { circleId: s.circle_id, type: 'skill_update', title: `"${s.title}": ${step.msg(req.user.name)}`, link: `/favours/${r.id}`, email: action === 'accept' ? 'borrow' : null });
    if (step.to === 'done') await recheckBadges(s.user_id);
    const fresh = await db.get('SELECT * FROM skill_requests WHERE id=?', r.id);
    res.json({ request: await reqOut(fresh, s, role, req.user.id) });
  }));
}

communityRouter.get('/skill-requests/:id/messages', h(async (req, res) => {
  const { r } = await loadSkillRequest(idParam(req.params.id), req.user.id);
  res.json({ messages: await threadMessages('skill', r.id, req.query.after) });
}));
communityRouter.post('/skill-requests/:id/messages', h(async (req, res) => {
  const { r } = await loadSkillRequest(idParam(req.params.id), req.user.id);
  if (!chatOpenFor(r)) throw bad('This chat is closed');
  await postMessage('skill', r.id, req.user.id, req.body?.body);
  res.json({ messages: await threadMessages('skill', r.id, req.body?.after) });
}));
communityRouter.post('/skill-requests/:id/thanks', h(async (req, res) => {
  const { r, s, role } = await loadSkillRequest(idParam(req.params.id), req.user.id);
  if (role !== 'requester' || r.status !== 'done') throw bad('You can say thanks after the favour is done');
  const message = str(req.body?.message, { min: 2, max: 200, field: 'Note' });
  await db.run(`INSERT INTO thank_you_notes(from_user,to_user,thread_type,thread_id,message,created_at) VALUES(?,?,'skill',?,?,?) ON CONFLICT DO NOTHING`,
    req.user.id, s.user_id, r.id, message, now());
  await notify(s.user_id, { circleId: s.circle_id, type: 'thanks', title: `${req.user.name} left you a thank-you note 💌`, body: message, link: `/u/${s.user_id}` });
  res.json({ request: await reqOut(r, s, role, req.user.id) });
}));
