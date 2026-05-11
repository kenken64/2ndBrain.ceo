alter table public.profiles
  add column if not exists openclaw_remotion_output text,
  add column if not exists openclaw_remotion_url text,
  add column if not exists openclaw_remotion_completed_at timestamptz,
  add column if not exists openclaw_hooks_output text,
  add column if not exists openclaw_hooks_completed_at timestamptz;

alter table public.projects
  add column if not exists openclaw_instance text,
  add column if not exists openclaw_project_slug text,
  add column if not exists openclaw_generation_mapping text,
  add column if not exists openclaw_generation_prompt text,
  add column if not exists openclaw_generation_output text,
  add column if not exists openclaw_generation_error text,
  add column if not exists openclaw_generation_started_at timestamptz,
  add column if not exists openclaw_generation_completed_at timestamptz;

alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('draft', 'running', 'ready', 'failed', 'archived'));
