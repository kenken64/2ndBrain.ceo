-- Store the exact variant price in its selling currency. Existing USD intents remain valid.
alter table public.lemon_credit_checkouts
  add column if not exists currency text not null default 'USD' check (currency in ('USD', 'SGD')),
  add column if not exists amount_cents integer check (amount_cents > 0),
  add column if not exists total_currency_cents bigint check (total_currency_cents > 0),
  add column if not exists refunded_currency_cents bigint check (refunded_currency_cents >= 0);

-- The daily USD reference amount fixes the credit grant at checkout. Verify SGD
-- payments in SGD; the provider's USD settlement conversion can legitimately differ.
create or replace function public.apply_lemon_credit_order_v2(
  p_intent_id uuid, p_order_id text, p_store_id text, p_variant_id text,
  p_test_mode boolean, p_subtotal_usd bigint, p_discount_usd bigint,
  p_total_usd bigint, p_refunded_usd bigint,
  p_currency text, p_subtotal bigint, p_discount bigint, p_total bigint, p_refunded bigint
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
     or p_currency is null or p_currency not in ('USD', 'SGD')
     or p_subtotal is null or p_subtotal <= 0 or p_discount is distinct from 0::bigint
     or p_total is null or p_total < p_subtotal or p_refunded is null or p_refunded < 0 or p_refunded > p_total
     or p_subtotal_usd is null or p_subtotal_usd <= 0 or p_discount_usd is distinct from 0::bigint
     or p_total_usd is null or p_total_usd < p_subtotal_usd or p_refunded_usd is null or p_refunded_usd < 0 or p_refunded_usd > p_total_usd then
    raise exception 'invalid_lemon_order';
  end if;
  select c.user_id into v_user_id from public.lemon_credit_checkouts c where c.id = p_intent_id;
  if not found then raise exception 'lemon_intent_not_found'; end if;
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  select * into v_intent from public.lemon_credit_checkouts where id = p_intent_id for update;
  if v_intent.store_id is distinct from p_store_id or v_intent.variant_id is distinct from p_variant_id or v_intent.test_mode is distinct from p_test_mode
     or p_currency <> v_intent.currency or p_subtotal is distinct from coalesce(v_intent.amount_cents, v_intent.usd_amount_cents)
     or (p_currency = 'USD' and (p_subtotal <> p_subtotal_usd or p_total <> p_total_usd or p_refunded <> p_refunded_usd)) then
    raise exception 'lemon_order_mismatch';
  end if;
  if v_intent.order_id is not null and v_intent.order_id <> p_order_id then raise exception 'lemon_intent_already_used'; end if;
  if v_intent.total_usd_cents is not null and v_intent.total_usd_cents <> p_total_usd then raise exception 'lemon_order_mismatch'; end if;
  if coalesce(v_intent.total_currency_cents, case when v_intent.currency = 'USD' then v_intent.total_usd_cents end) is not null
     and coalesce(v_intent.total_currency_cents, v_intent.total_usd_cents) <> p_total then raise exception 'lemon_order_mismatch'; end if;
  v_refund := greatest(coalesce(v_intent.refunded_currency_cents, case when v_intent.currency = 'USD' then v_intent.refunded_usd_cents else 0 end), p_refunded);
  v_target := v_intent.package_tokens - ceil(v_intent.package_tokens::numeric * v_refund / p_total)::bigint;
  v_delta := v_target - v_intent.credited_tokens;
  v_status := case when v_refund = p_total then 'refunded' when v_refund > 0 then 'partial_refund' else 'paid' end;
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
    refunded_usd_cents = greatest(v_intent.refunded_usd_cents, p_refunded_usd), total_currency_cents = p_total,
    refunded_currency_cents = v_refund, credited_tokens = v_target, status = v_status, updated_at = now() where id = p_intent_id;
  if v_delta <> 0 then
    insert into public.credit_ledger(user_id, delta_tokens, balance_after, reason, metadata)
    values (v_user_id, v_delta, greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used),
      case when v_delta > 0 then 'lemon_credit_purchase' else 'lemon_credit_refund' end,
      jsonb_build_object('intent_id', p_intent_id, 'order_id', p_order_id, 'total_usd_cents', p_total_usd, 'refunded_usd_cents', p_refunded_usd, 'currency', p_currency, 'total_cents', p_total, 'refunded_cents', v_refund, 'test_mode', p_test_mode));
  end if;
  return query select v_user_id, v_profile.llm_token_quota, v_profile.llm_token_used, v_delta, v_status;
end;
$$;
revoke all on function public.apply_lemon_credit_order_v2(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint,text,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.apply_lemon_credit_order_v2(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint,text,bigint,bigint,bigint,bigint) to service_role;

-- Keep the former RPC compatible for outstanding USD orders and older app versions.
-- Never let it treat an SGD order as a USD payment.
create or replace function public.apply_lemon_credit_order(
  p_intent_id uuid, p_order_id text, p_store_id text, p_variant_id text,
  p_test_mode boolean, p_subtotal_usd bigint, p_discount_usd bigint,
  p_total_usd bigint, p_refunded_usd bigint
) returns table(user_id uuid, llm_token_quota bigint, llm_token_used bigint, delta_tokens bigint, order_status text)
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.lemon_credit_checkouts c where c.id = p_intent_id and c.currency <> 'USD') then
    raise exception 'lemon_order_mismatch';
  end if;
  return query select * from public.apply_lemon_credit_order_v2(
    p_intent_id, p_order_id, p_store_id, p_variant_id, p_test_mode,
    p_subtotal_usd, p_discount_usd, p_total_usd, p_refunded_usd,
    'USD', p_subtotal_usd, p_discount_usd, p_total_usd, p_refunded_usd);
end;
$$;
revoke all on function public.apply_lemon_credit_order(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.apply_lemon_credit_order(uuid,text,text,text,boolean,bigint,bigint,bigint,bigint) to service_role;
