-- Permit completing registration for AI chat without provisioning a cloud agent.
alter table public.profiles drop constraint if exists profiles_provision_target_check;
alter table public.profiles add constraint profiles_provision_target_check
  check (provision_target is null or provision_target in ('openclaw', 'hermes_agent', 'chat_only'));
