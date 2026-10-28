-- profiles: one row per auth user, the single source of truth for the user's role.
-- The row is created atomically with the account by the on_auth_user_created trigger;
-- a missing or invalid role in raw_user_meta_data violates the check and aborts the signup.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'agent')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Role is immutable: only a select policy; no insert, update or delete policies.
create policy profiles_select_own on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Explicit grants so the result does not depend on the project's default privileges.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No coalesce: a null or unknown role fails the check constraint and the signup is rolled back.
  insert into public.profiles (id, role)
  values (new.id, new.raw_user_meta_data ->> 'role');
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- down:
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop table if exists public.profiles;
