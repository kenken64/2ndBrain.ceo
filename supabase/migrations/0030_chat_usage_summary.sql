-- The invoker and explicit auth.uid filter keep this aggregate user-scoped.
create or replace function public.current_user_chat_usage_summary()
returns table (
  request_kind text,
  completed_count bigint,
  completed_credits numeric,
  provider_cost_usd numeric,
  prompt_tokens numeric,
  completion_tokens numeric,
  pending_count bigint,
  held_credits numeric,
  failed_count bigint
)
language sql stable security invoker set search_path = public as $$
  select r.request_kind,
    count(*) filter (where r.status = 'completed'),
    coalesce(sum(r.charged_credits) filter (where r.status = 'completed'), 0),
    sum(r.cost_usd) filter (where r.status = 'completed'),
    sum(r.prompt_tokens) filter (where r.status = 'completed'),
    sum(r.completion_tokens) filter (where r.status = 'completed'),
    count(*) filter (where r.status in ('reserved', 'uncertain')),
    coalesce(sum(coalesce(r.charged_credits, r.reserved_credits)) filter (where r.status in ('reserved', 'uncertain')), 0),
    count(*) filter (where r.status = 'failed')
  from public.chat_credit_requests r
  where r.user_id = auth.uid()
  group by r.request_kind
  order by r.request_kind;
$$;
revoke all on function public.current_user_chat_usage_summary() from public, anon;
grant execute on function public.current_user_chat_usage_summary() to authenticated;
