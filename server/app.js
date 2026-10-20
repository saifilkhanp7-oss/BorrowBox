// The BorrowBox API (Express). Used by Vercel (api/index.js) and by the local dev server (server/local.js).
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { dbReady } from './db.js';
import { authRouter, loadSession, requireAuth } from './routes/auth.js';
import { circlesRouter } from './routes/circles.js';
import { itemsRouter } from './routes/items.js';
import { borrowsRouter } from './routes/borrows.js';
import { communityRouter } from './routes/community.js';
import { giveawaysRouter } from './routes/giveaways.js';
import { reportsRouter } from './routes/reports.js';
import { miscRouter } from './routes/misc.js';
import { thingsRouter } from './routes/things.js';
import { runJobs, maybeRunJobs } from './lib/jobs.js';
import { emailMode } from './lib/mailer.js';
import { h } from './lib/util.js';

const app = express();
app.set('trust proxy', true); // Vercel runs the app behind its proxy (needed for secure cookies and client IPs)
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  next();
});

// Block cross-site form posts: state-changing requests must come from our own site.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Bad origin' });
    } catch { return res.status(403).json({ error: 'Bad origin' }); }
  }
  next();
});

app.get('/api/health', h(async (req, res) => {
  const b = await dbReady();
  res.json({ ok: true, db: b.kind, email: emailMode() });
}));

// Scheduled jobs. Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>".
// You can also call it from cron-job.org or Supabase pg_cron: /api/cron?key=<CRON_SECRET>
app.get('/api/cron', h(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.key;
  if (!secret || given !== secret) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ok: true, ran: await runJobs() });
}));

app.use('/api', loadSession);
app.use('/api', (req, res, next) => { maybeRunJobs(); next(); });
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/circles', circlesRouter);
app.use('/api', itemsRouter);
app.use('/api', borrowsRouter);
app.use('/api', communityRouter);
app.use('/api', giveawaysRouter);
app.use('/api', reportsRouter);
app.use('/api', miscRouter);
app.use('/api', thingsRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too much text.' });
  console.error(err);
  const dbDown = /DATABASE_URL|ECONNREFUSED|ENOTFOUND|password authentication|timeout/i.test(err.message || '');
  res.status(500).json({ error: dbDown ? 'The database is not reachable right now. If you run this site, check DATABASE_URL in Vercel and that the Supabase project is not paused.' : 'Something went wrong. Please try again.' });
});

export default app;
