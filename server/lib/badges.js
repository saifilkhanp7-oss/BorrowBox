// Trust badges. No fines, no points – lateness only affects the On-Time Returner badge.
import db from '../db.js';
import { now } from './util.js';
import { notify } from './notify.js';

export const BADGES = {
  on_time: { name: 'On-Time Returner', emoji: '⏰' },
  generous: { name: 'Generous Lender', emoji: '🤝' },
  helpful: { name: 'Helpful Neighbour', emoji: '🌱' },
  semester_saver: { name: 'Semester Saver', emoji: '🎓' },
  businessperson: { name: 'Businessperson', emoji: '💼' },
};

// Businessperson: sold this many items by auction in the last BUSINESS_DAYS days.
export const BUSINESS_MIN_SALES = 3;
export const BUSINESS_DAYS = 180;

const active = (userId, badge) =>
  db.get('SELECT id FROM user_badges WHERE user_id=? AND badge=? AND lost_at IS NULL', userId, badge);

async function give(userId, badge) {
  if (await active(userId, badge)) return;
  await db.run('INSERT INTO user_badges(user_id,badge,earned_at) VALUES(?,?,?)', userId, badge, now());
  await notify(userId, { type: 'badge', title: `You earned the ${BADGES[badge].emoji} ${BADGES[badge].name} badge!`, link: `/u/${userId}` });
}
async function take(userId, badge, body) {
  const row = await active(userId, badge);
  if (!row) return;
  await db.run('UPDATE user_badges SET lost_at=? WHERE id=?', now(), row.id);
  await notify(userId, { type: 'badge', title: `You lost the ${BADGES[badge].emoji} ${BADGES[badge].name} badge`, body, link: `/u/${userId}` });
}

export async function recheckBadges(userId) {
  if (!userId) return;
  // On-Time Returner: 3+ returns; earn when all of the last 5 were on time; lose at 2 late in the last 5.
  const returns = await db.all(`SELECT returned_on_time FROM borrows WHERE borrower_id=? AND status='returned'
                                ORDER BY return_borrower_at DESC NULLS LAST, id DESC LIMIT 5`, userId);
  const total = (await db.get(`SELECT COUNT(*) n FROM borrows WHERE borrower_id=? AND status='returned'`, userId)).n;
  const late = returns.filter((r) => !r.returned_on_time).length;
  if (await active(userId, 'on_time')) {
    if (late >= 2) await take(userId, 'on_time', 'Return the next few things on time to get it back.');
  } else if (total >= 3 && late === 0) {
    await give(userId, 'on_time');
  }

  // Generous Lender: lent own items 5+ times (completed).
  const lent = (await db.get(`SELECT COUNT(*) n FROM borrows b JOIN items i ON i.id=b.item_id
                              WHERE i.owner_id=? AND i.is_shared=0 AND b.status='returned'`, userId)).n;
  if (lent >= 5) await give(userId, 'generous');

  // Helpful Neighbour: 3+ "I have this" offers that got handed over, or favours marked done.
  const offers = (await db.get(`SELECT COUNT(*) n FROM wanted_offers o JOIN borrows b ON b.id=o.borrow_id
                                WHERE o.offered_by=? AND b.status IN ('active','returned')`, userId)).n;
  const favours = (await db.get(`SELECT COUNT(*) n FROM skill_requests r JOIN skills s ON s.id=r.skill_id
                                 WHERE s.user_id=? AND r.status='done'`, userId)).n;
  if (offers + favours >= 3) await give(userId, 'helpful');

  // Semester Saver: gave away 3+ items (free or auction).
  const given = (await db.get(`SELECT COUNT(*) n FROM giveaways g JOIN items i ON i.id=g.item_id
                               WHERE i.owner_id=? AND g.status='given'`, userId)).n;
  if (given >= 3) await give(userId, 'semester_saver');

  // Businessperson: sells items in auctions often (3+ sold in the last 6 months). Goes away if they stop.
  const sold = (await db.get(`SELECT COUNT(*) n FROM giveaways g JOIN items i ON i.id=g.item_id
                              WHERE i.owner_id=? AND g.mode='auction' AND g.status='given' AND g.given_at>?`,
  userId, now() - BUSINESS_DAYS * 86400000)).n;
  if (sold >= BUSINESS_MIN_SALES) await give(userId, 'businessperson');
  else await take(userId, 'businessperson', `Sell ${BUSINESS_MIN_SALES} items in auctions within 6 months to get it back.`);
}

export async function recheckAllBadges() {
  for (const { id } of await db.all('SELECT id FROM users')) await recheckBadges(id);
}
