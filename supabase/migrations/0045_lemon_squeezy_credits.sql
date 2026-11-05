-- Server-owned checkout intents bind a single verified Lemon Squeezy order to a user.
create table if not exists public.lemon_credit_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null,
  variant_id text not null,
  test_mode boolean not null,
  package_tokens bigint not null check (package_tokens > 0),
  usd_amount_cents integer not null check (usd_amount_cents > 0),
  order_id text unique,
  total_usd_cents bigint check (total_usd_cents > 0),
  refunded_usd_cents bigint not null default 0 check (refunded_usd_cents >= 0),
  credited_tokens bigint not null default 0 check (credited_tokens >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'partial_refund', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lemon_credit_checkouts_user_created_idx on public.lemon_credit_checkouts(user_id, created_at desc);
alter table public.lemon_credit_checkouts enable row level security;
revoke all on public.lemon_credit_checkouts from public, anon, authenticated;
grant select, insert, update on public.lemon_credit_checkouts to service_role;

-- Only authenticated webhooks may call this through the trusted server.
-- Locks match the profile-first order used by chat reservations and transfers.
create or replace function public.apply_lemon_credit_order(
  p_intent_id uuid, p_order_id text, p_store_id text, p_variant_id text,
  p_test_mode boolean, p_subtotal_usd bigint, p_discount_usd bigint,
  p_total_usd bigint, p_refunded_usd bigint
) returns table(user_id uuid, llm_token_quota bigint, llm_token_used bigint, delta_tokens bigint, order_status text)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_profile public.profiles%rowtype;
  v_intent public.lemon_credit_checkouts%rowtype;
  v_refund bigint;
  v_target bigint;
  v_delta bigint;
  v_status text;
begin
  if p_intent_id is null or p_order_id is null or p_order_id !~ '^[0-9]{1,30}$' or p_test_mode is null
     or p_total_usd is null or p_total_usd <= 0 or p_refunded_usd is null or p_refunded_usd < 0 or p_refunded_usd > p_total_usd then
    raise exception 'invalid_lemon_order';
  end if;
  select c.user_id into v_user_id from public.lemon_credit_checkouts c where c.id = p_intent_id;
  if not found then raise exception 'lemon_intent_not_found'; end if;
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  select * into v_intent from public.lemon_credit_checkouts where id = p_intent_id for update;
  if v_intent.store_id <> p_store_id or v_intent.variant_id <> p_variant_id or v_intent.test_mode <> p_test_mode
     or p_subtotal_usd is distinct from v_intent.usd_amount_cents or p_discount_usd is distinct from 0::bigint
     or p_total_usd < p_subtotal_usd then
    raise exception 'lemon_order_mismatch';
  end if;
  if v_intent.order_id is not null and v_intent.order_id <> p_order_id then raise exception 'lemon_intent_already_used'; end if;
  if v_intent.total_usd_cents is not null and v_intent.total_usd_cents <> p_total_usd then raise exception 'lemon_order_mismatch'; end if;
  v_refund := greatest(v_intent.refunded_usd_cents, p_refunded_usd);
  v_target := v_intent.package_tokens - ceil(v_intent.package_tokens::numeric * v_refund / p_total_usd)::bigint;
  v_delta := v_target - v_intent.credited_tokens;
  v_status := case when v_refund = p_total_usd then 'refunded' when v_refund > 0 then 'partial_refund' else 'paid' end;
  if v_delta > 0 then
    update public.profiles set llm_token_quota = profiles.llm_token_quota + v_delta where id = v_user_id returning * into v_profile;
  elsif v_delta < 0 then
    -- Used credits may already have been spent or transferred. A refund can put
    -- the account into a credit deficit, recovered by future top-ups.
    update public.profiles set
      llm_token_quota = greatest(0::bigint, profiles.llm_token_quota + v_delta),
      llm_token_used = profiles.llm_token_used + greatest(0::bigint, -v_delta - profiles.llm_token_quota)
      where id = v_user_id returning * into v_profile;
  end if;
  update public.lemon_credit_checkouts set order_id = p_order_id, total_usd_cents = p_total_usd,
    refunded_usd_cents = v_refund, credited_tokens = v_target, status = v_status, updated_at = now() where id = p_intent_id;
  if v_delta <> 0 then
    insert into public.credit_ledger(user_id, delta_tokens, balance_after, reason, metadata)
    values (v_user_id, v_delta, greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used),
      case when v_delta > 0 then 'lemon_credit_purchase' else 'lemon_credit_refund' end,
      jsonb_build_object('intent_id', p_intent_id, 'order_id', p_order_id, 'total_usd_cents', p_total_usd, 'refunded_usd_cents', v_refund, 'test_mode', p_test_mode));
  end if;
  return query select v_user_id, v_profile.llm_token_quota, v_profile.llm_token_used, v_delta, v_status;
end;
$$;
revoke all on function public.apply_lemon_credit_order(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.apply_lemon_credit_order(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint) to service_role;
