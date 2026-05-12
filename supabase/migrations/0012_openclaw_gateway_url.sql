alter table public.profiles
  add column if not exists openclaw_gateway_url text,
  add column if not exists openclaw_gateway_output text,
  add column if not exists openclaw_gateway_completed_at timestamptz;
