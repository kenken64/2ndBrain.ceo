alter table public.openclaw_instances
  add column if not exists agent_type text not null default 'openclaw';

alter table public.openclaw_instances
  drop constraint if exists openclaw_instances_agent_type_check;
alter table public.openclaw_instances
  add constraint openclaw_instances_agent_type_check
  check (agent_type in ('openclaw', 'hermes_agent'));

-- The service role alone can read these credentials; browser clients only see
-- the non-secret instance metadata through openclaw_instances RLS.
create table if not exists public.agent_instance_secrets (
  instance_id uuid primary key references public.openclaw_instances(id) on delete cascade,
  telegram_bot_token text not null
);
alter table public.agent_instance_secrets enable row level security;
