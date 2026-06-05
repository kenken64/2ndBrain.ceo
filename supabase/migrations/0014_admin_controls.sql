alter table public.profiles
  add column if not exists admin_disabled boolean not null default false,
  add column if not exists admin_deleted_at timestamptz,
  add column if not exists llm_token_quota bigint not null default 0,
  add column if not exists llm_token_used bigint not null default 0,
  add column if not exists openclaw_instance_created_count integer not null default 0,
  add column if not exists bedrock_token_updated_at timestamptz,
  add column if not exists bedrock_token_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists bedrock_token_last4 text;

alter table public.profiles
  drop constraint if exists profiles_llm_token_quota_nonnegative,
  drop constraint if exists profiles_llm_token_used_nonnegative;

alter table public.profiles
  add constraint profiles_llm_token_quota_nonnegative check (llm_token_quota >= 0),
  add constraint profiles_llm_token_used_nonnegative check (llm_token_used >= 0);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null unique,
  enabled boolean not null default true,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_email_lowercase check (email = lower(email)),
  constraint admin_users_role_check check (role in ('admin'))
);

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text,
  action text not null,
  status text not null default 'success',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_events_status_check check (status in ('success', 'failed'))
);

alter table public.admin_users enable row level security;
alter table public.admin_audit_events enable row level security;

drop trigger if exists set_admin_users_updated_at on public.admin_users;
create trigger set_admin_users_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();

create or replace function public.track_openclaw_instance_created()
returns trigger
language plpgsql
as $$
begin
  if new.openclaw_instance is not null
    and trim(new.openclaw_instance) <> ''
    and (old.openclaw_instance is null or trim(old.openclaw_instance) = '')
  then
    new.openclaw_instance_created_count = coalesce(old.openclaw_instance_created_count, 0) + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists track_openclaw_instance_created on public.profiles;
create trigger track_openclaw_instance_created
  before update on public.profiles
  for each row execute function public.track_openclaw_instance_created();

comment on table public.admin_users is
  'Server-side admin allowlist loaded by scripts and accessed by the app through the service role.';

comment on table public.admin_audit_events is
  'Append-only log for admin actions such as quota changes, access disablement, deletion, and Bedrock token overwrites.';

comment on column public.profiles.admin_disabled is
  'When true, the user is blocked from protected app access by the Next.js proxy.';

comment on column public.profiles.llm_token_quota is
  'Admin-assigned LLM token budget for this user.';

comment on column public.profiles.llm_token_used is
  'Tracked or estimated LLM token usage consumed by this user.';

comment on column public.profiles.openclaw_instance_created_count is
  'Number of AI Agent/OpenClaw instance creation events for this profile.';

revoke update on public.profiles from authenticated;

grant update (
  avatar_completed_at,
  avatar_gender,
  avatar_glb_bytes,
  avatar_glb_downloaded_at,
  avatar_glb_path,
  avatar_name,
  avatar_url,
  avaturn_avatar_payload,
  avaturn_avatar_url,
  email,
  enrolment_completed_at,
  full_name,
  google_workspace_enabled,
  onboarding_completed_at,
  openclaw_gateway_completed_at,
  openclaw_gateway_output,
  openclaw_gateway_url,
  openclaw_hooks_completed_at,
  openclaw_hooks_output,
  openclaw_identity_completed_at,
  openclaw_identity_error,
  openclaw_identity_output,
  openclaw_instance,
  openclaw_provision_completed_at,
  openclaw_provision_error,
  openclaw_provision_output,
  openclaw_provision_started_at,
  openclaw_provision_status,
  openclaw_region,
  openclaw_remotion_completed_at,
  openclaw_remotion_output,
  openclaw_remotion_url,
  openclaw_snapshot_name,
  openclaw_telegram_output,
  openclaw_telegram_pair_completed_at,
  openclaw_telegram_pair_error,
  openclaw_telegram_pair_output,
  openclaw_telegram_pair_started_at,
  openclaw_telegram_pair_status,
  owner_name,
  profile_name,
  provision_target,
  telegram_bot_token
) on public.profiles to authenticated;
