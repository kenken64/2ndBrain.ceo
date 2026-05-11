alter table public.profiles
  add column if not exists owner_name text,
  add column if not exists avatar_gender text,
  add column if not exists enrolment_completed_at timestamptz;
