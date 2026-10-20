// Background jobs. Every job is safe to run again and from several places at once.
// They run from three places:
//   1. Vercel Cron, once a day (vercel.json) – also keeps the free Supabase project awake.
//   2. "Lazy" runs: at most every 5 minutes, triggered by normal app use (no setup needed).
//   3. Locally: every minute (server/local.js).
import db from '../db.js';
import { now, today, addDays, hourNow, daysBetween, prettyDate } from './util.js';
import { notify, notifyMany, systemMessage, background } from './notify.js';
import { recheckAllBadges } from './badges.js';
import { closeDueAuctions } from '../routes/giveaways.js';

const lendersOf = async (item) => (item.is_shared
  ? (await db.all(`SELECT user_id FROM circle_members WHERE circle_id=? AND role='admin'`, item.circle_id)).map((r) => r.user_id)
  : [item.owner_id]);

async function expireOldRequests() {
  const t = today();
  const rows = await db.all(`SELECT b.*, i.name AS item_name FROM borrows b JOIN items i ON i.id=b.item_id
                             WHERE (b.status IN ('requested','countered') AND (b.updated_at<? OR (b.start_date<? AND b.status='requested')))
                             OR (b.status='approved' AND b.end_date<?)`, now() - 3 * 86400000, addDays(t, -1), t);
  for (const b of rows) {
    const changed = await db.run(`UPDATE borrows SET status='expired', updated_at=? WHERE id=? AND status=?`, now(), b.id, b.status);
    if (!changed) continue;
    await systemMessage('borrow', b.id, b.status === 'approved' ? 'Expired: the handover never happened before the end date.' : 'Expired: no answer in time.');
    await notify(b.borrower_id, { circleId: b.circle_id, type: 'borrow_expired', title: `Your request for ${b.item_name} expired`, body: 'You can send a new request.', link: `/borrows/${b.id}` });
  }
}

async function closeOldWanted() {
  await db.run(`UPDATE wanted_posts SET status='closed' WHERE status='open' AND ((needed_by IS NOT NULL AND needed_by<?) OR (needed_by IS NULL AND created_at<?))`,
    addDays(today(), -3), now() - 14 * 86400000);
}

async function waitlistRest() {
  const rows = await db.all(`SELECT w.id, w.user_id, i.id AS item_id, i.name, i.circle_id FROM waitlist w JOIN items i ON i.id=w.item_id
                             WHERE w.notified_at IS NULL AND i.status='available' AND i.available_since<?`, now() - 12 * 3600000);
  for (const r of rows) {
    const changed = await db.run('UPDATE waitlist SET notified_at=? WHERE id=? AND notified_at IS NULL', now(), r.id);
    if (!changed) continue;
    await notify(r.user_id, { circleId: r.circle_id, type: 'waitlist', title: `${r.name} is available`, body: 'You are on the waitlist. Send a request if you still need it.', link: `/items/${r.item_id}`, email: 'borrow' });
  }
}

async function reminders() {
  if (hourNow() < 9) return; // send from 9 AM India time
  const t = today();
  const tomorrow = addDays(t, 1);
  const rows = await db.all(`SELECT b.*, i.name AS item_name, i.is_shared, i.owner_id, i.circle_id AS icircle FROM borrows b JOIN items i ON i.id=b.item_id
                             WHERE b.status='active' AND b.end_date<=?`, tomorrow);
  for (const b of rows) {
    const item = { is_shared: b.is_shared, owner_id: b.owner_id, circle_id: b.icircle };
    const link = `/borrows/${b.id}`;
    if (b.end_date === tomorrow && !b.remind_before_sent) {
      if (!(await db.run('UPDATE borrows SET remind_before_sent=1 WHERE id=? AND remind_before_sent=0', b.id))) continue;
      await notify(b.borrower_id, { circleId: b.circle_id, type: 'reminder', title: `Reminder: ${b.item_name} is due tomorrow`, body: `Please return it by ${prettyDate(b.end_date)}, or ask for more time in the app.`, link, email: 'reminders' });
    } else if (b.end_date === t && !b.remind_due_sent) {
      if (!(await db.run('UPDATE borrows SET remind_due_sent=1, remind_before_sent=1 WHERE id=? AND remind_due_sent=0', b.id))) continue;
      await notify(b.borrower_id, { circleId: b.circle_id, type: 'reminder', title: `${b.item_name} is due today`, body: 'Please return it today, or ask for more time in the app.', link, email: 'reminders' });
      await notifyMany(await lendersOf(item), { circleId: b.circle_id, type: 'reminder', title: `${b.item_name} is due back today`, link });
    } else if (b.end_date < t && b.last_overdue_reminder !== t) {
      // daily for the first 3 days late, then every 3 days
      const gap = b.last_overdue_reminder ? daysBetween(b.last_overdue_reminder, t) - 1 : 99;
      if (b.overdue_reminders < 3 || gap >= 3) {
        const changed = await db.run(`UPDATE borrows SET overdue_reminders=overdue_reminders+1, last_overdue_reminder=? WHERE id=?
                                      AND (last_overdue_reminder IS NULL OR last_overdue_reminder<>?)`, t, b.id, t);
        if (!changed) continue;
        const late = daysBetween(b.end_date, t) - 1;
        await notify(b.borrower_id, { circleId: b.circle_id, type: 'overdue', title: `${b.item_name} is ${late} day${late > 1 ? 's' : ''} late`, body: 'Please return it soon. Returning late can cost you the On-Time Returner badge.', link, email: 'reminders' });
        if (b.overdue_reminders === 0) await notifyMany(await lendersOf(item), { circleId: b.circle_id, type: 'overdue', title: `${b.item_name} was not returned on time`, body: 'We reminded the borrower. You can message them in the chat.', link });
      }
    }
  }
}

async function daily() {
  const t = today();
  // only one runner per day gets past this line
  const claimed = await db.run(`INSERT INTO job_state(name,value) VALUES('daily',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value
                                WHERE job_state.value IS DISTINCT FROM excluded.value`, t);
  if (!claimed) return;
  await recheckAllBadges(); // includes Businessperson going away after 6 months without auction sales
  await db.run('DELETE FROM login_codes WHERE expires_at<?', now());
  await db.run('DELETE FROM sessions WHERE expires_at<?', now());
  await db.run('DELETE FROM auth_hits WHERE at<?', now() - 3600000);
  await db.run('DELETE FROM notifications WHERE created_at<? AND read_at IS NOT NULL', now() - 90 * 86400000);
}

export async function runJobs() {
  const done = [];
  for (const job of [closeDueAuctions, expireOldRequests, closeOldWanted, waitlistRest, reminders, daily]) {
    try { await job(); done.push(job.name); } catch (e) { console.error(`[JOB ${job.name}]`, e); }
  }
  return done;
}

// Called on normal requests: runs the jobs in the background at most every 5 minutes (across all instances).
let lastTry = 0;
export function maybeRunJobs() {
  if (Date.now() - lastTry < 60 * 1000) return;
  lastTry = Date.now();
  background((async () => {
    const claimed = await db.run(`INSERT INTO job_state(name,value) VALUES('last_run',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value
                                  WHERE job_state.value::bigint < ?`, String(now()), now() - 5 * 60 * 1000);
    if (claimed) await runJobs();
  })());
}
