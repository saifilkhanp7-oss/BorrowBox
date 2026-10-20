import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { sendCodeEmail } from '../lib/mailer.js';
import { h, bad, now, hash, randomToken, HttpError } from '../lib/util.js';

const COOKIE = 'bb_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 365;
const SESSION_MS = SESSION_DAYS * 86400000;
const CODE_TTL = 10 * 60 * 1000;
const RESEND_GAP = 60 * 1000;
// College Wi-Fi often puts a whole hostel behind one IP, so this is generous; each email also waits 60s between codes.
const IP_LIMIT = Number(process.env.AUTH_IP_LIMIT) || 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M} .'-]{2,40}$/u;
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const USER_COLS = 'id, name, email, room_no, email_borrow, email_reminders, email_urgent, email_auctions, created_at';

export const authRouter = Router();

// Per-network limit, stored in the database so it works across serverless instances.
async function ipLimited(ip) {
  const key = String(ip || 'unknown');
  await db.run('DELETE FROM auth_hits WHERE at<?', now() - 3600000);
  const { n } = await db.get('SELECT COUNT(*) n FROM auth_hits WHERE ip=?', key);
  if (n >= IP_LIMIT) return true;
  await db.run('INSERT INTO auth_hits(ip,at) VALUES(?,?)', key, now());
  return false;
}

function deviceLabel(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
    maxAge: SESSION_MS,
    path: '/',
  });
}

async function sendCode(req, res, mode) {
  const email = cleanEmail(req.body?.email);
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad('Enter a valid email address, e.g. you@gmail.com');
  const existing = await db.get('SELECT id, name FROM users WHERE email=?', email);
  if (mode === 'signup') {
    if (!NAME_RE.test(name)) throw bad('Name must be 2–40 letters (spaces, dots and hyphens are fine).');
    if (existing) throw new HttpError(409, 'This email already has an account. Please log in.');
  } else if (!existing) {
    throw new HttpError(404, 'No account found for this email. Please sign up.');
  }
  const prev = await db.get('SELECT sent_at FROM login_codes WHERE email=?', email);
  if (prev && now() - prev.sent_at < RESEND_GAP) {
    const wait = Math.ceil((RESEND_GAP - (now() - prev.sent_at)) / 1000);
    throw new HttpError(429, `Please wait ${wait}s before asking for another code.`);
  }
  if (await ipLimited(req.ip)) throw new HttpError(429, 'Too many code requests from this network. Try again in an hour.');

  const code = String(crypto.randomInt(100000, 1000000));
  await db.run(`INSERT INTO login_codes(email,code_hash,purpose,name,expires_at,attempts,sent_at) VALUES(?,?,?,?,?,0,?)
                ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, purpose=excluded.purpose, name=excluded.name,
                expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`,
  email, hash(code), mode, mode === 'signup' ? name : null, now() + CODE_TTL, now());
  try {
    const r = await sendCodeEmail(email, code, mode === 'signup' ? name : existing.name);
    res.json({ ok: true, devCode: r.dev ? code : undefined });
  } catch (e) {
    console.error('[EMAIL] code send failed:', e.message);
    await db.run('DELETE FROM login_codes WHERE email=?', email);
    throw new HttpError(502, 'Could not send the email right now. Please try again in a minute.');
  }
}

authRouter.post('/signup', h((req, res) => sendCode(req, res, 'signup')));
authRouter.post('/login', h((req, res) => sendCode(req, res, 'login')));

authRouter.post('/verify', h(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const row = await db.get('SELECT * FROM login_codes WHERE email=?', email);
  if (!row) throw bad('Please ask for a code first.');
  if (now() > row.expires_at) {
    await db.run('DELETE FROM login_codes WHERE email=?', email);
    throw bad('This code has expired. Ask for a new one.');
  }
  if (row.attempts >= 5) {
    await db.run('DELETE FROM login_codes WHERE email=?', email);
    throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  }
  if (hash(code) !== row.code_hash) {
    await db.run('UPDATE login_codes SET attempts=attempts+1 WHERE email=?', email);
    throw bad(`Wrong code. ${4 - row.attempts} tries left.`);
  }
  await db.run('DELETE FROM login_codes WHERE email=?', email);

  let user = await db.get(`SELECT ${USER_COLS} FROM users WHERE email=?`, email);
  if (row.purpose === 'signup' && !user) {
    await db.run('INSERT INTO users(name,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING', row.name, email, now());
    user = await db.get(`SELECT ${USER_COLS} FROM users WHERE email=?`, email);
  }
  if (!user) throw new HttpError(404, 'Account not found.');

  const token = randomToken(32);
  await db.run('INSERT INTO sessions(user_id,token_hash,device_label,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)',
    user.id, hash(token), deviceLabel(req.get('user-agent')), now(), now(), now() + SESSION_MS);
  setCookie(res, token);
  res.json({ user });
}));

// Every request: look up the session; keep the device logged in by sliding the expiry forward.
export const loadSession = h(async (req, res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const s = await db.get(`SELECT s.id AS sid, s.expires_at AS s_expires, s.last_seen_at AS s_last, ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')}
                          FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, hash(token));
  if (!s || s.s_expires < now()) return next();
  const { sid, s_expires: _e, s_last: last, ...user } = s;
  req.user = user;
  req.sessionId = sid;
  if (now() - last > 6 * 3600 * 1000) { // refresh at most every 6 hours
    await db.run('UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?', now(), now() + SESSION_MS, sid);
    setCookie(res, token);
  }
  next();
});

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.post('/logout', h(async (req, res) => {
  if (req.sessionId) await db.run('DELETE FROM sessions WHERE id=?', req.sessionId);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/sessions', requireAuth, h(async (req, res) => {
  const rows = await db.all('SELECT id, device_label, created_at, last_seen_at FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC', req.user.id);
  res.json({ sessions: rows.map((r) => ({ ...r, current: r.id === req.sessionId })) });
}));

authRouter.delete('/sessions/:id', requireAuth, h(async (req, res) => {
  const id = Number(req.params.id);
  await db.run('DELETE FROM sessions WHERE id=? AND user_id=?', id, req.user.id);
  if (id === req.sessionId) res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));
