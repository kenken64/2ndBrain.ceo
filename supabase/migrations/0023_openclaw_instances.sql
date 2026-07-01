create table if not exists public.openclaw_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consumer_name text not null,
  label text,
  instance text,
  region text,
  snapshot_name text,
  provision_status text not null default 'provisioning',
  provision_output text,
  provision_error text,
  provision_started_at timestamptz,
  provision_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint openclaw_instances_consumer_name_nonempty check (trim(consumer_name) <> ''),
  constraint openclaw_instances_status_check check (
    provision_status in ('provisioning', 'ready', 'failed', 'deprovisioning', 'stopped')
  ),
  unique (user_id, consumer_name)
);

create index if not exists openclaw_instances_user_status_idx
  on public.openclaw_instances(user_id, provision_status, created_at desc);

alter table public.openclaw_instances enable row level security;

drop policy if exists openclaw_instances_select_own on public.openclaw_instances;
create policy openclaw_instances_select_own
  on public.openclaw_instances
  for select
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists set_openclaw_instances_updated_at on public.openclaw_instances;
create trigger set_openclaw_instances_updated_at
  before update on public.openclaw_instances
  for each row execute function public.set_updated_at();

comment on table public.openclaw_instances is
  'Per-user provisioned OpenClaw instances. Each row maps a user to one gyne consumer (consumer_name). Writes are server-side (service role) only; the Gyne Agent publisher lists a user''s instances by intersecting the shared Redis owner set openclaw:owners:{user_id} with the live consumer registry.';
