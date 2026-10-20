import { waitUntil } from '@vercel/functions';
import db from '../db.js';
import { sendNoticeEmail } from './mailer.js';
import { now } from './util.js';

const EMAIL_COL = { borrow: 'email_borrow', reminders: 'email_reminders', urgent: 'email_urgent', auctions: 'email_auctions' };

// Keeps the serverless function alive until slow work (like sending an email) is finished.
export function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error('[background]', e.message));
  waitUntil(p);
  return p;
}

/**
 * Saves an in-app notification and (if the user allows that email group) sends an email in the background.
 * email: 'borrow' | 'reminders' | 'urgent' | 'auctions' | null
 */
export async function notify(userId, { circleId = null, type, title, body = null, link = null, email = null }) {
  if (!userId) return;
  await db.run('INSERT INTO notifications(user_id,circle_id,type,title,body,link,created_at) VALUES(?,?,?,?,?,?,?)',
    userId, circleId, type, title, body, link, now());
  if (!email) return;
  const user = await db.get('SELECT name, email, email_borrow, email_reminders, email_urgent, email_auctions FROM users WHERE id=?', userId);
  if (!user || !user[EMAIL_COL[email]]) return;
  background(sendNoticeEmail(user.email, user.name, title, body, link));
}

export const notifyMany = (userIds, payload) => Promise.all([...new Set(userIds)].map((id) => notify(id, payload)));

export async function systemMessage(threadType, threadId, body, t = db) {
  await t.run('INSERT INTO messages(thread_type,thread_id,sender_id,body,is_system,created_at) VALUES(?,?,NULL,?,1,?)',
    threadType, threadId, body, now());
}
