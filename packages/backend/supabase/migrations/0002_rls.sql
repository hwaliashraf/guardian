-- 0002_rls.sql
--
-- AUTH MODEL ASSUMPTION (design decision — the spec does not specify Supabase Auth
-- internals; flagged in the T07 report as a RISK for human/product review, not applied
-- silently):
--
--   1. Parents are real Supabase Auth users. `public.parent.id` IS the Supabase Auth user id
--      (`auth.uid()`) — enforced below via a foreign key to `auth.users(id)`. A parent signs
--      up through Supabase Auth, then inserts their own `public.parent` row with
--      `id = auth.uid()`. A brand-new family is created by any authenticated user during
--      onboarding (chicken-and-egg: no `parent` row referencing a family can exist before the
--      family row does), then that user inserts their own `parent` row pointing at it.
--   2. Child devices are NOT Supabase Auth users. Each paired device is issued a scoped JWT
--      (role `authenticated`, signed with the project's JWT secret, minted by a future
--      pairing/registration edge function — T08/T09) carrying a custom claim `device_id` equal
--      to that device's `public.device.id`. Policies below read this claim via
--      `auth.jwt() ->> 'device_id'`. Because the JWT is signed with the project secret,
--      PostgREST/Supabase verifies it the same way as any other JWT — a device cannot forge
--      another device's `device_id` claim without the secret.
--   3. The `service_role` key (used by admin tooling, edge functions, and this ticket's smoke
--      test) bypasses RLS entirely — this is Supabase's built-in behavior for `service_role`,
--      not a policy defined here.
--
--   RISK: this ticket does not implement the edge function that mints device JWTs (that's
--   T08/T09) — the `device_id` claim mechanism is a policy-level assumption only, unverified
--   end-to-end until that function exists. If the product intends devices to instead be full
--   Supabase Auth users (e.g. anonymous auth sessions), these policies would need to key off
--   `auth.uid()` matching a `device.auth_user_id` column instead — flagging for human
--   confirmation before T08/T09 build the pairing flow.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer: they read tables whose own RLS would otherwise
-- recurse into these same policies; kept minimal/read-only, no argument reuse across trust
-- boundaries).
-- ---------------------------------------------------------------------------

create or replace function public.current_parent_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.parent where id = auth.uid();
$$;

create or replace function public.current_parent_child_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.child
  where family_id in (select public.current_parent_family_ids());
$$;

create or replace function public.current_device_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'device_id', '')::uuid;
$$;

create or replace function public.current_device_child_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select child_id from public.device where id = public.current_device_id();
$$;

-- security definer (like the three helpers above) so this cross-row lookup against
-- public.policy does not itself get evaluated under policy's own RLS, which would recurse
-- (policy_select_device's USING clause calls this instead of embedding the correlated
-- subquery directly).
create or replace function public.policy_max_version(p_child_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select max(version) from public.policy where child_id = p_child_id;
$$;

-- Tie parent identity to Supabase Auth (see assumption #1 above). Added here, not in
-- 0001_init.sql, because it couples the domain schema to Supabase's built-in `auth` schema —
-- an auth-model decision, not a pure domain-model one.
alter table public.parent
  add constraint parent_id_references_auth_users
  foreign key (id) references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- family
-- ---------------------------------------------------------------------------
alter table public.family enable row level security;

create policy family_select on public.family
  for select to authenticated
  using (id in (select public.current_parent_family_ids()));

-- Any authenticated user may create a brand-new family (onboarding step 1; see assumption #1).
create policy family_insert on public.family
  for insert to authenticated
  with check (true);

create policy family_update on public.family
  for update to authenticated
  using (id in (select public.current_parent_family_ids()))
  with check (id in (select public.current_parent_family_ids()));

-- ---------------------------------------------------------------------------
-- parent
-- ---------------------------------------------------------------------------
alter table public.parent enable row level security;

create policy parent_select on public.parent
  for select to authenticated
  using (
    family_id in (select public.current_parent_family_ids())
    or id = auth.uid()
  );

-- A parent may only ever insert a row for themselves (id = auth.uid()); see assumption #1.
create policy parent_insert on public.parent
  for insert to authenticated
  with check (id = auth.uid());

create policy parent_update on public.parent
  for update to authenticated
  using (family_id in (select public.current_parent_family_ids()))
  with check (family_id in (select public.current_parent_family_ids()));

-- ---------------------------------------------------------------------------
-- child
-- ---------------------------------------------------------------------------
alter table public.child enable row level security;

create policy child_select_parent on public.child
  for select to authenticated
  using (family_id in (select public.current_parent_family_ids()));

create policy child_insert_parent on public.child
  for insert to authenticated
  with check (family_id in (select public.current_parent_family_ids()));

create policy child_update_parent on public.child
  for update to authenticated
  using (family_id in (select public.current_parent_family_ids()))
  with check (family_id in (select public.current_parent_family_ids()));

-- ---------------------------------------------------------------------------
-- device
-- ---------------------------------------------------------------------------
alter table public.device enable row level security;

create policy device_select_parent on public.device
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

create policy device_insert_parent on public.device
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

create policy device_update_parent on public.device
  for update to authenticated
  using (child_id in (select public.current_parent_child_ids()))
  with check (child_id in (select public.current_parent_child_ids()));

-- ---------------------------------------------------------------------------
-- subscription
-- ---------------------------------------------------------------------------
alter table public.subscription enable row level security;

create policy subscription_select_parent on public.subscription
  for select to authenticated
  using (family_id in (select public.current_parent_family_ids()));

create policy subscription_insert_parent on public.subscription
  for insert to authenticated
  with check (family_id in (select public.current_parent_family_ids()));

create policy subscription_update_parent on public.subscription
  for update to authenticated
  using (family_id in (select public.current_parent_family_ids()))
  with check (family_id in (select public.current_parent_family_ids()));

-- ---------------------------------------------------------------------------
-- policy
-- ---------------------------------------------------------------------------
alter table public.policy enable row level security;

create policy policy_select_parent on public.policy
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

create policy policy_insert_parent on public.policy
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

create policy policy_update_parent on public.policy
  for update to authenticated
  using (child_id in (select public.current_parent_child_ids()))
  with check (child_id in (select public.current_parent_child_ids()));

-- Device: read-only access to its OWN child's *active* policy (highest version row for that
-- child_id) — never another child's/family's, and never write (no insert/update policy exists
-- for the device role on this table, satisfying "cannot write Policy").
create policy policy_select_device on public.policy
  for select to authenticated
  using (
    child_id = public.current_device_child_id()
    and version = public.policy_max_version(policy.child_id)
  );

-- ---------------------------------------------------------------------------
-- device_event
-- ---------------------------------------------------------------------------
alter table public.device_event enable row level security;

create policy device_event_select_parent on public.device_event
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

create policy device_event_insert_parent on public.device_event
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

create policy device_event_update_parent on public.device_event
  for update to authenticated
  using (child_id in (select public.current_parent_child_ids()))
  with check (child_id in (select public.current_parent_child_ids()));

-- Device: insert-only, own events for its own child (never another child's/family's data;
-- no select/update policy exists for the device role on this table).
create policy device_event_insert_device on public.device_event
  for insert to authenticated
  with check (
    device_id = public.current_device_id()
    and child_id = public.current_device_child_id()
  );

-- ---------------------------------------------------------------------------
-- child_request
-- ---------------------------------------------------------------------------
alter table public.child_request enable row level security;

create policy child_request_select_parent on public.child_request
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

create policy child_request_insert_parent on public.child_request
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

-- Parents resolve (approve/deny) requests.
create policy child_request_update_parent on public.child_request
  for update to authenticated
  using (child_id in (select public.current_parent_child_ids()))
  with check (child_id in (select public.current_parent_child_ids()));

-- Device: insert-only, own child's requests (never another child's/family's data; no
-- select/update policy exists for the device role on this table — RISK: a follow-up ticket
-- will need a narrow device-scoped SELECT so the child device can learn its own request's
-- resolution status, out of this ticket's literal scope).
create policy child_request_insert_device on public.child_request
  for insert to authenticated
  with check (child_id = public.current_device_child_id());
