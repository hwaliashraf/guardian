-- 0004_digest.sql
-- T09: weekly digest table. One row per (child, weekStart), written by the digest-cron edge
-- function after computing packages/backend/src/digest.ts's buildWeeklyDigest().

create table public.digest (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.child (id) on delete cascade,
  week_start date not null,
  summary    jsonb not null,
  sent_at    timestamptz not null default now()
);

create unique index digest_child_id_week_start_idx on public.digest (child_id, week_start);

-- RLS: parents can read their own children's digests (same current_parent_child_ids() helper
-- every other parent-scoped table uses, defined in 0002_rls.sql). No insert/update policy for
-- parent or device roles — only digest-cron writes this, using the service-role key (system
-- job, not a parent- or device-owned write), same default-deny-except-service-role pattern
-- push_log (0003_push_log.sql) already established. Table-level GRANTs are already covered by
-- 0001_init.sql's `alter default privileges` statement.
alter table public.digest enable row level security;

create policy digest_select_parent on public.digest
  for select
  using (child_id in (select public.current_parent_child_ids()));
