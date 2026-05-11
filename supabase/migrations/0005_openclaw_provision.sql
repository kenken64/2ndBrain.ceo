alter table public.profiles
  add column if not exists avatar_completed_at timestamptz,
  add column if not exists openclaw_instance text,
  add column if not exists openclaw_region text,
  add column if not exists openclaw_snapshot_name text,
  add column if not exists openclaw_provision_status text,
  add column if not exists openclaw_provision_output text,
  add column if not exists openclaw_telegram_output text,
  add column if not exists openclaw_identity_output text,
  add column if not exists openclaw_provision_error text,
  add column if not exists openclaw_provision_started_at timestamptz,
  add column if not exists openclaw_provision_completed_at timestamptz;
