// Report a problem: lost, damaged or not returned. Both sides see the same record (condition at sharing,
// at handover and at return), compare against the owner's video, agree on a fix, then it is resolved.
import { Router } from 'express';
import db from '../db.js';
import { h, bad, now, optStr, idParam, forbidden, notFound, today } from '../lib/util.js';
import { requireAdmin, isAdmin, itemLenders, userCards } from '../lib/access.js';
import { notifyMany, notify, systemMessage } from '../lib/notify.js';
import { loadBorrow } from './borrows.js';

export const reportsRouter = Router();

const TYPES = { lost: 'Lost', damaged: 'Damaged', not_returned: 'Not returned' };
const FIXES = { repair: 'Repair', replace: 'Replace', forget: 'Forget it' };

async function others(b, item, uid) {
  const ids = new Set([b.borrower_id, ...(await itemLenders(item))]);
  ids.delete(uid);
  return [...ids];
}

async function loadReport(id, uid) {
  const r = await db.get('SELECT * FROM reports WHERE id=?', id);
  if (!r) throw notFound('Report not found');
  const { b, item, role } = await loadBorrow(r.borrow_id, uid);
  return { r, b, item, role };
}

async function reportOut(r, b, item, role, uid) {
  const fixes = await db.all('SELECT * FROM report_fixes WHERE report_id=? ORDER BY id', r.id);
  const cards = await userCards([r.reported_by, b.borrower_id, b.lender_id || item.owner_id, ...fixes.map((f) => f.proposed_by)]);
  const admin = await isAdmin(b.circle_id, uid);
  const fixesOut = fixes.map((f) => ({
    ...f, fix_label: FIXES[f.fix], proposed_by_user: cards.get(f.proposed_by),
    can_answer: f.status === 'pending' && f.proposed_by !== uid && role !== 'admin',
  }));
  return {
    ...r,
    type_label: TYPES[r.type],
    agreed_fix_label: r.agreed_fix ? FIXES[r.agreed_fix] : null,
    role,
    reported_by_user: cards.get(r.reported_by),
    borrow: {
      id: b.id, start_date: b.start_date, end_date: b.end_date, status: b.status,
      handover_at: b.handover_lender_at, handover_video: !!b.handover_video, handover_checked: !!b.handover_checked,
      handover_condition: b.handover_condition, handover_note: b.handover_note,
      returned_at: b.return_lender_at, return_condition: b.return_condition, return_note: b.return_note,
    },
    item: { id: item.id, name: item.name, is_shared: !!item.is_shared, condition: item.condition, condition_notes: item.condition_notes },
    borrower: cards.get(b.borrower_id),
    lender: cards.get(b.lender_id || item.owner_id),
    fixes: fixesOut,
    can_propose: r.status === 'open' && role !== 'admin' && !fixes.some((f) => f.status === 'pending'),
    can_resolve: r.status !== 'resolved' && ((role === 'lender' && r.status === 'agreed') || admin),
  };
}

reportsRouter.post('/borrows/:id/reports', h(async (req, res) => {
  const { b, item, role } = await loadBorrow(idParam(req.params.id), req.user.id);
  if (role === 'admin') throw forbidden('Only the two people in this borrow can report a problem');
  if (!['active', 'returned'].includes(b.status)) throw bad('You can report a problem only after the handover');
  const type = req.body?.type;
  if (!TYPES[type]) throw bad('Choose what went wrong');
  if (type === 'not_returned') {
    if (role !== 'lender') throw forbidden('Only the owner can report "not returned"');
    if (!(b.status === 'active' && b.end_date < today())) throw bad('"Not returned" can be reported only after the due date has passed');
  }
  if (await db.get(`SELECT 1 AS x FROM reports WHERE borrow_id=? AND status<>'resolved'`, b.id)) throw bad('There is already an open report for this borrow');
  const description = optStr(req.body?.description, 600, 'Description');
  const id = await db.insert('INSERT INTO reports(borrow_id,circle_id,reported_by,type,description,status,created_at) VALUES(?,?,?,?,?,?,?)',
    b.id, b.circle_id, req.user.id, type, description, 'open', now());
  await systemMessage('borrow', b.id, `${req.user.name} reported a problem: ${TYPES[type]}. Compare with the video taken before the handover, then agree on a fix here.`);
  await notifyMany(await others(b, item, req.user.id), {
    circleId: b.circle_id, type: 'report', title: `Problem reported for ${item.name}: ${TYPES[type]}`, body: description, link: `/reports/${id}`, email: 'borrow',
  });
  res.json({ reportId: id });
}));

reportsRouter.get('/reports/:id', h(async (req, res) => {
  const { r, b, item, role } = await loadReport(idParam(req.params.id), req.user.id);
  res.json({ report: await reportOut(r, b, item, role, req.user.id) });
}));

reportsRouter.post('/reports/:id/fixes', h(async (req, res) => {
  const { r, b, item, role } = await loadReport(idParam(req.params.id), req.user.id);
  if (role === 'admin') throw forbidden();
  if (r.status !== 'open') throw bad('A fix is already agreed');
  if (!FIXES[req.body?.fix]) throw bad('Choose Repair, Replace or Forget it');
  if (await db.get(`SELECT 1 AS x FROM report_fixes WHERE report_id=? AND status='pending'`, r.id)) throw bad('Wait for an answer to the last suggestion');
  const note = optStr(req.body?.note, 300, 'Note');
  await db.run('INSERT INTO report_fixes(report_id,proposed_by,fix,note,status,created_at) VALUES(?,?,?,?,?,?)', r.id, req.user.id, req.body.fix, note, 'pending', now());
  await systemMessage('borrow', b.id, `${req.user.name} suggested a fix: ${FIXES[req.body.fix]}${note ? ` – ${note}` : ''}.`);
  await notifyMany(await others(b, item, req.user.id), { circleId: b.circle_id, type: 'report', title: `Fix suggested for ${item.name}: ${FIXES[req.body.fix]}`, body: note, link: `/reports/${r.id}` });
  res.json({ report: await reportOut(await db.get('SELECT * FROM reports WHERE id=?', r.id), b, item, role, req.user.id) });
}));

function answer(accept) {
  return h(async (req, res) => {
    const f = await db.get('SELECT * FROM report_fixes WHERE id=?', idParam(req.params.id));
    if (!f) throw notFound();
    const { r, b, item, role } = await loadReport(f.report_id, req.user.id);
    if (role === 'admin' || f.proposed_by === req.user.id) throw forbidden('The other person has to answer this');
    if (f.status !== 'pending' || r.status !== 'open') throw bad('Already answered');
    await db.run('UPDATE report_fixes SET status=? WHERE id=?', accept ? 'accepted' : 'rejected', f.id);
    if (accept) await db.run(`UPDATE reports SET status='agreed', agreed_fix=?, agreed_note=? WHERE id=?`, f.fix, f.note, r.id);
    await systemMessage('borrow', b.id, accept ? `Both agreed: ${FIXES[f.fix]}. The owner marks it resolved when it's done.` : `${req.user.name} did not agree to "${FIXES[f.fix]}". Suggest another fix.`);
    await notify(f.proposed_by, { circleId: b.circle_id, type: 'report', title: accept ? `Fix agreed for ${item.name}: ${FIXES[f.fix]}` : `Fix not agreed for ${item.name}`, link: `/reports/${r.id}` });
    res.json({ report: await reportOut(await db.get('SELECT * FROM reports WHERE id=?', r.id), b, item, role, req.user.id) });
  });
}
reportsRouter.post('/report-fixes/:id/accept', answer(true));
reportsRouter.post('/report-fixes/:id/reject', answer(false));

reportsRouter.post('/reports/:id/resolve', h(async (req, res) => {
  const { r, b, item, role } = await loadReport(idParam(req.params.id), req.user.id);
  const out = await reportOut(r, b, item, role, req.user.id);
  if (!out.can_resolve) throw forbidden(role === 'lender' ? 'Agree on a fix first' : 'Only the owner (after a fix is agreed) or the circle admin can resolve this');
  const note = optStr(req.body?.note, 300, 'Note');
  await db.run(`UPDATE reports SET status='resolved', resolved_at=?, resolved_by=?, agreed_note=COALESCE(?, agreed_note) WHERE id=?`, now(), req.user.id, note, r.id);
  // a "lost" or "not returned" item that is settled can't come back, so close the borrow and hide the item
  if (b.status === 'active' && ['lost', 'not_returned'].includes(r.type)) {
    await db.run(`UPDATE borrows SET status='returned', return_lender_at=?, return_condition='damaged', returned_on_time=0, updated_at=? WHERE id=?`, now(), now(), b.id);
    await db.run(`UPDATE items SET status='paused', needs_review=1, updated_at=? WHERE id=?`, now(), item.id);
  }
  await systemMessage('borrow', b.id, `Problem marked as resolved by ${req.user.name}. ✅`);
  await notifyMany(await others(b, item, req.user.id), { circleId: b.circle_id, type: 'report', title: `Problem with ${item.name} is resolved`, link: `/reports/${r.id}` });
  const fb = await db.get('SELECT * FROM borrows WHERE id=?', b.id);
  res.json({ report: await reportOut(await db.get('SELECT * FROM reports WHERE id=?', r.id), fb, item, role, req.user.id) });
}));

reportsRouter.get('/circles/:id/reports', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireAdmin(circleId, req.user.id);
  const rows = await db.all(`SELECT r.*, i.name AS item_name, b.borrower_id FROM reports r JOIN borrows b ON b.id=r.borrow_id JOIN items i ON i.id=b.item_id
                             WHERE r.circle_id=? ORDER BY CASE r.status WHEN 'resolved' THEN 1 ELSE 0 END, r.created_at DESC LIMIT 100`, circleId);
  const cards = await userCards(rows.flatMap((r) => [r.reported_by, r.borrower_id]));
  res.json({ reports: rows.map((r) => ({ ...r, type_label: TYPES[r.type], reported_by_user: cards.get(r.reported_by), borrower: cards.get(r.borrower_id) })) });
}));
