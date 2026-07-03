alter table public.wiki_pages
  add column if not exists content_text text;

-- Full-text search over title/summary/body. content_text is capped inside the expression so a
-- pathologically large page cannot overflow the tsvector size limit.
alter table public.wiki_pages
  add column if not exists search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(content_text, ''), 100000)), 'C')
  ) stored;

create index if not exists wiki_pages_search_idx
  on public.wiki_pages using gin (search);

-- Owner-scoped wiki search used by the Gyne context bridge (called via rpc with the service
-- role, which passes the launching user's id explicitly). Invoker rights: when called by an
-- authenticated user instead, RLS still restricts rows to their own pages.
create or replace function public.gyne_search_wiki(
  p_user_id uuid,
  p_query text,
  p_limit integer default 3
)
returns table (
  title text,
  file_path text,
  snippet text,
  rank real
)
language sql
stable
as $$
  select
    p.title,
    p.file_path,
    ts_headline(
      'english',
      left(coalesce(p.content_text, p.summary, ''), 20000),
      websearch_to_tsquery('english', p_query),
      'StartSel=**, StopSel=**, MaxFragments=2, MaxWords=40, MinWords=10'
    ) as snippet,
    ts_rank(p.search, websearch_to_tsquery('english', p_query)) as rank
  from public.wiki_pages p
  where p.user_id = p_user_id
    and p.search @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;
