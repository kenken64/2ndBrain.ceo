-- Enforce AI usage pause under the same profile lock used for marketplace charges.
-- Existing installations, balances and unused tool allocations are preserved.

-- Exclude paused owners before limiting a renewal batch so active users can
-- still renew even when many older subscriptions belong to paused accounts.
create or replace function public.due_marketplace_tool_subscription_users(p_limit integer default 100)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select mi.user_id
    from public.marketplace_installs mi
    join public.profiles p on p.id = mi.user_id
    where mi.status in ('installed', 'disabled')
      and mi.next_charge_at <= now()
      and not coalesce(p.openclaw_tokens_paused, false)
      and not coalesce(p.admin_disabled, false)
      and p.admin_deleted_at is null
    group by mi.user_id
    order by min(mi.next_charge_at), mi.user_id
    limit greatest(1, least(500, coalesce(p_limit, 100)));
$$;

revoke all on function public.due_marketplace_tool_subscription_users(integer)
  from public, anon, authenticated;
grant execute on function public.due_marketplace_tool_subscription_users(integer)
  to service_role;

create or replace function public.sync_marketplace_tool_subscriptions(
  p_user_id uuid,
  p_is_admin boolean default false
)
returns table (
  install_id uuid,
  item_id text,
  item_type text,
  status text,
  charged_tokens bigint,
  llm_token_quota bigint,
  llm_token_used bigint,
  available_tokens bigint,
  disabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_install public.marketplace_installs%rowtype;
  v_allocation public.workflow_tool_allocations%rowtype;
  v_charge_tokens bigint;
  v_available_tokens bigint;
  v_is_admin boolean := coalesce(p_is_admin, false);
begin
  if p_user_id is null then
    raise exception 'user_required';
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

  -- The profile lock serializes renewals with pause/resume and purchases.
  -- Leave due dates intact; resuming renews once from the current time, without back-charges.
  if coalesce(v_profile.openclaw_tokens_paused, false) then
    return;
  end if;

  for v_install in
    select *
      from public.marketplace_installs mi
      where mi.user_id = p_user_id
        and mi.status in ('installed', 'disabled')
        and mi.next_charge_at <= now()
      order by mi.next_charge_at asc
      for update
  loop
    select *
      into v_allocation
      from public.workflow_tool_allocations wta
      where wta.install_id = v_install.id
      for update;

    if not found or v_allocation.status = 'closed' then
      continue;
    end if;

    v_charge_tokens := greatest(0::bigint, v_install.price_tokens);
    v_available_tokens := v_profile.llm_token_quota - v_profile.llm_token_used;

    if v_is_admin or v_allocation.quota_exempt or v_charge_tokens = 0 then
      update public.workflow_tool_allocations wta
        set allocated_tokens = case when v_is_admin then 0 else wta.allocated_tokens end,
            quota_exempt = case when v_is_admin then true else wta.quota_exempt end,
            status = 'active'
        where wta.id = v_allocation.id
        returning * into v_allocation;

      update public.marketplace_installs mi
        set status = 'installed',
            current_period_started_at = now(),
            last_charged_at = now(),
            next_charge_at = public.marketplace_next_charge_at(now()),
            disabled_at = null,
            disabled_reason = null
        where mi.id = v_install.id
        returning * into v_install;

      install_id := v_install.id;
      item_id := v_install.item_id;
      item_type := v_install.item_type;
      status := v_install.status;
      charged_tokens := 0;
      llm_token_quota := v_profile.llm_token_quota;
      llm_token_used := v_profile.llm_token_used;
      available_tokens := greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used);
      disabled := false;
      return next;
      continue;
    end if;

    if v_available_tokens >= v_charge_tokens then
      update public.profiles p
        set llm_token_quota = p.llm_token_quota - v_charge_tokens
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
        -v_charge_tokens,
        v_profile.llm_token_quota,
        'marketplace_tool_renewal',
        jsonb_build_object(
          'install_id', v_install.id,
          'item_id', v_install.item_id,
          'item_type', v_install.item_type,
          'title', v_install.title,
          'charged_tokens', v_charge_tokens,
          'next_charge_at', public.marketplace_next_charge_at(now()),
          'repo_url', v_install.repo_url
        )
      );

      update public.workflow_tool_allocations wta
        set allocated_tokens = wta.allocated_tokens + v_charge_tokens,
            status = 'active'
        where wta.id = v_allocation.id
        returning * into v_allocation;

      update public.marketplace_installs mi
        set status = 'installed',
            charged_tokens = mi.charged_tokens + v_charge_tokens,
            current_period_started_at = now(),
            last_charged_at = now(),
            next_charge_at = public.marketplace_next_charge_at(now()),
            disabled_at = null,
            disabled_reason = null
        where mi.id = v_install.id
        returning * into v_install;

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
        v_install.item_id,
        v_charge_tokens,
        greatest(0::bigint, v_allocation.allocated_tokens - v_allocation.used_tokens),
        'renewal_allocation',
        jsonb_build_object(
          'install_id', v_install.id,
          'item_id', v_install.item_id,
          'item_type', v_install.item_type,
          'title', v_install.title,
          'charged_tokens', v_charge_tokens,
          'next_charge_at', v_install.next_charge_at,
          'repo_url', v_install.repo_url
        )
      );

      install_id := v_install.id;
      item_id := v_install.item_id;
      item_type := v_install.item_type;
      status := v_install.status;
      charged_tokens := v_charge_tokens;
      llm_token_quota := v_profile.llm_token_quota;
      llm_token_used := v_profile.llm_token_used;
      available_tokens := greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used);
      disabled := false;
      return next;
    else
      update public.workflow_tool_allocations wta
        set status = 'disabled'
        where wta.id = v_allocation.id
        returning * into v_allocation;

      update public.marketplace_installs mi
        set status = 'disabled',
            disabled_at = coalesce(mi.disabled_at, now()),
            disabled_reason = 'insufficient_ai_credits'
        where mi.id = v_install.id
        returning * into v_install;

      install_id := v_install.id;
      item_id := v_install.item_id;
      item_type := v_install.item_type;
      status := v_install.status;
      charged_tokens := 0;
      llm_token_quota := v_profile.llm_token_quota;
      llm_token_used := v_profile.llm_token_used;
      available_tokens := greatest(0::bigint, v_profile.llm_token_quota - v_profile.llm_token_used);
      disabled := true;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_marketplace_tool_subscriptions(uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.sync_marketplace_tool_subscriptions(uuid, boolean)
  to service_role;

comment on function public.sync_marketplace_tool_subscriptions(uuid, boolean) is
  'Skips paused users; otherwise charges due renewals or disables tools when credits are insufficient.';

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
  v_is_reinstall boolean := false;
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

  -- Applies to paid, free and admin-exempt installs, including direct RPC calls.
  if coalesce(v_profile.openclaw_tokens_paused, false) then
    raise exception 'ai_usage_paused';
  end if;

  select *
    into v_install
    from public.marketplace_installs mi
    where mi.user_id = p_user_id
      and mi.item_id = v_item_id
    for update;

  if found and v_install.status <> 'uninstalled' then
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

  if found and v_install.status = 'uninstalled' then
    v_is_reinstall := true;

    update public.marketplace_installs mi
      set item_type = v_item_type,
          title = v_title,
          repo_url = nullif(trim(coalesce(p_repo_url, '')), ''),
          status = 'installed',
          price_tokens = v_price_tokens,
          charged_tokens = v_charged_tokens,
          config = v_config,
          current_period_started_at = now(),
          last_charged_at = now(),
          next_charge_at = public.marketplace_next_charge_at(now()),
          unsubscribed_at = null,
          disabled_at = null,
          disabled_reason = null
      where mi.id = v_install.id
      returning * into v_install;

    update public.workflow_tool_allocations wta
      set allocated_tokens = case when v_is_admin then 0 else v_price_tokens end,
          used_tokens = 0,
          quota_exempt = v_is_admin,
          status = 'active'
      where wta.install_id = v_install.id
      returning * into v_allocation;

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
        case when v_is_admin then 0 else v_price_tokens end,
        0,
        v_is_admin,
        'active'
      )
      returning * into v_allocation;
    end if;
  else
    insert into public.marketplace_installs (
      user_id,
      item_id,
      item_type,
      title,
      repo_url,
      status,
      price_tokens,
      charged_tokens,
      current_period_started_at,
      config,
      last_charged_at,
      next_charge_at
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
      now(),
      v_config,
      now(),
      public.marketplace_next_charge_at(now())
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
  end if;

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
      'quota_exempt', v_is_admin,
      'reinstall', v_is_reinstall
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
