alter table public.profiles
  add column if not exists openclaw_identity_completed_at timestamptz,
  add column if not exists openclaw_identity_error text;
