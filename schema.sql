-- ============================================================
--  BUDGETFLOW — SUPABASE SCHEMA
--  Run this once in the Supabase SQL editor after creating
--  your project. Paste the whole file and click Run.
-- ============================================================

-- Enable Row Level Security everywhere
-- (users can only see and edit their own data)

-- ── PROFILES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text,
  full_name         text,
  whatsapp          text,
  callmebot_key     text,
  income            numeric DEFAULT 55000,
  payday_date       integer DEFAULT 1,
  reminder_day      text DEFAULT 'Saturday',
  chase_every_days  integer DEFAULT 2,
  plan              jsonb,
  plan_configured   boolean DEFAULT false,
  last_active       timestamptz,
  created_at        timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile"
  ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ── ACTUALS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actuals (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month_id    text NOT NULL,         -- e.g. '2026-08'
  line_name   text NOT NULL,
  added       numeric DEFAULT 0,
  reason      text DEFAULT '',
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, month_id, line_name)
);
ALTER TABLE actuals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own actuals"
  ON actuals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── MONTH NOTES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS month_notes (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month_id  text NOT NULL,
  note      text DEFAULT '',
  UNIQUE(user_id, month_id)
);
ALTER TABLE month_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notes"
  ON month_notes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── REMINDER LOG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_log (
  id        bigserial PRIMARY KEY,
  user_id   uuid REFERENCES profiles(id) ON DELETE CASCADE,
  month_id  text,
  channel   text,    -- 'email' or 'whatsapp'
  message   text,
  sent_at   timestamptz DEFAULT now()
);
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own reminder log"
  ON reminder_log FOR SELECT USING (auth.uid() = user_id);
-- Reminder bot writes using service role key (bypasses RLS)

-- ── SERVICE ROLE READ (for reminder bot) ─────────────────────
-- The GitHub Actions reminder script uses the SERVICE_ROLE key
-- which bypasses RLS, so it can read all users' payday dates.
-- This is safe — the key is stored in GitHub Secrets, never
-- exposed in the browser.

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS actuals_user_month ON actuals(user_id, month_id);
CREATE INDEX IF NOT EXISTS log_user ON reminder_log(user_id);
CREATE INDEX IF NOT EXISTS profiles_payday ON profiles(payday_date);
