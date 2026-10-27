-- 0003_push_log.sql
-- T08: policy sync + push dispatch.

-- `device.push_token` — minimal necessary addition beyond T02/T07's literal schema: the
-- PushDispatcher.send(deviceToken, payload) contract (this ticket) needs a per-device push
-- token to dispatch to, and neither packages/domain's `Device` type (T02) nor the `device`
-- table (T07) has one yet. Nullable: a device may not have registered for push yet (e.g. just
-- paired, notification permission not yet granted) — such devices are simply skipped at
-- dispatch time (see packages/backend/src/policySync.ts `devicesToNotify`), not treated as an
-- error. Not added to packages/domain's `Device` type (out of this ticket's package scope,
-- packages/backend only) — packages/backend/src/policySync.ts defines its own narrow
-- `PushableDevice` shape ({ id, pushToken }) instead of importing/extending T02's `Device`.
alter table public.device
  add column push_token text;

-- ---------------------------------------------------------------------------
-- push_log — audit trail of dispatched pushes, one row per (device, dispatch attempt).
-- Written by LoggingPushDispatcher (default, no real network call) and, when
-- FCM_SERVICE_ACCOUNT_JSON is set, also by FcmPushDispatcher after a real send.
-- ---------------------------------------------------------------------------
create table public.push_log (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.device (id) on delete cascade,
  payload       jsonb not null,
  dispatched_at timestamptz not null default now(),
  dispatcher    text not null check (dispatcher in ('logging', 'fcm'))
);

create index push_log_device_id_idx on public.push_log (device_id);

-- RLS: enabled, no anon/authenticated policies (same default-deny pattern as every other table
-- in 0002_rls.sql). This table is only ever written/read by the policy-sync edge function using
-- the service_role key (push dispatch is a system action, not something a parent or device
-- writes directly) — service_role bypasses RLS per Supabase's built-in behavior, so no policy
-- is needed for the write path this ticket actually uses. Table-level GRANTs for push_log are
-- already covered by 0001_init.sql's `alter default privileges` statement, so no additional
-- GRANT is needed here.
alter table public.push_log enable row level security;
