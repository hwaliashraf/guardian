-- 0001_init.sql
-- Guardian schema: maps 1:1 to packages/domain/src/types.ts (T02).
-- Column names are snake_case (Postgres convention); TS field names are camelCase.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- family
-- ---------------------------------------------------------------------------
create table public.family (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- parent
-- ---------------------------------------------------------------------------
create table public.parent (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family (id) on delete cascade,
  email     text not null
);

create index parent_family_id_idx on public.parent (family_id);

-- ---------------------------------------------------------------------------
-- child
-- ---------------------------------------------------------------------------
create table public.child (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family (id) on delete cascade,
  name      text not null,
  birthdate date not null
);

create index child_family_id_idx on public.child (family_id);

-- ---------------------------------------------------------------------------
-- device
-- ---------------------------------------------------------------------------
create table public.device (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.child (id) on delete cascade,
  platform      text not null check (platform in ('android', 'ios')),
  name          text not null,
  registered_at timestamptz not null default now()
);

create index device_child_id_idx on public.device (child_id);

-- ---------------------------------------------------------------------------
-- subscription (one row per family; family_id is both PK and FK)
-- ---------------------------------------------------------------------------
create table public.subscription (
  family_id    uuid primary key references public.family (id) on delete cascade,
  tier         text not null check (tier in ('free', 'standard', 'premium')),
  device_limit integer not null
);

-- ---------------------------------------------------------------------------
-- policy
-- ---------------------------------------------------------------------------
create table public.policy (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.child (id) on delete cascade,
  version        integer not null,
  screen_time    jsonb not null,
  buckets        jsonb not null,
  schedules      jsonb not null,
  vacation       jsonb not null,
  content_filter jsonb not null,
  app_rules      jsonb not null,
  presence       jsonb not null,
  tamper         jsonb not null,
  instant_pause  boolean not null default false
);

create unique index policy_child_id_version_idx on public.policy (child_id, version);

-- ---------------------------------------------------------------------------
-- device_event
-- ---------------------------------------------------------------------------
create table public.device_event (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.device (id) on delete cascade,
  child_id    uuid not null references public.child (id) on delete cascade,
  type        text not null check (type in (
                'app_usage', 'block_attempt', 'search_query', 'youtube_view',
                'new_install', 'uninstall_attempt', 'service_disabled',
                'presence_trigger', 'location_update', 'geofence_enter', 'geofence_leave'
              )),
  payload     jsonb not null,
  occurred_at timestamptz not null default now()
);

create index device_event_child_id_occurred_at_idx on public.device_event (child_id, occurred_at);

-- ---------------------------------------------------------------------------
-- child_request
-- ---------------------------------------------------------------------------
create table public.child_request (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid not null references public.child (id) on delete cascade,
  type         text not null check (type in ('extra_time', 'unblock', 'schedule_change')),
  payload      jsonb not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'denied')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index child_request_child_id_status_idx on public.child_request (child_id, status);

-- ---------------------------------------------------------------------------
-- Expose these tables through the Data API. This CLI/Postgres version's default (see this
-- project's `supabase/config.toml`, `api.auto_expose_new_tables` comment) no longer
-- auto-grants newly created tables to the `anon`/`authenticated`/`service_role` API roles —
-- without these GRANTs every request (including service_role, which bypasses RLS but not
-- table-level GRANTs) gets "permission denied for table ...". RLS (0002_rls.sql) still governs
-- row-level access for anon/authenticated; this only clears the table-level privilege check.
-- `alter default privileges` covers tables created by later migrations too.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
