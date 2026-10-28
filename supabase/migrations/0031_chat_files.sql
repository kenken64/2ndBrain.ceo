-- The bucket is private; only server-side service-role operations access objects.
insert into storage.buckets (id, name, public, file_size_limit)
values ('aicuber-chat-uploads', 'aicuber-chat-uploads', false, 20971520)
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'aicuber-chat-uploads' and public = false and file_size_limit = 20971520) then
    raise exception 'aicuber-chat-uploads bucket exists with incompatible settings';
  end if;
end $$;

create table if not exists public.chat_files (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 150),
  object_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  created_at timestamptz not null default now()
);
create index if not exists chat_files_user_created_idx on public.chat_files (user_id, created_at desc, id desc);
alter table public.chat_files enable row level security;
drop policy if exists chat_files_select_own on public.chat_files;
create policy chat_files_select_own on public.chat_files for select to authenticated using (auth.uid() = user_id);
revoke all on public.chat_files from anon, authenticated;
grant select on public.chat_files to authenticated;
grant select, insert, delete on public.chat_files to service_role;
