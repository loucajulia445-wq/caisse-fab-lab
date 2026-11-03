create extension if not exists pgcrypto with schema extensions;

create table if not exists public.caisse_state (
  id text primary key,
  data jsonb,
  revision bigint not null default 0
);

insert into public.caisse_state (id, data, revision)
values ('main', null, 0)
on conflict (id) do nothing;

create table if not exists public.caisse_security (
  id integer primary key check (id = 1),
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

insert into public.caisse_security (id, pin_hash)
values (1, extensions.crypt('1234', extensions.gen_salt('bf', 12)))
on conflict (id) do nothing;

create table if not exists public.caisse_sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);

create table if not exists public.caisse_login_attempts (
  ip_hash text primary key,
  failed_count integer not null default 0,
  window_started_at timestamptz not null default now()
);

create or replace function public.consume_caisse_login_attempt(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_count integer;
begin
  insert into public.caisse_login_attempts (ip_hash, failed_count, window_started_at)
  values (p_ip_hash, 1, now())
  on conflict (ip_hash) do update
  set failed_count = case
        when public.caisse_login_attempts.window_started_at < now() - interval '15 minutes' then 1
        else public.caisse_login_attempts.failed_count + 1
      end,
      window_started_at = case
        when public.caisse_login_attempts.window_started_at < now() - interval '15 minutes' then now()
        else public.caisse_login_attempts.window_started_at
      end
  returning failed_count into attempt_count;

  return attempt_count <= 5;
end;
$$;

revoke all on public.caisse_state from public, anon, authenticated;
revoke all on public.caisse_security from public, anon, authenticated;
revoke all on public.caisse_sessions from public, anon, authenticated;
revoke all on public.caisse_login_attempts from public, anon, authenticated;
revoke all on function public.consume_caisse_login_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_caisse_login_attempt(text) to service_role;

alter table public.caisse_state enable row level security;
alter table public.caisse_security enable row level security;
alter table public.caisse_sessions enable row level security;
alter table public.caisse_login_attempts enable row level security;
