-- Persist asynchronous video jobs so polling can resume without resubmitting.
create table public.chat_video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_request_id uuid not null unique references public.chat_credit_requests(id) on delete cascade,
  provider_job_id text,
  status text not null default 'submitting' check (status in ('submitting','pending','completed','failed','uncertain')),
  output_file_id uuid references public.chat_files(id) on delete set null,
  processing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_video_jobs_user_created_idx on public.chat_video_jobs(user_id, created_at desc);
alter table public.chat_video_jobs enable row level security;
create policy chat_video_jobs_select_own on public.chat_video_jobs for select to authenticated using (auth.uid() = user_id);
revoke all on public.chat_video_jobs from anon, authenticated;
grant select on public.chat_video_jobs to authenticated;
grant select, insert, update, delete on public.chat_video_jobs to service_role;
