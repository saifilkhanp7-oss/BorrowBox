# BorrowBox – Spec

A sharing app for small groups (hostel, college class, apartment, office, friends).
People borrow things from each other instead of buying, and the app keeps track of everything so nothing gets lost and nobody feels awkward to ask.

**Not in this app:** statistics, charts, dashboards, AI analyst, fines, payments, photo uploads.

**Version 2 (this spec):** runs on **Vercel + Supabase**. Photo uploads are removed: people are reminded to take a video before giving an item and to check it before taking it, and must tick both at handover. New **Businessperson** badge.

---

## 1. Tech stack

| Part | Choice |
|---|---|
| Frontend | React (Vite) + React Router, plain CSS with light/dark theme. Built to `client/dist`, served by Vercel's CDN |
| Backend | Node.js + Express, deployed as **one Vercel serverless function** (`api/index.js`) |
| Database | **Supabase Postgres** (free plan) through the Transaction pooler (`pg` driver). Locally: PGlite (Postgres in a file) |
| QR codes | `qrcode` npm package (SVG, nothing stored) |
| Scheduled jobs | Vercel Cron once a day (~9:15 AM IST) + lazy runs every 5 min during normal use + auctions close on read. Optional cron-job.org every 5 min |
| Email | Google Apps Script email sender (HTTP POST), sent in the background with `waitUntil` |
| Chat refresh | Polling every 5 sec while chat is open |
| Region | Vercel functions in Mumbai (`bom1`), Supabase in Mumbai (ap-south-1) |

### Environment variables (Vercel → Settings → Environment Variables)
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
CRON_SECRET=<long random text>
GMAIL_SCRIPT_URL=<Apps Script web app URL>
GMAIL_SCRIPT_SECRET=<same secret as in the script>
NODE_ENV=production
APP_TZ=Asia/Kolkata          (optional)
APP_URL=<custom domain>      (optional, Vercel's production URL is used otherwise)
```
Tables are created automatically on first run (`server/schema.sql`). Row Level Security is switched on for every table so Supabase's public REST API cannot read them; the app connects directly with the database password.

---

## 2. Login (same as your other apps)

- **Sign up:** name + email → 6-digit code sent to email → enter code → account created.
- **Log in:** email → 6-digit code → enter code.
- Code valid 10 minutes, max 5 wrong tries, max 1 new code per 60 sec.
- After first login the device **stays logged in**: server creates a long random session token (stored hashed in DB), sent as an `httpOnly` secure cookie valid 365 days. Each visit refreshes `last_seen_at`.
- Settings page shows "logged in devices" with a log out button for each.

---

## 3. Features

### 3.1 Circles
- Anyone can create a circle (name, short description, e.g. "Hostel Block C").
- Creator becomes **admin**.
- Each circle has an **invite code** (e.g. `BX7-K2Q9`) and an **invite link** (`/join/BX7-K2Q9`). Admin can regenerate the code (old one stops working).
- A user can be in many circles. A circle switcher sits in the top bar.
- **Privacy rule:** every item, wanted post, skill, giveaway, profile and chat is only visible to members of that circle. Every API route checks membership. Non-members get 404 (not 403, so they can't even tell it exists).
- Admin can: remove items, remove members, edit circle name, regenerate invite code, manage shared items, hand admin role to another member.
- A member can leave a circle (only if they have no active borrows in it).
- If a member is removed while they have active borrows, those borrows stay visible to both people until returned/resolved.

### 3.2 Items (things to lend)
Fields:
- Name, category, condition (New / Like new / Good / Used / Worn), description (optional)
- Max days it can be borrowed (1–60)
- Rules / notes (e.g. "handle with care", "pick up from room 204")
- "Only lend to trusted people" switch (see 3.10)
- Status: available / borrowed / paused (owner hides it for a while) / removed
- While an item is lent out, everyone else sees it as **"Unavailable at this moment"** (with the date it is due back).
- **After a return** the item is not shown as available straight away. The owner gets an **"Update condition & share again"** screen: pick the current condition, update the condition notes (for example if it now has a scratch), and press **Share again**. Then it is available in the circle again and the waitlist is notified.

Categories: Books, Electronics & Chargers, Calculators & Stationery, Cycles & Vehicles, Home & Kitchen (iron, kettle), Tools, Sports, Clothes & Formal wear, Games & Fun, Other.

**No photos (v2).** Instead:
- Each category has its own icon and colour (📚 🔌 🧮 🚲 🍳 🔧 🏏 👔 🎲 📦).
- Optional **condition notes** ("small scratch on the back") so nobody is blamed for old damage.
- A message at the bottom of the Share form, on the item page and in giveaways:
  > 📹 **Sharing something?** Take a short video of the item on your phone before you give it (all sides, any scratches). Keep it until the item comes back.
  > 🔍 **Taking something?** Check the item carefully before you take it. If anything is already broken or missing, write it in the chat first.

**Item page shows:** category icon, details, condition notes, rules, owner name + badges, availability calendar, "Request to borrow" button, waitlist button if borrowed, QR code (owner only).

### 3.3 Availability calendar
- Small month calendar on every item page.
- Colours: free / booked (approved or active borrow) / pending request (lighter) / past.
- Borrower picks start + end date on this calendar. Dates longer than max days or overlapping a booked range are blocked.

### 3.4 Borrow flow
```
Requested ──► Approved ──► Handed over (active) ──► Returned
   │  ▲          │                │
   │  │          └─► Cancelled    ├─► Extension requested → approved/rejected
   ▼  │                           └─► Overdue (if past end date)
Declined / Counter-offer (owner suggests other dates → borrower accepts or declines)
```
1. **Request:** borrower picks dates + optional message.
2. **Owner replies:** Approve / Decline (optional reason) / Suggest other dates. Borrower can accept the suggestion or cancel.
3. **Handover:** both confirm in the app. The **owner must tick "I took a video of the item"** (and can add a note about its condition right now). The **borrower must tick "I checked the item and it is as described"**. The confirm buttons stay disabled until the tick is made, and the server also refuses without it. The item's condition + notes at that moment are saved with the borrow. Can also be opened by scanning the item QR (3.13). Borrow becomes **active**; item status → borrowed.
4. **Reminders:** in-app + email to borrower **1 day before** due date and **on** due date (sent 9:00 AM IST). If overdue, a gentle reminder each day for 3 days, then every 3 days. Owner also gets a note on due date.
5. **Extension:** borrower asks for new end date + reason. Owner approves or rejects. Can't extend into another person's booking.
6. **Return:** both press "Confirm return". The owner compares with their video and marks **"Came back fine"** or **"Came back damaged"**, with an optional note. Damaged → asks if they want to open a problem report.
7. Owner updates the condition (and notes) and presses **Share again** → item becomes available → waitlist is notified.

Rules:
- Can't request your own item.
- A borrower can cancel before handover; owner can cancel before handover with a reason.
- Requests not answered in 3 days auto-expire.
- On-time = returned (both confirmed) on or before end date (after extensions).

### 3.5 Chat per borrow
- Every borrow request has its own small chat between borrower and owner (and admin for shared items).
- Text only + system messages ("Owner approved 21–24 Oct", "Handover confirmed").
- No phone numbers needed. Chat is read-only after the borrow is closed.
- Same chat style is used for skill requests and giveaways.

### 3.6 Waitlist
- If an item is borrowed or booked, others can tap "Join waitlist".
- When it comes back, everyone on the list gets notified (first in line first, then others after 12 hours). Joining a waitlist does not reserve the item — they still send a normal request.
- User can leave waitlist anytime.

### 3.7 Skills & favours
- Post things like "I can teach basic guitar", "I can fix laptops", "I'll help move furniture".
- Fields: title, description, when you are usually free (text).
- No photos required.
- Others tap "Ask for this" with a message → poster accepts / declines → chat → mark "Done".
- Done favours count toward the Helpful Neighbour badge.

### 3.8 Giveaway (free and auction)
For things people don't need anymore (great at semester end).
- Giveaway listing uses the same item form (no photos; video reminder shown).
- Two modes, owner chooses:
  - **Free:** members tap "I want this" (with a short note). Owner picks who gets it.
  - **Auction:** owner sets **minimum start price** and **ending date/time**.
    - Bids must be ≥ start price and higher than the current highest bid.
    - Everyone sees the current highest bid and bidder name, and number of bids. Bidders get notified when outbid.
    - Bids can't be taken back.
    - At the ending time the server closes the auction automatically. Highest bidder wins (if two bids are same, the earlier one wins). Winner and owner are notified and a chat opens to arrange pickup.
    - No bids → owner can relist or switch to free.
    - Owner can cancel the auction only if there are no bids.
- After handover owner marks "Given". Item leaves the circle and counts toward Semester Saver badge.
- **Money note (confirmed):** the app is only for deciding who gets the item. It only records bid amounts (₹) and never takes or sends money. Payment is done in person, outside the app. A small line on every auction says this.

### 3.9 Shared items (belong to the whole circle)
- Admin can add items owned by the circle (hostel cricket kit, club projector).
- Same form (no photos).
- Shows "Owned by Hostel Block C" instead of a person.
- Admin approves requests, confirms handover/return, and gets the problem reports.

### 3.10 Trust badges (no fines, no money)
Badges are shown as small icons on profiles and next to names.

| Badge | How to earn | How to lose |
|---|---|---|
| ⏰ On-Time Returner | 3 or more returns, and all of your last 5 returns were on time | Returning late 2 times in your last 5 returns (can be earned back) |
| 🤝 Generous Lender | Lent items 5 or more times (completed borrows) | Never lost |
| 🌱 Helpful Neighbour | Helped 3 or more times by "I have this" on wanted posts or finishing a skill/favour | Never lost |
| 🎓 Semester Saver | Gave away (free or auction) 3 or more items | Never lost |
| 💼 Businessperson | Sold 3 or more items by **auction** in the last 6 months | Lost when fewer than 3 auction sales in the last 6 months (checked daily; can be earned back) |

- Badges are checked after every return / favour / giveaway, and once a night by the scheduler.
- **Trusted-only items:** owner can switch on "Only lend to On-Time Returners" for valuable items. Others see the item but the request button says "Only for On-Time Returners" and is disabled.
- Being late only affects the badge. No fines, no points, no money.

### 3.11 Wanted board
- Post a request: what you need, details, needed by (date), urgent on/off.
- **Urgent** → every circle member gets an in-app notification + email (unless they turned off urgent emails in settings). Limit: 2 urgent posts per person per day.
- Anyone who has it taps **"I have this"** and either picks one of their listed items or quickly adds the item.
- This creates a normal borrow request that is already approved by the owner (because they offered), with dates from today to "needed by". The poster gets notified and can accept or cancel. Then the normal borrow flow continues.
- Poster can mark "Found it" / close the post. Posts auto-close 3 days after "needed by".

### 3.12 Report a problem
From any active or returned borrow: "Report a problem".
- Type: **Lost**, **Damaged**, **Not returned**.
- Description of what happened.
- The report page shows both people the same **condition record** with dates: condition + notes when shared, at handover (with "📹 owner took a video" / "🔍 borrower checked it" ticks and the owner's note), and at return (fine/damaged + note). The owner is asked to share their video (WhatsApp or in person).
- Both people talk in the borrow chat. One proposes a fix: **Repair**, **Replace**, or **Forget it**, with a note. The other person accepts or suggests another fix.
- When both agree, the fix is saved. When the fix is done, the owner marks it **Resolved**.
- Admin can see open reports in their circle and can close one as resolved if both people say it's settled.
- "Not returned" can be opened by the owner only when the borrow is overdue.

### 3.13 QR code for each item
- Each item has a unique QR (encodes `APP_URL/i/<qr_token>`).
- Owner can open "Print QR" → printable label with QR + item name + circle name.
- Scanning (phone camera or in-app scanner page) opens the item page. If there is a borrow waiting for handover/return between the scanner and the owner, it jumps straight to the confirm screen.
- Strangers who scan it see only "This item belongs to a BorrowBox circle" (nothing else).

### 3.14 Thank-you notes
- After a borrow, skill or giveaway is completed, the borrower can leave a short thank-you note (max 200 characters).
- Notes show on the owner's profile (newest first). Owner can hide a note.

### 3.15 My Shelf
One page with tabs:
- **Due soon / Borrowed by me:** active borrows with due date and "Ask extension" / "Return" buttons. Overdue ones on top in red.
- **Lent by me:** my items that are out right now, with who has them and due date.
- **Requests:** incoming requests to answer + my sent requests.
- **My items:** all my listings (edit, pause, print QR).
- **History:** past borrows and lends (simple list, no charts).

### 3.15b My things (private inventory)
A page (`/things`, in the menu and linked from My Shelf) where a person lists **everything they own**, just to keep count. Only they can see it.
- **Counter at the top:** total number of things (quantities count: 3 pens = 3), number of different items, how many are shared in circles, and a chip per category with its count (tap a chip to filter). Plain numbers, no charts.
- **Quick add:** name, category, how many (− / + buttons), optional note. Adding the same name + category again just adds to its count.
- **List** grouped by category, with search. Each row: name, note, − / + counter, Share, Edit, Remove.
- **Share in a circle:** opens the normal Share form already filled in; afterwards the row shows "Shared in <circle> · Available / Lent out now".
- Items a person shares directly are **added to the list automatically**. A shared thing can't be removed from the list until it is removed from the circle.
- Limit 1,000 things per person.

### 3.16 Profile
Only shows: name, room/flat number (optional), badges, thank-you notes, and their items/skills in the current circle. No email, no phone. Profile is only visible to people sharing a circle.

### 3.17 Notifications
- Bell icon in top bar with unread count and list.
- Email also sent for: login code, request received, request approved/declined/counter, reminders, extension reply, urgent wanted, outbid, auction won, waitlist item back, problem report.
- Settings: turn emails on/off per group (borrow updates, reminders, urgent wanted, auctions). Login codes always sent.

### 3.18 Look & feel
- Clean modern design, mobile first (works from 320px wide). Bottom tab bar on phone, side menu on desktop.
- Light / dark toggle icon (☀️ / 🌙) at the top of every page. Remembered on the device; first time follows the phone's setting.
- Big touch buttons, category icons instead of photos, skeleton loaders.

---

## 4. Pages

| Route | Page |
|---|---|
| `/signup` | Sign up (name + email) |
| `/login` | Log in (email) |
| `/verify` | Enter 6-digit code |
| `/` | Home: if no circle → create/join screen. Else current circle feed: recently added items, urgent wanted posts, giveaways ending soon |
| `/circles` | My circles list, create circle, join with code |
| `/circles/new` | Create circle |
| `/join/:code` | Join via invite link |
| `/c/:circleId/items` | Browse items (search, category filter, "available now" filter) |
| `/c/:circleId/items/new` | Add item (video/check message at the bottom) |
| `/items/:id` | Item detail + calendar + request |
| `/items/:id/edit` | Edit item |
| `/items/:id/reshare` | Update condition & share again (after return) |
| `/items/:id/qr` | Printable QR label |
| `/borrows/:id` | Borrow detail: status timeline, dates, chat, handover/return confirm (video/check ticks), condition record, extension, report |
| `/c/:circleId/wanted` | Wanted board |
| `/c/:circleId/wanted/new` | New wanted post |
| `/c/:circleId/skills` | Skills & favours list |
| `/skills/:id` | Skill detail + requests + chat |
| `/c/:circleId/giveaways` | Giveaways (free + auctions) |
| `/giveaways/:id` | Giveaway / auction detail, bid, countdown |
| `/reports/:id` | Problem report with condition record and fix agreement |
| `/shelf` | My Shelf |
| `/u/:userId` | Profile (inside shared circle) |
| `/c/:circleId/admin` | Admin: members, items, shared items, invite code, open reports |
| `/notifications` | All notifications |
| `/scan` | QR scanner |
| `/i/:qrToken` | QR landing (redirects) |
| `/settings` | Name, room no, email settings, devices, theme |

---

## 5. Database tables (PostgreSQL)

Ids are `BIGSERIAL`, times are milliseconds (`BIGINT`, UTC), dates are `YYYY-MM-DD` text (India time). Full definitions: `server/schema.sql`.

**users** – id, name, email (unique), room_no, email_borrow, email_reminders, email_urgent, email_auctions, created_at
**login_codes** – email (PK), code_hash, purpose, name, expires_at, attempts, sent_at
**auth_hits** – id, ip, at (per-network login limit, shared by all serverless instances)
**sessions** – id, user_id, token_hash (unique), device_label, created_at, last_seen_at, expires_at
**circles** – id, name, description, invite_code (unique), created_by, created_at
**circle_members** – id, circle_id, user_id, role, joined_at · unique(circle_id, user_id)
**items** – id, circle_id, owner_id, is_shared, listing_type (lend/giveaway), name, category, condition, **condition_notes**, description, max_days, rules, trusted_only, status, needs_review, available_since, qr_token, created_by, removed_by, created_at, updated_at
**borrows** – id, item_id, circle_id, borrower_id, lender_id, start_date, end_date, original_end_date, message, status, counter_start, counter_end, decline_reason, wanted_id, handover_borrower_at, handover_lender_at, **handover_video**, **handover_checked**, **handover_condition**, **handover_note**, return_borrower_at, return_lender_at, return_condition, **return_note**, returned_on_time, reminder flags, created_at, updated_at
**extensions**, **waitlist**, **skills**, **skill_requests** – as before
**giveaways** – id, item_id, mode, start_price, ends_at, status, winner_id, final_price, **given_at**, created_at
**bids**, **giveaway_interest**, **wanted_posts**, **wanted_offers**, **messages** – as before
**reports** – id, borrow_id, circle_id, reported_by, type, description, status, agreed_fix, agreed_note, created_at, resolved_at, resolved_by
**my_things** – id, user_id, name, category, quantity, note, shared_item_id (link to the item when shared), created_at, updated_at
**report_fixes**, **thank_you_notes**, **user_badges** (badge adds `businessperson`), **notifications**, **job_state**, **app_meta** (schema version)

Removed in v2: `files`, `item_photos`, `borrow_photos`, `report_photos`.

---

## 6. API routes

All under `/api`. All need login except auth routes. Circle routes check membership; admin routes check role.

### Auth
| Method | Route | What |
|---|---|---|
| POST | `/auth/signup` | name, email → send code |
| POST | `/auth/login` | email → send code |
| POST | `/auth/verify` | email, code → create session cookie |
| POST | `/auth/logout` | end this device's session |
| GET | `/auth/me` | current user |
| GET | `/auth/sessions` | my devices |
| DELETE | `/auth/sessions/:id` | log out a device |

### Users
| PATCH | `/users/me` | name, room_no, email settings |
| GET | `/users/:id?circleId=` | profile (only if we share a circle) |
| GET | `/users/:id/notes` | thank-you notes |

### Circles
| GET | `/circles` | my circles |
| POST | `/circles` | create |
| GET | `/circles/:id` | details |
| PATCH | `/circles/:id` | admin: edit |
| POST | `/circles/join` | join with code |
| GET | `/circles/preview/:code` | circle name before joining |
| POST | `/circles/:id/regenerate-code` | admin |
| GET | `/circles/:id/members` | members |
| DELETE | `/circles/:id/members/:userId` | admin: remove member |
| POST | `/circles/:id/transfer-admin` | admin |
| POST | `/circles/:id/leave` | leave |
| GET | `/circles/:id/feed` | home feed |

### Items
| GET | `/circles/:id/items` | list (q, category, available, type) |
| POST | `/circles/:id/items` | create (JSON, no photos), `shared=true` admin only |
| GET | `/items/:id` | details |
| PATCH | `/items/:id` | edit text fields / pause |
| POST | `/items/:id/reshare` | after return: new condition + notes → available again |
| DELETE | `/items/:id` | owner removes, or admin removes |
| GET | `/items/:id/calendar?month=` | booked/pending ranges |
| GET | `/items/:id/qr` | QR PNG/SVG (owner/admin) |
| GET | `/qr/:token` | resolve QR → item id + any pending handover/return |
| POST | `/items/:id/waitlist` | join |
| DELETE | `/items/:id/waitlist` | leave |

### Borrows
| POST | `/items/:id/borrows` | request (start, end, message) |
| GET | `/borrows/:id` | detail with condition record & timeline |
| POST | `/borrows/:id/approve` | owner |
| POST | `/borrows/:id/decline` | owner, reason |
| POST | `/borrows/:id/counter` | owner suggests dates |
| POST | `/borrows/:id/accept-counter` | borrower |
| POST | `/borrows/:id/cancel` | either, before handover |
| POST | `/borrows/:id/handover` | confirm handover (owner: `video_taken: true` + note; borrower: `checked: true`) |
| POST | `/borrows/:id/return` | confirm return (owner: condition + note) |
| POST | `/borrows/:id/extensions` | borrower asks |
| POST | `/extensions/:id/approve` · `/reject` | owner |
| GET | `/borrows/:id/messages?after=` | chat (polling) |
| POST | `/borrows/:id/messages` | send |
| POST | `/borrows/:id/thanks` | thank-you note |

### Shelf
| GET | `/shelf` | due soon, lent out, requests in/out, my items, history |

### Wanted
| GET | `/circles/:id/wanted` | list |
| POST | `/circles/:id/wanted` | create (urgent limit checked) |
| PATCH | `/wanted/:id` | edit / mark found / close |
| POST | `/wanted/:id/offer` | "I have this" (item_id) → creates approved borrow |

### Skills
| GET | `/circles/:id/skills` · POST | list / create |
| PATCH / DELETE | `/skills/:id` | edit / remove |
| POST | `/skills/:id/requests` | ask |
| POST | `/skill-requests/:id/accept` · `/decline` · `/done` · `/cancel` | status changes |
| GET / POST | `/skill-requests/:id/messages` | chat |
| POST | `/skill-requests/:id/thanks` | note |

### Giveaways
| GET | `/circles/:id/giveaways` | list |
| POST | `/circles/:id/giveaways` | create (JSON: item fields, mode, start_price, ends_at) |
| GET | `/giveaways/:id` | detail + bids/interest |
| POST | `/giveaways/:id/bids` | place bid |
| POST | `/giveaways/:id/interest` | free mode "I want this" |
| POST | `/giveaways/:id/pick` | free mode, owner picks user |
| POST | `/giveaways/:id/given` | owner marks handed over |
| POST | `/giveaways/:id/cancel` · `/relist` | owner |
| GET / POST | `/giveaways/:id/messages` | chat (owner + winner) |

### Reports
| POST | `/borrows/:id/reports` | open report (type, description) |
| GET | `/reports/:id` | report with the condition record |
| POST | `/reports/:id/fixes` | propose fix |
| POST | `/report-fixes/:id/accept` · `/reject` | other person |
| POST | `/reports/:id/resolve` | owner (or admin) |
| GET | `/circles/:id/reports` | admin: open reports |

### Notifications
| GET | `/notifications` | list |
| POST | `/notifications/read` | mark all/some read |
| GET | `/notifications/unread-count` | for bell |

### My things
| GET | `/things` | my list + totals (also adds my shared items) |
| POST | `/things` | add (name, category, quantity, note) – same name + category adds to the count |
| PATCH | `/things/:id` | edit / change count |
| DELETE | `/things/:id` | remove (not while shared in a circle) |
| POST | `/circles/:id/items` with `thing_id` | share a thing → links it |

### Health & jobs
| GET | `/health` | database + email status |
| GET | `/cron` | runs the jobs (needs `Authorization: Bearer <CRON_SECRET>` or `?key=`) |

---

## 7. Background jobs

All jobs are safe to run again and from several places at once (each update checks it is still needed).

| Job | What it does |
|---|---|
| Close auctions | Picks the highest bidder when `ends_at` has passed, notifies winner/owner/others |
| Expire requests | Unanswered for 3 days, or approved but never handed over |
| Close old wanted posts | 3 days after "needed by" |
| Waitlist | Everyone else on the waitlist hears 12 h after the first person |
| Reminders | From 9 AM IST: due tomorrow, due today, overdue (daily for 3 days, then every 3 days) |
| Daily | Recheck all badges (incl. Businessperson), clean old codes/sessions/notifications |

**When they run:** Vercel Cron daily at 03:45 UTC (~9:15 AM IST, keeps Supabase awake) · lazily every 5 min while the site is used · auctions also close when the giveaways are opened · optional cron-job.org.

---

## 8. Folder structure
```
borrowbox/
  package.json, vercel.json
  api/index.js            Vercel function → Express app
  server/app.js, db.js, schema.sql, local.js
  server/routes/          auth, circles, items, borrows, community, giveaways, reports, misc
  server/lib/             mailer, notify, badges, jobs, access, util
  client/                 React website
```

---

## 9. Phases

### Phase 1 – Core lending (usable app)
- Email code login, stay logged in, devices list
- Circles: create, invite code/link, join, switch, leave, admin remove member/item, regenerate code
- Items with categories, condition + notes, max days, rules, and the video/check message
- Browse + search + item page
- Availability calendar
- Full borrow flow: request, approve/decline/counter, handover confirm (video + check ticks), return confirm + fine/damaged, cancel, auto-expire
- Extensions
- Chat per borrow (polling)
- Reminders (1 day before, due day, overdue) by email + in-app
- Notifications bell + email settings
- My Shelf
- Profile (name, room no)
- Light/dark toggle, mobile layout, Vercel + Supabase deploy

### Phase 2 – Community features
- Wanted board + urgent notify + "I have this"
- Waitlist
- Skills & favours (with chat)
- Shared circle items (admin managed)
- QR code per item + print label + scanner page + quick handover
- Thank-you notes on profile
- Report a problem (condition record, fix agreement, resolve)

### Phase 3 – Giveaway & trust
- Giveaway: free mode + auction mode (start price, end date, bids, outbid alerts, auto close, winner chat)
- Trust badges (all 5, incl. Businessperson) + losing On-Time Returner / Businessperson
- Trusted-only items

---

## 10. Decisions (confirmed)

1. Auctions: the app is only for deciding who gets the item. Payment happens outside the app.
2. Free giveaway mode is included next to auction.
3. Urgent wanted: max 2 per person per day, emails can be turned off in settings.
4. Badge rules as in 3.10.
5. ~~4 photos required~~ → v2: no photo uploads; video reminder + handover ticks instead.
6. After a return, the owner updates the condition and shares the item again. While lent out it shows "Unavailable at this moment".
7. Deploy on Vercel + Supabase (v2).
8. Businessperson badge: 3+ auction sales in 6 months.
