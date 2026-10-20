// Run BorrowBox on your own computer: API + the built website on one port, jobs every minute.
//   npm run dev        (API on http://localhost:4000, uses a local database if DATABASE_URL is empty)
//   npm run dev:client (website with hot reload on http://localhost:5173)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { dbReady } from './db.js';
import { runJobs } from './lib/jobs.js';
import { emailMode } from './lib/mailer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'client', 'dist');
const server = express();
server.use(app);
if (fs.existsSync(dist)) {
  server.use(express.static(dist, { index: false }));
  server.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 4000;
const b = await dbReady();
server.listen(port, () => {
  console.log(`BorrowBox running on http://localhost:${port}`);
  console.log(`Database: ${b.kind === 'pglite' ? 'local (server/data/pglite)' : 'Postgres (DATABASE_URL)'} · Email: ${emailMode() === 'none' ? 'not set (codes print here)' : 'Google Apps Script'}`);
  const tick = () => runJobs().catch((e) => console.error('[jobs]', e));
  tick();
  setInterval(tick, 60 * 1000).unref();
});
