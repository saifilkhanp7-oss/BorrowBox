# BorrowBox

A sharing app for small groups – a hostel block, a college class, an apartment building, an office or a friend group. People borrow from each other instead of buying, and the app keeps track of everything so nothing gets lost and nobody feels awkward to ask.

**Runs on:** Vercel (website + API, free Hobby plan) and Supabase (Postgres database, free plan).
**Built with:** React (Vite) · Node/Express (as one Vercel function) · PostgreSQL.

No statistics, no charts, no AI, no fines, no payments, and no photo uploads.

## What's inside

- **Circles** – private groups with an invite code/link. Nothing is visible outside a circle. The creator is admin.
- **Items** – name, category, condition, condition notes, max days, rules. No photos: each category has its own icon.
- **Video & check reminders** – a message under every "Share" form and on the item page: *take a video before you give it, check the item before you take it*. At handover the owner must tick **"I took a video"** and the borrower must tick **"I checked the item"** before they can confirm.
- **Borrowing** – calendar → request → approve / decline / suggest dates → handover → reminders → extensions → return (*came back fine* / *damaged* + note) → owner updates condition and shares again. While lent out, others see *"Unavailable at this moment"*.
- **My things** – a private list of everything you own, with a counter (total things, different items, how many are shared, count per category). Quick add with a +/− counter, search, and a one-tap "Share in a circle". Items you share are added to the list automatically. Only you can see it.
- **Waitlist, chat per borrow, QR labels, thank-you notes, My Shelf, Wanted board (urgent alerts), Skills & favours, shared circle items.**
- **Giveaways** – free (owner picks) or auction (start price + end time). Payment happens in person, outside the app.
- **Badges** – On-Time Returner, Generous Lender, Helpful Neighbour, Semester Saver, and **💼 Businessperson** (sold 3+ items by auction in the last 6 months; goes away if they stop).
- **Report a problem** – shows the condition record (when shared, at handover with the video/check ticks, at return) to both people; agree on repair / replace / forget it.
- Email-code login with your Apps Script, stays logged in, light/dark mode, works on iPhone and Android.

## Deploy (Supabase + Vercel)

### 1. Supabase – the database
1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in with GitHub.
2. **New project**: name `borrowbox`, set a **database password** (save it!), region **South Asia (Mumbai)**, plan Free → **Create new project**. Wait ~2 minutes.
3. Click **Connect** (top of the project page) → **Transaction pooler** → copy the connection string. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
   Replace `[YOUR-PASSWORD]` with your password. If the password has symbols like `@ # / ?`, either change it to letters and numbers only (Project Settings → Database → Reset password) or URL-encode them.

You don't need to create tables – the app creates them the first time it runs. (Or paste `server/schema.sql` into **SQL Editor → Run**.)

### 2. GitHub
Push this folder to a new GitHub repo (`package.json` and `vercel.json` must be at the top of the repo).

### 3. Vercel – the website
1. [vercel.com](https://vercel.com) → **Add New… → Project** → import the repo. Your existing Vercel site is not affected – this is a separate project.
2. Leave the settings as they are (they come from `vercel.json`). Framework Preset should show **Other**.
3. Open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase Transaction pooler string from step 1 |
| `CRON_SECRET` | any long random text, e.g. `bb-7f3k9q2m8x1z5w4v` |
| `GMAIL_SCRIPT_URL` | your Apps Script web app URL (same as Chronos) |
| `GMAIL_SCRIPT_SECRET` | the secret in that script |
| `NODE_ENV` | `production` |

4. Click **Deploy**. When it's done, open the site and sign up.
5. Check it: open `https://<your-site>.vercel.app/api/health` – you should see `"db":"postgres"` and `"email":"apps-script"`.

Later changes: just push to GitHub – Vercel redeploys by itself.

### How the background jobs run
Reminders, auction endings, expiring requests and badge checks run:
- once a day at about 9:15 AM India time by **Vercel Cron** (set in `vercel.json`) – this also keeps the free Supabase project from pausing,
- every 5 minutes while people are using the site,
- and an auction closes the moment anyone opens the giveaways after its end time.

Optional, for exact timing even when nobody is using the site: create a free job at [cron-job.org](https://cron-job.org) that calls
`https://<your-site>.vercel.app/api/cron?key=<CRON_SECRET>` every 5 minutes.

### Free plan limits (for a college group)
- **Supabase Free:** 500 MB database (lots of room – there are no photos), 2 free projects. A project with **no activity for 7 days is paused**; the daily cron prevents that. If it ever pauses, open the Supabase dashboard and click **Restore**.
- **Vercel Hobby:** 1,000,000 function calls and 4 CPU-hours a month, personal / non-commercial use. Plenty for a class or hostel.

## Run on your computer

Needs Node 20 or newer.

```bash
npm run install:all
npm run build        # builds the website once
npm run dev          # http://localhost:4000 (API + website)
npm run dev:client   # optional: website with hot reload on http://localhost:5173
```

Without `DATABASE_URL`, a local Postgres (PGlite) is stored in `server/data/pglite`. Without the email settings, the login code is printed in the terminal and shown on screen.

## Project layout

```
api/index.js          Vercel function – hands every /api request to the Express app
server/app.js         Express app (all API routes)
server/db.js          Postgres connection (Supabase) / local PGlite, creates tables
server/schema.sql     database tables
server/routes/        auth, circles, items, borrows, community (wanted + skills), giveaways, reports, misc, things
server/lib/           mailer (Apps Script), notify, badges, jobs, access checks, utils
server/local.js       local dev server
client/               React website (Vite)
vercel.json           build, rewrites, daily cron, Mumbai region
gmail-sender.gs       Google Apps Script email sender
```
