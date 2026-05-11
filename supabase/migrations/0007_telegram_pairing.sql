alter table public.profiles
  add column if not exists openclaw_telegram_pair_status text,
  add column if not exists openclaw_telegram_pair_output text,
  add column if not exists openclaw_telegram_pair_error text,
  add column if not exists openclaw_telegram_pair_started_at timestamptz,
  add column if not exists openclaw_telegram_pair_completed_at timestamptz;
