create table if not exists public.gyne_task_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  task_id text not null,
  attempt integer not null default 1,
  title text not null default '',
  prompt text not null default '',
  spec text not null default '',
  done_when jsonb not null default '[]'::jsonb,
  output text,
  verdict jsonb,
  human_action text,
  human_feedback text,
  consumer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gyne_task_attempts_card_id_nonempty check (trim(card_id) <> ''),
  constraint gyne_task_attempts_task_id_nonempty check (trim(task_id) <> ''),
  constraint gyne_task_attempts_attempt_positive check (attempt > 0),
  constraint gyne_task_attempts_human_action_check check (
    human_action is null or human_action in ('approved', 'rejected')
  ),
  unique (user_id, task_id)
);

create index if not exists gyne_task_attempts_user_card_idx
  on public.gyne_task_attempts(user_id, card_id, attempt);

alter table public.gyne_task_attempts enable row level security;

drop policy if exists gyne_task_attempts_select_own on public.gyne_task_attempts;
create policy gyne_task_attempts_select_own
  on public.gyne_task_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists set_gyne_task_attempts_updated_at on public.gyne_task_attempts;
create trigger set_gyne_task_attempts_updated_at
  before update on public.gyne_task_attempts
  for each row execute function public.set_updated_at();

comment on table public.gyne_task_attempts is
  'Durable history of Gyne Agent task attempts (one row per published attempt, idempotent on user_id+task_id). Written server-side (service role) by the gyne bridge routes; the Gyne publisher forwards browser requests with the shared bridge secret.';

create table if not exists public.gyne_evals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  criterion text not null,
  rationale text,
  match_tags text[] not null default '{}',
  match_keywords text[] not null default '{}',
  source_card_id text,
  source_task_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gyne_evals_criterion_nonempty check (trim(criterion) <> '')
);

create index if not exists gyne_evals_user_active_idx
  on public.gyne_evals(user_id, active);

alter table public.gyne_evals enable row level security;

drop policy if exists gyne_evals_select_own on public.gyne_evals;
create policy gyne_evals_select_own
  on public.gyne_evals
  for select
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists set_gyne_evals_updated_at on public.gyne_evals;
create trigger set_gyne_evals_updated_at
  before update on public.gyne_evals
  for each row execute function public.set_updated_at();

comment on table public.gyne_evals is
  'Reusable acceptance criteria (evals) promoted from failed/rejected Gyne attempts. Matched at publish time by tag overlap or keyword-in-title/prompt and merged into the card''s done-when criteria.';
