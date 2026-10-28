-- Storage objects cannot cascade with Postgres rows. Require application cleanup
-- before deleting an auth user, including if an upload races account deletion.
alter table public.chat_files drop constraint if exists chat_files_user_id_fkey;
alter table public.chat_files add constraint chat_files_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;
