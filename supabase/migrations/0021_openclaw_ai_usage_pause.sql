alter table public.profiles
  add column if not exists openclaw_tokens_paused boolean not null default false,
  add column if not exists openclaw_tokens_paused_at timestamptz,
  add column if not exists openclaw_tokens_resumed_at timestamptz,
  add column if not exists openclaw_tokens_pause_reason text,
  add column if not exists openclaw_tokens_pause_actor_id uuid references auth.users(id) on delete set null,
  add column if not exists openclaw_tokens_pause_actor_email text;

create index if not exists profiles_openclaw_tokens_paused_idx
  on public.profiles(openclaw_tokens_paused, openclaw_tokens_paused_at desc)
  where openclaw_tokens_paused = true;

comment on column public.profiles.openclaw_tokens_paused is
  'When true, 2ndBrain and ttyproxy should block new OpenClaw AI/model calls without changing the user AI credit balance.';

comment on column public.profiles.openclaw_tokens_paused_at is
  'Timestamp of the latest OpenClaw AI usage pause.';

comment on column public.profiles.openclaw_tokens_resumed_at is
  'Timestamp of the latest OpenClaw AI usage resume.';

comment on column public.profiles.openclaw_tokens_pause_reason is
  'Current pause reason while paused; null after resume.';

comment on column public.profiles.openclaw_tokens_pause_actor_id is
  'User id that last paused or resumed OpenClaw AI usage.';

comment on column public.profiles.openclaw_tokens_pause_actor_email is
  'Email for the user that last paused or resumed OpenClaw AI usage.';
