import crypto from 'node:crypto';

export const APP_TZ = process.env.APP_TZ || 'Asia/Kolkata';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'You are not allowed to do this') => new HttpError(403, msg);

export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const now = () => Date.now();
export const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// ---------- dates ('YYYY-MM-DD' in the app time zone) ----------
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', hourCycle: 'h23' });
export const today = (ms = Date.now()) => dateFmt.format(new Date(ms));
export const hourNow = () => Number(hourFmt.format(new Date()));
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) { // inclusive
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;
}
export function prettyDate(s) {
  if (!s) return '';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------- input cleaning ----------
export function str(v, { max = 500, min = 0, field = 'Field' } = {}) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw bad(min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}
export function optStr(v, max = 500, field = 'Field') {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}
export function int(v, { min, max, field = 'Number' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${field} must be a whole number`);
  if (min !== undefined && n < min) throw bad(`${field} must be at least ${min}`);
  if (max !== undefined && n > max) throw bad(`${field} must be at most ${max}`);
  return n;
}
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
export const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
};

export const CATEGORIES = [
  'Books', 'Electronics & Chargers', 'Calculators & Stationery', 'Cycles & Vehicles',
  'Home & Kitchen', 'Tools', 'Sports', 'Clothes & Formal wear', 'Games & Fun', 'Other',
];
export const CONDITIONS = ['New', 'Like new', 'Good', 'Used', 'Worn'];

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function publicBaseUrl(req) {
  const fromEnv = process.env.APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return req ? `${req.protocol}://${req.get('host')}` : '';
}
