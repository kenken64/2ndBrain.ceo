create table if not exists public.wiki_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  slug text not null,
  file_path text not null,
  page_type text,
  summary text,
  file_sha text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_path)
);

create table if not exists public.wiki_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  label text not null,
  slug text not null,
  node_type text not null default 'concept',
  summary text,
  source_page_id uuid references public.wiki_pages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists public.wiki_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  from_node_id uuid not null references public.wiki_nodes(id) on delete cascade,
  to_node_id uuid not null references public.wiki_nodes(id) on delete cascade,
  relation text not null default 'links_to',
  weight numeric not null default 1,
  evidence_page_id uuid references public.wiki_pages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, from_node_id, to_node_id, relation, evidence_page_id)
);

create table if not exists public.wiki_page_nodes (
  page_id uuid not null references public.wiki_pages(id) on delete cascade,
  node_id uuid not null references public.wiki_nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  role text not null default 'mentions',
  created_at timestamptz not null default now(),
  primary key (page_id, node_id, role)
);

create table if not exists public.wiki_revisions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.wiki_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  file_path text not null,
  base_sha text,
  next_sha text,
  change_source text not null default 'user',
  created_at timestamptz not null default now()
);

create table if not exists public.wiki_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  file_path text,
  job_type text not null default 'page_sync',
  status text not null default 'queued' check (status in ('queued', 'running', 'ready', 'failed')),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wiki_pages enable row level security;
alter table public.wiki_nodes enable row level security;
alter table public.wiki_edges enable row level security;
alter table public.wiki_page_nodes enable row level security;
alter table public.wiki_revisions enable row level security;
alter table public.wiki_sync_jobs enable row level security;

create policy "Wiki pages are visible to their owner"
  on public.wiki_pages for select using (auth.uid() = user_id);
create policy "Wiki pages are created by their owner"
  on public.wiki_pages for insert with check (auth.uid() = user_id);
create policy "Wiki pages are updated by their owner"
  on public.wiki_pages for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Wiki pages are deleted by their owner"
  on public.wiki_pages for delete using (auth.uid() = user_id);

create policy "Wiki nodes are visible to their owner"
  on public.wiki_nodes for select using (auth.uid() = user_id);
create policy "Wiki nodes are created by their owner"
  on public.wiki_nodes for insert with check (auth.uid() = user_id);
create policy "Wiki nodes are updated by their owner"
  on public.wiki_nodes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Wiki nodes are deleted by their owner"
  on public.wiki_nodes for delete using (auth.uid() = user_id);

create policy "Wiki edges are visible to their owner"
  on public.wiki_edges for select using (auth.uid() = user_id);
create policy "Wiki edges are created by their owner"
  on public.wiki_edges for insert with check (auth.uid() = user_id);
create policy "Wiki edges are updated by their owner"
  on public.wiki_edges for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Wiki edges are deleted by their owner"
  on public.wiki_edges for delete using (auth.uid() = user_id);

create policy "Wiki page nodes are visible to their owner"
  on public.wiki_page_nodes for select using (auth.uid() = user_id);
create policy "Wiki page nodes are created by their owner"
  on public.wiki_page_nodes for insert with check (auth.uid() = user_id);
create policy "Wiki page nodes are deleted by their owner"
  on public.wiki_page_nodes for delete using (auth.uid() = user_id);

create policy "Wiki revisions are visible to their owner"
  on public.wiki_revisions for select using (auth.uid() = user_id);
create policy "Wiki revisions are created by their owner"
  on public.wiki_revisions for insert with check (auth.uid() = user_id);

create policy "Wiki sync jobs are visible to their owner"
  on public.wiki_sync_jobs for select using (auth.uid() = user_id);
create policy "Wiki sync jobs are created by their owner"
  on public.wiki_sync_jobs for insert with check (auth.uid() = user_id);
create policy "Wiki sync jobs are updated by their owner"
  on public.wiki_sync_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_wiki_pages_updated_at on public.wiki_pages;
create trigger set_wiki_pages_updated_at
  before update on public.wiki_pages
  for each row execute function public.set_updated_at();

drop trigger if exists set_wiki_nodes_updated_at on public.wiki_nodes;
create trigger set_wiki_nodes_updated_at
  before update on public.wiki_nodes
  for each row execute function public.set_updated_at();

drop trigger if exists set_wiki_edges_updated_at on public.wiki_edges;
create trigger set_wiki_edges_updated_at
  before update on public.wiki_edges
  for each row execute function public.set_updated_at();

drop trigger if exists set_wiki_sync_jobs_updated_at on public.wiki_sync_jobs;
create trigger set_wiki_sync_jobs_updated_at
  before update on public.wiki_sync_jobs
  for each row execute function public.set_updated_at();
