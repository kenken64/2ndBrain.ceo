create table if not exists public.payment_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  package_tokens bigint not null,
  usd_amount_cents integer not null,
  binance_symbol text not null default 'SOLUSDT',
  sol_usd_price numeric(18, 8) not null,
  sol_amount_lamports bigint not null,
  treasury_wallet text not null,
  solana_network text not null default 'mainnet-beta',
  blockhash text,
  last_valid_block_height bigint,
  status text not null default 'pending',
  signature text,
  expires_at timestamptz not null,
  paid_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_quotes_package_tokens_positive check (package_tokens > 0),
  constraint payment_quotes_usd_amount_positive check (usd_amount_cents > 0),
  constraint payment_quotes_sol_amount_positive check (sol_amount_lamports > 0),
  constraint payment_quotes_status_check check (status in ('pending', 'paid', 'expired', 'cancelled'))
);

create unique index if not exists payment_quotes_signature_unique
  on public.payment_quotes(signature)
  where signature is not null;

create index if not exists payment_quotes_user_created_idx
  on public.payment_quotes(user_id, created_at desc);

create table if not exists public.wallet_payments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.payment_quotes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null,
  signature text not null unique,
  treasury_wallet text not null,
  lamports_received bigint not null,
  package_tokens bigint not null,
  usd_amount_cents integer not null,
  sol_usd_price numeric(18, 8) not null,
  transaction_block_time timestamptz,
  transaction_payload jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  constraint wallet_payments_lamports_positive check (lamports_received > 0),
  constraint wallet_payments_package_tokens_positive check (package_tokens > 0),
  constraint wallet_payments_status_check check (status in ('confirmed'))
);

create index if not exists wallet_payments_user_created_idx
  on public.wallet_payments(user_id, created_at desc);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid references public.wallet_payments(id) on delete set null,
  delta_tokens bigint not null,
  balance_after bigint not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_ledger_delta_nonzero check (delta_tokens <> 0),
  constraint credit_ledger_balance_nonnegative check (balance_after >= 0)
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger(user_id, created_at desc);

alter table public.payment_quotes enable row level security;
alter table public.wallet_payments enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists payment_quotes_select_own on public.payment_quotes;
create policy payment_quotes_select_own
  on public.payment_quotes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists wallet_payments_select_own on public.wallet_payments;
create policy wallet_payments_select_own
  on public.wallet_payments
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own
  on public.credit_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists set_payment_quotes_updated_at on public.payment_quotes;
create trigger set_payment_quotes_updated_at
  before update on public.payment_quotes
  for each row execute function public.set_updated_at();

create or replace function public.apply_solana_credit_purchase(
  p_quote_id uuid,
  p_user_id uuid,
  p_wallet_address text,
  p_signature text,
  p_treasury_wallet text,
  p_lamports_received bigint,
  p_transaction_block_time timestamptz,
  p_transaction_payload jsonb
)
returns table (
  payment_id uuid,
  new_llm_token_quota bigint,
  added_tokens bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.payment_quotes%rowtype;
  v_existing_payment public.wallet_payments%rowtype;
  v_new_quota bigint;
  v_payment_id uuid;
begin
  select *
    into v_quote
    from public.payment_quotes
    where id = p_quote_id
    for update;

  if not found then
    raise exception 'quote_not_found';
  end if;

  if v_quote.user_id <> p_user_id then
    raise exception 'quote_user_mismatch';
  end if;

  if v_quote.wallet_address <> p_wallet_address then
    raise exception 'quote_wallet_mismatch';
  end if;

  if v_quote.treasury_wallet <> p_treasury_wallet then
    raise exception 'quote_treasury_mismatch';
  end if;

  if v_quote.status = 'paid' then
    select *
      into v_existing_payment
      from public.wallet_payments
      where quote_id = p_quote_id
        and signature = p_signature;

    if not found then
      raise exception 'quote_already_paid';
    end if;

    select llm_token_quota
      into v_new_quota
      from public.profiles
      where id = p_user_id;

    payment_id := v_existing_payment.id;
    new_llm_token_quota := coalesce(v_new_quota, 0);
    added_tokens := v_existing_payment.package_tokens;
    return next;
    return;
  end if;

  if v_quote.status <> 'pending' then
    raise exception 'quote_not_pending';
  end if;

  if p_lamports_received < v_quote.sol_amount_lamports then
    raise exception 'insufficient_payment';
  end if;

  if p_transaction_block_time is not null then
    if p_transaction_block_time < v_quote.created_at - interval '2 minutes' then
      raise exception 'transaction_before_quote';
    end if;

    if p_transaction_block_time > v_quote.expires_at + interval '2 minutes' then
      raise exception 'quote_expired';
    end if;
  elsif now() > v_quote.expires_at + interval '2 minutes' then
    raise exception 'quote_expired';
  end if;

  update public.payment_quotes
    set status = 'paid',
        signature = p_signature,
        paid_at = coalesce(p_transaction_block_time, now()),
        confirmed_at = now()
    where id = p_quote_id;

  insert into public.wallet_payments (
    quote_id,
    user_id,
    wallet_address,
    signature,
    treasury_wallet,
    lamports_received,
    package_tokens,
    usd_amount_cents,
    sol_usd_price,
    transaction_block_time,
    transaction_payload,
    status
  )
  values (
    v_quote.id,
    v_quote.user_id,
    p_wallet_address,
    p_signature,
    p_treasury_wallet,
    p_lamports_received,
    v_quote.package_tokens,
    v_quote.usd_amount_cents,
    v_quote.sol_usd_price,
    p_transaction_block_time,
    coalesce(p_transaction_payload, '{}'::jsonb),
    'confirmed'
  )
  returning id into v_payment_id;

  update public.profiles
    set llm_token_quota = llm_token_quota + v_quote.package_tokens
    where id = p_user_id
    returning llm_token_quota into v_new_quota;

  insert into public.credit_ledger (
    user_id,
    payment_id,
    delta_tokens,
    balance_after,
    reason,
    metadata
  )
  values (
    p_user_id,
    v_payment_id,
    v_quote.package_tokens,
    v_new_quota,
    'solana_credit_purchase',
    jsonb_build_object(
      'quote_id', v_quote.id,
      'signature', p_signature,
      'wallet_address', p_wallet_address,
      'treasury_wallet', p_treasury_wallet,
      'lamports_received', p_lamports_received,
      'usd_amount_cents', v_quote.usd_amount_cents,
      'sol_usd_price', v_quote.sol_usd_price
    )
  );

  payment_id := v_payment_id;
  new_llm_token_quota := v_new_quota;
  added_tokens := v_quote.package_tokens;
  return next;
end;
$$;

revoke all on function public.apply_solana_credit_purchase(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function public.apply_solana_credit_purchase(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  timestamptz,
  jsonb
) to service_role;

comment on table public.payment_quotes is
  'Short-lived Solana payment quotes for purchasing internal AI token quota.';

comment on table public.wallet_payments is
  'Confirmed Solana wallet payments credited to internal AI token quota.';

comment on table public.credit_ledger is
  'Append-only internal AI credit movements, including Solana purchases.';
