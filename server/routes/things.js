// "My things": a private list of everything a person owns, with counters.
// Only the owner can see it. Items they share in circles are added to it automatically.
import { Router } from 'express';
import db from '../db.js';
import { h, bad, now, str, optStr, int, idParam, notFound, CATEGORIES } from '../lib/util.js';

export const thingsRouter = Router();
const MAX_THINGS = 1000;

function readThing(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, { min: 1, max: 60, field: 'Name' });
  if (!partial || body.category !== undefined) {
    const c = body.category || 'Other';
    if (!CATEGORIES.includes(c)) throw bad('Pick a category');
    out.category = c;
  }
  if (!partial || body.quantity !== undefined) out.quantity = int(body.quantity ?? 1, { min: 1, max: 999, field: 'How many' });
  if (!partial || body.note !== undefined) out.note = optStr(body.note, 200, 'Note');
  return out;
}

// Items the person shares in circles are things they own too: make sure each one is on the list.
async function addSharedItems(userId) {
  await db.run(`INSERT INTO my_things(user_id,name,category,quantity,shared_item_id,created_at,updated_at)
                SELECT i.owner_id, i.name, i.category, 1, i.id, ?, ?
                FROM items i WHERE i.owner_id=? AND i.listing_type='lend' AND i.status NOT IN ('removed','given')
                AND NOT EXISTS (SELECT 1 FROM my_things t WHERE t.shared_item_id=i.id)
                ON CONFLICT DO NOTHING`, now(), now(), userId);
}

const THING_SQL = `SELECT t.*, i.status AS item_status, i.circle_id AS item_circle_id, c.name AS circle_name
                   FROM my_things t LEFT JOIN items i ON i.id=t.shared_item_id LEFT JOIN circles c ON c.id=i.circle_id`;

function thingOut(t) {
  const live = t.shared_item_id && t.item_status && !['removed', 'given'].includes(t.item_status);
  return {
    id: t.id, name: t.name, category: t.category, quantity: t.quantity, note: t.note,
    created_at: t.created_at, updated_at: t.updated_at,
    shared: live ? { item_id: t.shared_item_id, circle_id: t.item_circle_id, circle: t.circle_name, status: t.item_status } : null,
  };
}

async function listOut(userId) {
  const rows = await db.all(`${THING_SQL} WHERE t.user_id=? ORDER BY t.category, lower(t.name)`, userId);
  const things = rows.map(thingOut);
  const byCategory = {};
  for (const t of things) byCategory[t.category] = (byCategory[t.category] || 0) + t.quantity;
  return {
    things,
    totals: {
      total: things.reduce((n, t) => n + t.quantity, 0), // counts quantities: 3 pens = 3
      different: things.length,
      shared: things.filter((t) => t.shared).length,
      by_category: byCategory,
    },
  };
}

thingsRouter.get('/things', h(async (req, res) => {
  await addSharedItems(req.user.id);
  res.json(await listOut(req.user.id));
}));

thingsRouter.post('/things', h(async (req, res) => {
  const f = readThing(req.body || {});
  const { n } = await db.get('SELECT COUNT(*) n FROM my_things WHERE user_id=?', req.user.id);
  if (n >= MAX_THINGS) throw bad(`You can keep at most ${MAX_THINGS} things on your list.`);
  // same name + category already on the list → just add to its count
  const same = await db.get('SELECT id FROM my_things WHERE user_id=? AND lower(name)=lower(?) AND category=? AND shared_item_id IS NULL', req.user.id, f.name, f.category);
  let id;
  if (same && !req.body?.separate) {
    await db.run('UPDATE my_things SET quantity=LEAST(quantity+?, 999), updated_at=? WHERE id=?', f.quantity, now(), same.id);
    id = same.id;
  } else {
    id = await db.insert('INSERT INTO my_things(user_id,name,category,quantity,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      req.user.id, f.name, f.category, f.quantity, f.note, now(), now());
  }
  res.json({ id, merged: !!same && !req.body?.separate, ...(await listOut(req.user.id)) });
}));

async function loadThing(id, userId) {
  const t = await db.get('SELECT * FROM my_things WHERE id=? AND user_id=?', id, userId);
  if (!t) throw notFound('Not found');
  return t;
}

thingsRouter.patch('/things/:id', h(async (req, res) => {
  const t = await loadThing(idParam(req.params.id), req.user.id);
  const f = readThing(req.body || {}, true);
  const keys = Object.keys(f);
  if (keys.length) await db.run(`UPDATE my_things SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), now(), t.id);
  res.json(await listOut(req.user.id));
}));

thingsRouter.delete('/things/:id', h(async (req, res) => {
  const t = await loadThing(idParam(req.params.id), req.user.id);
  if (t.shared_item_id) {
    const item = await db.get('SELECT status FROM items WHERE id=?', t.shared_item_id);
    if (item && !['removed', 'given'].includes(item.status)) throw bad('This thing is shared in a circle. Remove it from the circle first (open the item → Remove).');
  }
  await db.run('DELETE FROM my_things WHERE id=?', t.id);
  res.json(await listOut(req.user.id));
}));

// Called after an item is created from a thing ("Share in a circle"), to link the two.
export async function linkThing(thingId, itemId, userId) {
  if (!thingId) return;
  await db.run('UPDATE my_things SET shared_item_id=?, updated_at=? WHERE id=? AND user_id=? AND shared_item_id IS NULL',
    itemId, now(), Number(thingId) || 0, userId);
}
