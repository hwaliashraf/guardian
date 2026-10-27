-- 0005_pairing.sql
-- T10: verified-parental-consent field on `parent`, and the pairing_code table backing the
-- short-lived-code device-pairing flow (design decision documented in auth-flows/index.ts's
-- header comment and LEDGER.md's T10 entry — the spec does not specify a pairing mechanic).

-- ---------------------------------------------------------------------------
-- parent.parental_consent_accepted_at
-- ---------------------------------------------------------------------------
-- Set by auth-flows/index.ts's signup handler, only once the request body's `consentAccepted`
-- boolean is literally `true` (spec §8 COPPA/GDPR-K "verified parental consent flow at
-- signup") — nullable at the column level only because Postgres has no way to make a column
-- "not null from insert-time-computed-value"; the signup handler never inserts a `parent` row
-- without it, so in practice it is always set for any row created through this ticket's flow.
alter table public.parent
  add column parental_consent_accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- pairing_code
-- ---------------------------------------------------------------------------
create table public.pairing_code (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  child_id    uuid not null references public.child (id) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

create index pairing_code_child_id_idx on public.pairing_code (child_id);
create index pairing_code_code_idx on public.pairing_code (code);

-- At most one currently-active (unconsumed) row may exist for a given 6-digit code at a time —
-- guards against two simultaneously-active codes colliding (1-in-a-million but real; the
-- pairing-code request handler retries on the resulting uniqueness violation). Consumed/expired
-- rows are exempt so the small code space can be reused over time.
create unique index pairing_code_active_code_idx on public.pairing_code (code)
  where consumed_at is null;

alter table public.pairing_code enable row level security;

-- Parent: request a code for their own child (INSERT), and read it back (PostgREST's
-- return=representation performs an implicit SELECT after INSERT, subject to RLS same as every
-- other table in this schema).
create policy pairing_code_insert_parent on public.pairing_code
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

create policy pairing_code_select_parent on public.pairing_code
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

-- No device-role policy: the pairing device has no credential yet at redemption time (that's the
-- entire point of this table) — auth-flows/index.ts's pair-device handler uses the service-role
-- key to read/claim codes, matching digest-cron/vacation-cron's "no caller identity" precedent
-- (T09).

-- ---------------------------------------------------------------------------
-- family: account-close (DELETE) policy — did not exist before this ticket (T07 only defined
-- select/insert/update). Cascades to every child/device/policy/device_event/child_request/
-- parent row under the family via 0001_init.sql's `on delete cascade` FKs (data-minimization /
-- child-data-deletion requirement, spec §8).
-- ---------------------------------------------------------------------------
create policy family_delete on public.family
  for delete to authenticated
  using (id in (select public.current_parent_family_ids()));
