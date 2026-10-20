// Giveaways: free (owner picks) or auction (highest bid at the end time wins).
// The app only helps decide who gets the item. Any payment happens in person, outside the app.
import { Router } from 'express';
import db from '../db.js';
import { h, bad, now, str, optStr, int, idParam, forbidden, notFound } from '../lib/util.js';
import { requireMember, userCard, userCards } from '../lib/access.js';
import { notify, notifyMany, systemMessage } from '../lib/notify.js';
import { recheckBadges } from '../lib/badges.js';
import { createItem, itemSummary, itemSummaries, VIDEO_MSG } from './items.js';
import { threadMessages, postMessage } from './borrows.js';

export const giveawaysRouter = Router();

const highest = (gid) => db.get('SELECT * FROM bids WHERE giveaway_id=? ORDER BY amount DESC, created_at ASC, id ASC LIMIT 1', gid);

// Auctions close by themselves: every request touching giveaways first closes any that are past their end time.
let lastClose = 0;
async function closeIfDue() {
  if (Date.now() - lastClose < 15000) return;
  lastClose = Date.now();
  await closeDueAuctions();
}

async function loadGiveaway(id, uid) {
  await closeIfDue();
  const g = await db.get('SELECT * FROM giveaways WHERE id=?', id);
  if (!g) throw notFound('Giveaway not found');
  const item = await db.get('SELECT * FROM items WHERE id=?', g.item_id);
  if (!item || item.status === 'removed') throw notFound('Giveaway not found');
  await requireMember(item.circle_id, uid);
  return { g, item };
}
const fresh = (id) => db.get('SELECT * FROM giveaways WHERE id=?', id);

async function giveawayOut(g, item, uid) {
  const owner = item.owner_id === uid;
  const [sum, top, bids, interest, myTop, thanked] = await Promise.all([
    itemSummary(item),
    highest(g.id),
    db.all('SELECT b.id, b.amount, b.created_at, b.user_id, u.name FROM bids b JOIN users u ON u.id=b.user_id WHERE giveaway_id=? ORDER BY amount DESC, b.created_at ASC LIMIT 50', g.id),
    db.all('SELECT * FROM giveaway_interest WHERE giveaway_id=? ORDER BY created_at', g.id),
    db.get('SELECT MAX(amount) AS m FROM bids WHERE giveaway_id=? AND user_id=?', g.id, uid),
    db.get(`SELECT 1 AS x FROM thank_you_notes WHERE from_user=? AND thread_type='giveaway' AND thread_id=?`, uid, g.id),
  ]);
  const cards = await userCards([item.owner_id, g.winner_id, top?.user_id, ...interest.map((i) => i.user_id)]);
  const { n: bidCount } = await db.get('SELECT COUNT(*) n FROM bids WHERE giveaway_id=?', g.id);
  return {
    ...g,
    item: { ...sum, description: item.description, rules: item.rules },
    owner: cards.get(item.owner_id),
    is_owner: owner,
    highest_bid: top ? { amount: top.amount, user: cards.get(top.user_id), mine: top.user_id === uid } : null,
    bid_count: bidCount,
    bids,
    my_top_bid: myTop?.m ?? null,
    interest: owner ? interest.map((i) => ({ ...i, user: cards.get(i.user_id) })) : [],
    interest_count: interest.length,
    i_am_interested: interest.some((i) => i.user_id === uid),
    winner: g.winner_id ? cards.get(g.winner_id) : null,
    is_winner: g.winner_id === uid,
    chat_open: !!g.winner_id && (owner || g.winner_id === uid) && ['ended', 'given'].includes(g.status),
    thanked: !!thanked,
    video_msg: VIDEO_MSG,
    server_now: now(),
  };
}

giveawaysRouter.get('/circles/:id/giveaways', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  await closeIfDue();
  const past = req.query.status === 'past';
  const rows = await db.all(`SELECT g.*,
      (SELECT MAX(amount) FROM bids b WHERE b.giveaway_id=g.id) AS highest_bid,
      (SELECT COUNT(*) FROM bids b WHERE b.giveaway_id=g.id) AS bid_count,
      (SELECT COUNT(*) FROM giveaway_interest x WHERE x.giveaway_id=g.id) AS interest_count
    FROM giveaways g JOIN items i ON i.id=g.item_id WHERE i.circle_id=? AND i.status<>'removed'
    AND g.status ${past ? `IN ('given','cancelled')` : `IN ('open','ended')`}
    ORDER BY CASE g.status WHEN 'open' THEN 0 ELSE 1 END, (g.ends_at IS NULL), g.ends_at, g.created_at DESC LIMIT 100`, circleId);
  const items = new Map((await itemSummaries('i.id = ANY(?)', [rows.map((r) => r.item_id)])).map((s) => [s.id, s]));
  res.json({ giveaways: rows.map((g) => ({ ...g, item: items.get(g.item_id), owner: items.get(g.item_id)?.owner })) });
}));

function readMode(body) {
  const mode = body?.mode;
  if (!['free', 'auction'].includes(mode)) throw bad('Choose Free or Auction');
  if (mode === 'free') return { mode, start_price: null, ends_at: null };
  const startPrice = int(body.start_price, { min: 0, max: 1000000, field: 'Minimum start price' });
  const endsAt = Number(body.ends_at);
  if (!Number.isFinite(endsAt)) throw bad('Pick the auction end date and time');
  if (endsAt < now() + 10 * 60 * 1000) throw bad('The auction must end at least 10 minutes from now');
  if (endsAt > now() + 60 * 86400000) throw bad('The auction can run for at most 60 days');
  return { mode, start_price: startPrice, ends_at: endsAt };
}

giveawaysRouter.post('/circles/:id/giveaways', h(async (req, res) => {
  const circleId = idParam(req.params.id);
  await requireMember(circleId, req.user.id);
  const m = readMode(req.body);
  const gid = await db.tx(async (t) => {
    const itemId = await createItem(req.body, circleId, req.user.id, { listingType: 'giveaway' }, t);
    return t.insert('INSERT INTO giveaways(item_id,mode,start_price,ends_at,status,created_at) VALUES(?,?,?,?,?,?)',
      itemId, m.mode, m.start_price, m.ends_at, 'open', now());
  });
  const { g, item } = await loadGiveaway(gid, req.user.id);
  res.json({ giveaway: await giveawayOut(g, item, req.user.id) });
}));

giveawaysRouter.get('/giveaways/:id', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  res.json({ giveaway: await giveawayOut(g, item, req.user.id) });
}));

giveawaysRouter.post('/giveaways/:id/bids', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (g.mode !== 'auction') throw bad('This is a free giveaway');
  if (g.status !== 'open' || g.ends_at <= now()) throw bad('This auction has ended');
  if (item.owner_id === req.user.id) throw bad('You cannot bid on your own item');
  const amount = int(req.body?.amount, { min: 0, max: 10000000, field: 'Bid' });
  // lock the auction row so two bids at the same moment can't both "win"
  const prevTop = await db.tx(async (t) => {
    await t.get('SELECT id FROM giveaways WHERE id=? FOR UPDATE', g.id);
    const top = await t.get('SELECT * FROM bids WHERE giveaway_id=? ORDER BY amount DESC, created_at ASC, id ASC LIMIT 1', g.id);
    if (amount < g.start_price) throw bad(`Bid at least ₹${g.start_price}`);
    if (top && amount <= top.amount) throw bad(`Bid more than ₹${top.amount}`);
    if (top && top.user_id === req.user.id) throw bad('You already have the highest bid');
    await t.run('INSERT INTO bids(giveaway_id,user_id,amount,created_at) VALUES(?,?,?,?)', g.id, req.user.id, amount, now());
    return top;
  });
  if (prevTop) {
    await notify(prevTop.user_id, { circleId: item.circle_id, type: 'outbid', title: `You were outbid on ${item.name}`, body: `New highest bid: ₹${amount}`, link: `/giveaways/${g.id}`, email: 'auctions' });
  }
  await notify(item.owner_id, { circleId: item.circle_id, type: 'bid', title: `New bid on ${item.name}: ₹${amount}`, link: `/giveaways/${g.id}` });
  res.json({ giveaway: await giveawayOut(g, item, req.user.id) });
}));

giveawaysRouter.post('/giveaways/:id/interest', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (g.mode !== 'free' || g.status !== 'open') throw bad('This giveaway is not taking requests');
  if (item.owner_id === req.user.id) throw bad('This is your own item');
  if (req.body?.remove) {
    await db.run('DELETE FROM giveaway_interest WHERE giveaway_id=? AND user_id=?', g.id, req.user.id);
  } else {
    const note = optStr(req.body?.note, 200, 'Note');
    const isNew = !(await db.get('SELECT 1 AS x FROM giveaway_interest WHERE giveaway_id=? AND user_id=?', g.id, req.user.id));
    await db.run(`INSERT INTO giveaway_interest(giveaway_id,user_id,note,created_at) VALUES(?,?,?,?)
                  ON CONFLICT(giveaway_id,user_id) DO UPDATE SET note=excluded.note`, g.id, req.user.id, note, now());
    if (isNew) await notify(item.owner_id, { circleId: item.circle_id, type: 'interest', title: `${req.user.name} wants your ${item.name}`, body: note, link: `/giveaways/${g.id}` });
  }
  res.json({ giveaway: await giveawayOut(g, item, req.user.id) });
}));

giveawaysRouter.post('/giveaways/:id/pick', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (item.owner_id !== req.user.id) throw forbidden();
  if (g.mode !== 'free' || g.status !== 'open') throw bad('You cannot pick now');
  const userId = int(req.body?.userId, { min: 1, field: 'Person' });
  if (!(await db.get('SELECT 1 AS x FROM giveaway_interest WHERE giveaway_id=? AND user_id=?', g.id, userId))) throw bad('Pick someone who asked for it');
  await db.run(`UPDATE giveaways SET status='ended', winner_id=? WHERE id=?`, userId, g.id);
  await db.run(`UPDATE items SET status='paused', updated_at=? WHERE id=?`, now(), item.id);
  const winner = await userCard(userId);
  await systemMessage('giveaway', g.id, `${req.user.name} picked ${winner.name} for ${item.name}. Arrange the pickup here.`);
  await notify(userId, { circleId: item.circle_id, type: 'giveaway_won', title: `${req.user.name} is giving you ${item.name}! 🎁`, body: 'Chat to arrange the pickup.', link: `/giveaways/${g.id}`, email: 'auctions' });
  res.json({ giveaway: await giveawayOut(await fresh(g.id), item, req.user.id) });
}));

giveawaysRouter.post('/giveaways/:id/given', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (item.owner_id !== req.user.id) throw forbidden();
  if (g.status !== 'ended' || !g.winner_id) throw bad('There is no one to give it to yet');
  await db.run(`UPDATE giveaways SET status='given', given_at=? WHERE id=?`, now(), g.id);
  await db.run(`UPDATE items SET status='given', updated_at=? WHERE id=?`, now(), item.id);
  await systemMessage('giveaway', g.id, `${item.name} was handed over. Enjoy! 🎉`);
  await notify(g.winner_id, { circleId: item.circle_id, type: 'giveaway_given', title: `${item.name} is yours now`, body: 'You can leave a thank-you note.', link: `/giveaways/${g.id}` });
  await recheckBadges(item.owner_id); // Semester Saver + Businessperson
  res.json({ giveaway: await giveawayOut(await fresh(g.id), item, req.user.id) });
}));

giveawaysRouter.post('/giveaways/:id/cancel', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (item.owner_id !== req.user.id) throw forbidden();
  if (!['open', 'ended'].includes(g.status)) throw bad('Already finished');
  if (g.mode === 'auction' && (await highest(g.id))) throw bad('The auction already has bids, so it cannot be cancelled');
  await db.run(`UPDATE giveaways SET status='cancelled' WHERE id=?`, g.id);
  await db.run(`UPDATE items SET status='removed', removed_by=?, updated_at=? WHERE id=?`, req.user.id, now(), item.id);
  if (g.winner_id) await notify(g.winner_id, { circleId: item.circle_id, type: 'giveaway_cancelled', title: `The giveaway of ${item.name} was cancelled` });
  res.json({ ok: true });
}));

// Auction ended with no bids → run again, or switch to free.
giveawaysRouter.post('/giveaways/:id/relist', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (item.owner_id !== req.user.id) throw forbidden();
  if (g.status !== 'ended' || g.winner_id) throw bad('Only a giveaway that ended with no one can be listed again');
  const m = readMode(req.body);
  await db.tx(async (t) => {
    await t.run('DELETE FROM bids WHERE giveaway_id=?', g.id);
    await t.run('DELETE FROM giveaway_interest WHERE giveaway_id=?', g.id);
    await t.run(`UPDATE giveaways SET mode=?, start_price=?, ends_at=?, status='open', winner_id=NULL, final_price=NULL WHERE id=?`,
      m.mode, m.start_price, m.ends_at, g.id);
    await t.run(`UPDATE items SET status='available', updated_at=? WHERE id=?`, now(), item.id);
  });
  res.json({ giveaway: await giveawayOut(await fresh(g.id), item, req.user.id) });
}));

giveawaysRouter.get('/giveaways/:id/messages', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (item.owner_id !== req.user.id && g.winner_id !== req.user.id) throw forbidden();
  res.json({ messages: await threadMessages('giveaway', g.id, req.query.after) });
}));
giveawaysRouter.post('/giveaways/:id/messages', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  const open = !!g.winner_id && (item.owner_id === req.user.id || g.winner_id === req.user.id) && ['ended', 'given'].includes(g.status);
  if (!open) throw bad('This chat is not open');
  await postMessage('giveaway', g.id, req.user.id, req.body?.body);
  res.json({ messages: await threadMessages('giveaway', g.id, req.body?.after) });
}));
giveawaysRouter.post('/giveaways/:id/thanks', h(async (req, res) => {
  const { g, item } = await loadGiveaway(idParam(req.params.id), req.user.id);
  if (g.winner_id !== req.user.id || g.status !== 'given') throw bad('You can say thanks after you get the item');
  const message = str(req.body?.message, { min: 2, max: 200, field: 'Note' });
  await db.run(`INSERT INTO thank_you_notes(from_user,to_user,thread_type,thread_id,message,created_at) VALUES(?,?,'giveaway',?,?,?) ON CONFLICT DO NOTHING`,
    req.user.id, item.owner_id, g.id, message, now());
  await notify(item.owner_id, { circleId: item.circle_id, type: 'thanks', title: `${req.user.name} left you a thank-you note 💌`, body: message, link: `/u/${item.owner_id}` });
  res.json({ giveaway: await giveawayOut(g, item, req.user.id) });
}));

// Closes auctions past their end time. Safe to run often and from many places at once.
export async function closeDueAuctions() {
  const due = await db.all(`SELECT * FROM giveaways WHERE mode='auction' AND status='open' AND ends_at<=?`, now());
  for (const g of due) {
    const top = await highest(g.id);
    // only one runner wins the update
    const changed = await db.run(`UPDATE giveaways SET status='ended', winner_id=?, final_price=? WHERE id=? AND status='open'`,
      top?.user_id || null, top?.amount ?? null, g.id);
    if (!changed) continue;
    const item = await db.get('SELECT * FROM items WHERE id=?', g.item_id);
    if (top) {
      const winner = await userCard(top.user_id);
      await db.run(`UPDATE items SET status='paused', updated_at=? WHERE id=?`, now(), item.id);
      await systemMessage('giveaway', g.id, `Auction ended. ${winner.name} won with ₹${top.amount}. Arrange pickup and payment in person here.`);
      await notify(top.user_id, { circleId: item.circle_id, type: 'auction_won', title: `You won ${item.name} for ₹${top.amount}! 🎉`, body: 'Chat with the owner to pick it up. Payment is done in person, not in the app.', link: `/giveaways/${g.id}`, email: 'auctions' });
      await notify(item.owner_id, { circleId: item.circle_id, type: 'auction_ended', title: `Auction for ${item.name} ended`, body: `${winner.name} won with ₹${top.amount}.`, link: `/giveaways/${g.id}`, email: 'auctions' });
      const losers = (await db.all('SELECT DISTINCT user_id FROM bids WHERE giveaway_id=? AND user_id<>?', g.id, top.user_id)).map((r) => r.user_id);
      await notifyMany(losers, { circleId: item.circle_id, type: 'auction_lost', title: `Auction for ${item.name} ended`, body: `Someone else won with ₹${top.amount}.`, link: `/giveaways/${g.id}` });
    } else {
      await notify(item.owner_id, { circleId: item.circle_id, type: 'auction_ended', title: `No bids on ${item.name}`, body: 'You can run the auction again or give it away for free.', link: `/giveaways/${g.id}`, email: 'auctions' });
    }
  }
}
