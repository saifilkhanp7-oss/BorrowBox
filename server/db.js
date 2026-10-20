// Database layer.
// - On Vercel / production: Supabase Postgres via DATABASE_URL (use the "Transaction pooler" connection string).
// - On your own computer without DATABASE_URL: a built-in local Postgres (PGlite) stored in server/data/pglite.
//
// Usage (write SQL with ? placeholders):
//   await db.get('SELECT * FROM users WHERE id=?', id)        -> first row or undefined
//   await db.all('SELECT ...', ...)                            -> array of rows
//   await db.run('UPDATE ...', ...)                            -> number of changed rows
//   await db.insert('INSERT INTO t(a) VALUES(?)', a)           -> new id
//   await db.tx(async (t) => { await t.run(...) })             -> transaction (use only `t` inside!)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = '3';

// ? → $1, $2 … (skips text inside single quotes)
function toPg(sql) {
  let n = 0;
  let out = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

function api(exec) {
  return {
    get: async (sql, ...p) => (await exec(toPg(sql), p)).rows[0],
    all: async (sql, ...p) => (await exec(toPg(sql), p)).rows,
    run: async (sql, ...p) => (await exec(toPg(sql), p)).rowCount,
    insert: async (sql, ...p) => (await exec(`${toPg(sql)} RETURNING id`, p)).rows[0].id,
  };
}

let backend; // { exec(text, params), tx(fn), script(sql) }

async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT → number
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 8),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (e) => console.error('[db] pool error', e.message));
    return {
      kind: 'postgres',
      exec: (text, params) => pool.query(text, params),
      script: (sql) => pool.query(sql),
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(api((t, p) => c.query(t, p)));
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set. Add your Supabase connection string in Vercel → Settings → Environment Variables.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(here, 'data', 'pglite');
  if (dir !== 'memory://') fs.mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir === 'memory://' ? undefined : dir, { parsers: { 20: (v) => (v === null ? null : Number(v)) } });
  await lite.waitReady;
  const wrap = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? 0 });
  return {
    kind: 'pglite',
    exec: async (text, params) => wrap(await lite.query(text, params)),
    script: (sql) => lite.exec(sql),
    tx: (fn) => lite.transaction((t) => fn(api(async (text, params) => wrap(await t.query(text, params))))),
  };
}

async function ensureSchema(b) {
  const meta = (await b.exec(`SELECT to_regclass('public.app_meta') AS t`, [])).rows[0];
  if (meta?.t) {
    const v = (await b.exec(`SELECT value FROM app_meta WHERE name='schema'`, [])).rows[0];
    if (v?.value === SCHEMA_VERSION) return;
  }
  await b.script(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  await b.exec(`INSERT INTO app_meta(name,value) VALUES('schema',$1) ON CONFLICT(name) DO UPDATE SET value=excluded.value`, [SCHEMA_VERSION]);
  console.log(`[db] schema ready (v${SCHEMA_VERSION})`);
}

let ready;
export function dbReady() {
  if (!ready) {
    ready = (async () => {
      const b = await connect();
      await ensureSchema(b);
      backend = b;
      return b;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const exec = async (text, params) => (await dbReady()).exec(text, params);

const db = {
  ...api(exec),
  tx: async (fn) => (await dbReady()).tx(fn),
  kind: () => backend?.kind,
};
export default db;
