-- BorrowBox database (PostgreSQL / Supabase).
-- The app creates these tables by itself the first time it runs.
-- You can also paste this whole file into Supabase → SQL Editor → Run.
-- Times are milliseconds since 1970 (UTC); dates are 'YYYY-MM-DD' (India time).

CREATE TABLE IF NOT EXISTS app_meta (
  name TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  room_no TEXT,
  email_borrow INTEGER NOT NULL DEFAULT 1,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  email_urgent INTEGER NOT NULL DEFAULT 1,
  email_auctions INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  name TEXT,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_hits (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_hits ON auth_hits(ip, at);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS circles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  invite_code TEXT NOT NULL UNIQUE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
  id BIGSERIAL PRIMARY KEY,
  circle_id BIGINT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at BIGINT NOT NULL,
  UNIQUE (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON circle_members(user_id);

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  circle_id BIGINT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  owner_id BIGINT REFERENCES users(id),
  is_shared INTEGER NOT NULL DEFAULT 0,
  listing_type TEXT NOT NULL DEFAULT 'lend',
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL,
  condition_notes TEXT,
  description TEXT,
  max_days INTEGER NOT NULL DEFAULT 7,
  rules TEXT,
  trusted_only INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  needs_review INTEGER NOT NULL DEFAULT 0,
  available_since BIGINT,
  qr_token TEXT NOT NULL UNIQUE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  removed_by BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_circle ON items(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_id);

CREATE TABLE IF NOT EXISTS borrows (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  circle_id BIGINT NOT NULL,
  borrower_id BIGINT NOT NULL REFERENCES users(id),
  lender_id BIGINT REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  original_end_date TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  counter_start TEXT,
  counter_end TEXT,
  decline_reason TEXT,
  wanted_id BIGINT,
  handover_borrower_at BIGINT,
  handover_lender_at BIGINT,
  handover_video INTEGER NOT NULL DEFAULT 0,
  handover_checked INTEGER NOT NULL DEFAULT 0,
  handover_condition TEXT,
  handover_note TEXT,
  return_borrower_at BIGINT,
  return_lender_at BIGINT,
  return_condition TEXT,
  return_note TEXT,
  returned_on_time INTEGER,
  remind_before_sent INTEGER NOT NULL DEFAULT 0,
  remind_due_sent INTEGER NOT NULL DEFAULT 0,
  overdue_reminders INTEGER NOT NULL DEFAULT 0,
  last_overdue_reminder TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_borrows_item ON borrows(item_id, status);
CREATE INDEX IF NOT EXISTS idx_borrows_due ON borrows(end_date, status);
CREATE INDEX IF NOT EXISTS idx_borrows_borrower ON borrows(borrower_id);

CREATE TABLE IF NOT EXISTS extensions (
  id BIGSERIAL PRIMARY KEY,
  borrow_id BIGINT NOT NULL REFERENCES borrows(id) ON DELETE CASCADE,
  requested_end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  notified_at BIGINT,
  UNIQUE (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id BIGSERIAL PRIMARY KEY,
  circle_id BIGINT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  availability_note TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_requests (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  requester_id BIGINT NOT NULL REFERENCES users(id),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaways (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  start_price INTEGER,
  ends_at BIGINT,
  status TEXT NOT NULL DEFAULT 'open',
  winner_id BIGINT REFERENCES users(id),
  final_price INTEGER,
  given_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaways_end ON giveaways(ends_at, status);

CREATE TABLE IF NOT EXISTS bids (
  id BIGSERIAL PRIMARY KEY,
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS giveaway_interest (
  id BIGSERIAL PRIMARY KEY,
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  note TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS wanted_posts (
  id BIGSERIAL PRIMARY KEY,
  circle_id BIGINT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  details TEXT,
  needed_by TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS wanted_offers (
  id BIGSERIAL PRIMARY KEY,
  wanted_id BIGINT NOT NULL REFERENCES wanted_posts(id) ON DELETE CASCADE,
  offered_by BIGINT NOT NULL REFERENCES users(id),
  item_id BIGINT NOT NULL,
  borrow_id BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  thread_type TEXT NOT NULL,
  thread_id BIGINT NOT NULL,
  sender_id BIGINT,
  body TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages ON messages(thread_type, thread_id, id);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  borrow_id BIGINT NOT NULL REFERENCES borrows(id) ON DELETE CASCADE,
  circle_id BIGINT NOT NULL,
  reported_by BIGINT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  agreed_fix TEXT,
  agreed_note TEXT,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT,
  resolved_by BIGINT
);

CREATE TABLE IF NOT EXISTS report_fixes (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  proposed_by BIGINT NOT NULL REFERENCES users(id),
  fix TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS thank_you_notes (
  id BIGSERIAL PRIMARY KEY,
  from_user BIGINT NOT NULL REFERENCES users(id),
  to_user BIGINT NOT NULL REFERENCES users(id),
  thread_type TEXT NOT NULL,
  thread_id BIGINT NOT NULL,
  message TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  UNIQUE (from_user, thread_type, thread_id)
);

CREATE TABLE IF NOT EXISTS user_badges (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  earned_at BIGINT NOT NULL,
  lost_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_badges ON user_badges(user_id, badge);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id BIGINT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications ON notifications(user_id, read_at);

-- "My things": a private list of everything a person owns (only they can see it)
CREATE TABLE IF NOT EXISTS my_things (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  shared_item_id BIGINT REFERENCES items(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_my_things_user ON my_things(user_id, category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_my_things_item ON my_things(shared_item_id) WHERE shared_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_state (
  name TEXT PRIMARY KEY,
  value TEXT
);

-- Lock the tables from Supabase's public REST API. The app connects directly
-- with the database password, which is not affected by these rules.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
