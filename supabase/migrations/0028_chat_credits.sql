create table if not exists public.chat_credit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_id text not null,
  reserved_credits bigint not null check (reserved_credits >= 0),
  charged_credits bigint check (charged_credits >= 0),
  cost_usd numeric check (cost_usd >= 0),
  provider_request_id text,
  quota_exempt boolean not null default false,
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed', 'uncertain')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists chat_credit_requests_user_created_idx on public.chat_credit_requests(user_id, created_at desc);
alter table public.chat_credit_requests enable row level security;
drop policy if exists chat_credit_requests_select_own on public.chat_credit_requests;
create policy chat_credit_requests_select_own on public.chat_credit_requests for select to authenticated using (auth.uid() = user_id);

-- Only the trusted server may reserve or settle credits. Profile locks make
-- reservations atomic with transfers, marketplace purchases and other requests.
create or replace function public.reserve_chat_credits(p_user_id uuid, p_model_id text, p_credits bigint, p_is_admin boolean)
returns table(request_id uuid, llm_token_quota bigint, llm_token_used bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_request_id uuid;
  v_exempt boolean := coalesce(p_is_admin, false);
begin
  if p_user_id is null or nullif(trim(p_model_id), '') is null or p_credits is null or p_credits <= 0 then
    raise exception 'invalid_chat_reservation';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if coalesce(v_profile.admin_disabled, false) or v_profile.admin_deleted_at is not null then
    raise exception 'account_disabled';
  end if;
  -- A crashed server cannot hold an in-flight slot indefinitely. Its credit
  -- reservation remains charged until an operator reconciles the request.
  update public.chat_credit_requests set status = 'uncertain', finished_at = now()
    where user_id = p_user_id and status = 'reserved' and created_at < now() - interval '10 minutes';
  if (select count(*) from public.chat_credit_requests where user_id = p_user_id and status = 'reserved') >= 3 then
    raise exception 'too_many_chat_requests';
  end if;
  if not v_exempt and v_profile.llm_token_quota - v_profile.llm_token_used < p_credits then
    raise exception 'insufficient_ai_credits';
  end if;
  if not v_exempt then
    update public.profiles set llm_token_used = profiles.llm_token_used + p_credits where id = p_user_id
      returning profiles.llm_token_quota, profiles.llm_token_used into v_profile.llm_token_quota, v_profile.llm_token_used;
  end if;
  insert into public.chat_credit_requests(user_id, model_id, reserved_credits, quota_exempt)
    values (p_user_id, p_model_id, case when v_exempt then 0 else p_credits end, v_exempt)
    returning id into v_request_id;
  return query select v_request_id, v_profile.llm_token_quota, v_profile.llm_token_used;
end;
$$;

create or replace function public.settle_chat_credits(p_user_id uuid, p_request_id uuid, p_status text, p_actual_credits bigint, p_cost_usd numeric, p_provider_request_id text)
returns table(llm_token_quota bigint, llm_token_used bigint, charged_credits bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_request public.chat_credit_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_charge bigint;
  v_prior bigint;
  v_ledger_delta bigint;
begin
  if p_status is null or p_status not in ('completed', 'failed', 'uncertain') or p_actual_credits is null or p_actual_credits < 0 then
    raise exception 'invalid_chat_settlement';
  end if;
  -- Lock the profile before the request to match reservation lock order.
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  select * into v_request from public.chat_credit_requests where id = p_request_id and user_id = p_user_id for update;
  if not found or (v_request.status <> 'reserved' and not (v_request.status = 'uncertain' and p_status in ('completed', 'failed'))) then
    raise exception 'chat_request_not_reserved';
  end if;
  v_prior := coalesce(v_request.charged_credits, v_request.reserved_credits);
  v_charge := case when v_request.quota_exempt then 0 when p_status = 'uncertain' then v_request.reserved_credits when p_status = 'failed' then 0 else p_actual_credits end;
  if not v_request.quota_exempt then
    update public.profiles set llm_token_used = greatest(0, profiles.llm_token_used - v_prior + v_charge)
      where id = p_user_id returning profiles.llm_token_quota, profiles.llm_token_used into v_profile.llm_token_quota, v_profile.llm_token_used;
  end if;
  update public.chat_credit_requests set status = p_status, charged_credits = v_charge,
    cost_usd = p_cost_usd, provider_request_id = left(p_provider_request_id, 200), finished_at = now() where id = p_request_id;
  v_ledger_delta := case when v_request.charged_credits is null then -v_charge else v_prior - v_charge end;
  if v_ledger_delta <> 0 then
    insert into public.credit_ledger(user_id, delta_tokens, balance_after, reason, metadata)
    values (p_user_id, v_ledger_delta, greatest(0, v_profile.llm_token_quota - v_profile.llm_token_used), 'chat_usage',
      jsonb_build_object('request_id', p_request_id, 'model', v_request.model_id, 'status', p_status, 'cost_usd', p_cost_usd));
  end if;
  return query select v_profile.llm_token_quota, v_profile.llm_token_used, v_charge;
end;
$$;

revoke all on function public.reserve_chat_credits(uuid, text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.settle_chat_credits(uuid, uuid, text, bigint, numeric, text) from public, anon, authenticated;
grant execute on function public.reserve_chat_credits(uuid, text, bigint, boolean) to service_role;
grant execute on function public.settle_chat_credits(uuid, uuid, text, bigint, numeric, text) to service_role;
