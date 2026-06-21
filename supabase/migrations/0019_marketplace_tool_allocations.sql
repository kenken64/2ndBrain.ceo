create table if not exists public.marketplace_installs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  item_type text not null,
  title text not null,
  repo_url text,
  status text not null default 'installed',
  price_tokens bigint not null default 0,
  charged_tokens bigint not null default 0,
  config jsonb not null default '{}'::jsonb,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_installs_item_id_nonempty check (trim(item_id) <> ''),
  constraint marketplace_installs_item_type_nonempty check (trim(item_type) <> ''),
  constraint marketplace_installs_status_check check (status in ('installed', 'disabled', 'uninstalled')),
  constraint marketplace_installs_price_nonnegative check (price_tokens >= 0),
  constraint marketplace_installs_charged_nonnegative check (charged_tokens >= 0),
  constraint marketplace_installs_charged_not_above_price check (charged_tokens <= price_tokens),
  unique (user_id, item_id)
);

create index if not exists marketplace_installs_user_status_idx
  on public.marketplace_installs(user_id, status, installed_at desc);

create table if not exists public.workflow_tool_allocations (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null unique references public.marketplace_installs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id text not null,
  allocated_tokens bigint not null default 0,
  used_tokens bigint not null default 0,
  quota_exempt boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_tool_allocations_tool_id_nonempty check (trim(tool_id) <> ''),
  constraint workflow_tool_allocations_allocated_nonnegative check (allocated_tokens >= 0),
  constraint workflow_tool_allocations_used_nonnegative check (used_tokens >= 0),
  constraint workflow_tool_allocations_used_not_above_allocated check (quota_exempt or used_tokens <= allocated_tokens),
  constraint workflow_tool_allocations_status_check check (status in ('active', 'disabled', 'closed')),
  unique (user_id, tool_id)
);

create index if not exists workflow_tool_allocations_user_status_idx
  on public.workflow_tool_allocations(user_id, status, updated_at desc);

create table if not exists public.workflow_tool_token_ledger (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.workflow_tool_allocations(id) on delete cascade,
  install_id uuid not null references public.marketplace_installs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id text not null,
  delta_tokens bigint not null default 0,
  balance_after bigint not null default 0,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_tool_token_ledger_balance_nonnegative check (balance_after >= 0),
  constraint workflow_tool_token_ledger_reason_check check (
    reason in (
      'admin_install_allocation',
      'install_allocation',
      'refund',
      'top_up',
      'usage'
    )
  )
);

create index if not exists workflow_tool_token_ledger_user_created_idx
  on public.workflow_tool_token_ledger(user_id, created_at desc);

create index if not exists workflow_tool_token_ledger_tool_created_idx
  on public.workflow_tool_token_ledger(user_id, tool_id, created_at desc);

alter table public.marketplace_installs enable row level security;
alter table public.workflow_tool_allocations enable row level security;
alter table public.workflow_tool_token_ledger enable row level security;

drop policy if exists marketplace_installs_select_own on public.marketplace_installs;
create policy marketplace_installs_select_own
  on public.marketplace_installs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists workflow_tool_allocations_select_own on public.workflow_tool_allocations;
create policy workflow_tool_allocations_select_own
  on public.workflow_tool_allocations
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists workflow_tool_token_ledger_select_own on public.workflow_tool_token_ledger;
create policy workflow_tool_token_ledger_select_own
  on public.workflow_tool_token_ledger
  for select
  to authenticated
  using (auth.uid() = user_id);

drop trigger if exists set_marketplace_installs_updated_at on public.marketplace_installs;
create trigger set_marketplace_installs_updated_at
  before update on public.marketplace_installs
  for each row execute function public.set_updated_at();

drop trigger if exists set_workflow_tool_allocations_updated_at on public.workflow_tool_allocations;
create trigger set_workflow_tool_allocations_updated_at
  before update on public.workflow_tool_allocations
  for each row execute function public.set_updated_at();

create or replace function public.install_marketplace_tool(
  p_user_id uuid,
  p_item_id text,
  p_item_type text,
  p_title text,
  p_price_tokens bigint,
  p_repo_url text,
  p_is_admin boolean,
  p_config jsonb
)
returns table (
  install_id uuid,
  allocation_id uuid,
  item_id text,
  item_type text,
  status text,
  price_tokens bigint,
  charged_tokens bigint,
  allocated_tokens bigint,
  used_tokens bigint,
  quota_exempt boolean,
  llm_token_quota bigint,
  llm_token_used bigint,
  available_tokens bigint,
  already_installed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id text := trim(coalesce(p_item_id, ''));
  v_item_type text := trim(coalesce(p_item_type, ''));
  v_title text := trim(coalesce(p_title, ''));
  v_price_tokens bigint := coalesce(p_price_tokens, 0);
  v_is_admin boolean := coalesce(p_is_admin, false);
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_profile public.profiles%rowtype;
  v_install public.marketplace_installs%rowtype;
  v_allocation public.workflow_tool_allocations%rowtype;
  v_charged_tokens bigint;
  v_available_tokens bigint;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;

  if v_item_id = '' or v_item_type = '' or v_title = '' then
    raise exception 'invalid_marketplace_item';
  end if;

  if v_price_tokens < 0 then
    raise exception 'invalid_price_tokens';
  end if;

  select *
    into v_profile
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if coalesce(v_profile.admin_disabled, false) or v_profile.admin_deleted_at is not null then
    raise exception 'account_disabled';
  end if;

  select *
    into v_install
    from public.marketplace_installs mi
    where mi.user_id = p_user_id
      and mi.item_id = v_item_id
    for update;

  if found then
    select *
      into v_allocation
      from public.workflow_tool_allocations wta
      where wta.install_id = v_install.id
      for update;

    if not found then
      insert into public.workflow_tool_allocations (
        install_id,
        user_id,
        tool_id,
        allocated_tokens,
        used_tokens,
        quota_exempt,
        status
      )
      values (
        v_install.id,
        p_user_id,
        v_item_id,
        case when v_install.charged_tokens > 0 then v_install.charged_tokens else 0 end,
        0,
        v_install.charged_tokens = 0,
        'active'
      )
      returning * into v_allocation;
    end if;

    install_id := v_install.id;
    allocation_id := v_allocation.id;
    item_id := v_install.item_id;
    item_type := v_install.item_type;
    status := v_install.status;
    price_tokens := v_install.price_tokens;
    charged_tokens := 0;
    allocated_tokens := v_allocation.allocated_tokens;
    used_tokens := v_allocation.used_tokens;
    quota_exempt := v_allocation.quota_exempt;
    llm_token_quota := v_profile.llm_token_quota;
    llm_token_used := v_profile.llm_token_used;
    available_tokens := greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used);
    already_installed := true;
    return next;
    return;
  end if;

  v_charged_tokens := case when v_is_admin then 0 else v_price_tokens end;
  v_available_tokens := v_profile.llm_token_quota - v_profile.llm_token_used;

  if not v_is_admin and v_available_tokens < v_charged_tokens then
    raise exception 'insufficient_ai_credits';
  end if;

  if v_charged_tokens > 0 then
    update public.profiles p
      set llm_token_quota = p.llm_token_quota - v_charged_tokens
      where p.id = p_user_id
      returning p.* into v_profile;

    insert into public.credit_ledger (
      user_id,
      delta_tokens,
      balance_after,
      reason,
      metadata
    )
    values (
      p_user_id,
      -v_charged_tokens,
      v_profile.llm_token_quota,
      'marketplace_tool_purchase',
      jsonb_build_object(
        'item_id', v_item_id,
        'item_type', v_item_type,
        'title', v_title,
        'listed_price_tokens', v_price_tokens,
        'charged_tokens', v_charged_tokens,
        'repo_url', p_repo_url
      )
    );
  end if;

  insert into public.marketplace_installs (
    user_id,
    item_id,
    item_type,
    title,
    repo_url,
    status,
    price_tokens,
    charged_tokens,
    config
  )
  values (
    p_user_id,
    v_item_id,
    v_item_type,
    v_title,
    nullif(trim(coalesce(p_repo_url, '')), ''),
    'installed',
    v_price_tokens,
    v_charged_tokens,
    v_config
  )
  returning * into v_install;

  insert into public.workflow_tool_allocations (
    install_id,
    user_id,
    tool_id,
    allocated_tokens,
    used_tokens,
    quota_exempt,
    status
  )
  values (
    v_install.id,
    p_user_id,
    v_item_id,
    case when v_is_admin then 0 else v_price_tokens end,
    0,
    v_is_admin,
    'active'
  )
  returning * into v_allocation;

  insert into public.workflow_tool_token_ledger (
    allocation_id,
    install_id,
    user_id,
    tool_id,
    delta_tokens,
    balance_after,
    reason,
    metadata
  )
  values (
    v_allocation.id,
    v_install.id,
    p_user_id,
    v_item_id,
    v_allocation.allocated_tokens,
    greatest(0::bigint, v_allocation.allocated_tokens - v_allocation.used_tokens),
    case when v_is_admin then 'admin_install_allocation' else 'install_allocation' end,
    jsonb_build_object(
      'item_id', v_item_id,
      'item_type', v_item_type,
      'title', v_title,
      'listed_price_tokens', v_price_tokens,
      'charged_tokens', v_charged_tokens,
      'repo_url', p_repo_url,
      'quota_exempt', v_is_admin
    )
  );

  install_id := v_install.id;
  allocation_id := v_allocation.id;
  item_id := v_install.item_id;
  item_type := v_install.item_type;
  status := v_install.status;
  price_tokens := v_install.price_tokens;
  charged_tokens := v_charged_tokens;
  allocated_tokens := v_allocation.allocated_tokens;
  used_tokens := v_allocation.used_tokens;
  quota_exempt := v_allocation.quota_exempt;
  llm_token_quota := v_profile.llm_token_quota;
  llm_token_used := v_profile.llm_token_used;
  available_tokens := greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used);
  already_installed := false;
  return next;
end;
$$;

revoke all on function public.install_marketplace_tool(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  boolean,
  jsonb
) from public, anon, authenticated;

grant execute on function public.install_marketplace_tool(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  boolean,
  jsonb
) to service_role;

comment on table public.marketplace_installs is
  'Per-user marketplace tool installs. Writes are handled by server-side RPCs so paid installs cannot be bypassed.';

comment on table public.workflow_tool_allocations is
  'Per-installed-tool AI credit pools. Non-admin installs receive the purchased allocation; admin installs are quota-exempt.';

comment on table public.workflow_tool_token_ledger is
  'Append-only movements inside workflow tool allocations, separate from the user-level credit ledger.';

comment on function public.install_marketplace_tool(
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  boolean,
  jsonb
) is
  'Atomically installs a marketplace workflow tool, charges non-admin users, and creates the tool token allocation.';
