-- 0006_geofence.sql
-- T17: parent-configured geofences. Read/evaluated server-side by event-ingest
-- (packages/backend/src/geofence.ts's evaluateGeofences) whenever a location_update event
-- arrives; full CRUD is otherwise a parent-owned resource, same as `policy`/`pairing_code`.

create table public.geofence (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.child (id) on delete cascade,
  name           text not null,
  lat            double precision not null,
  lng            double precision not null,
  radius_meters  double precision not null check (radius_meters > 0),
  alert_on_enter boolean not null default true,
  alert_on_leave boolean not null default true
);

create index geofence_child_id_idx on public.geofence (child_id);

-- RLS: full parent CRUD scoped via current_parent_child_ids() (0002_rls.sql), same pattern as
-- `policy`'s select/insert/update policies plus 0005_pairing.sql's `family_delete` for the
-- delete-policy shape. No device-role policy — geofence evaluation happens server-side in
-- event-ingest using the service-role key (same rationale as `device`'s push_token read, T09),
-- a device never reads or writes this table directly. Table-level GRANTs already covered by
-- 0001_init.sql's `alter default privileges` statement.
alter table public.geofence enable row level security;

create policy geofence_select_parent on public.geofence
  for select to authenticated
  using (child_id in (select public.current_parent_child_ids()));

create policy geofence_insert_parent on public.geofence
  for insert to authenticated
  with check (child_id in (select public.current_parent_child_ids()));

create policy geofence_update_parent on public.geofence
  for update to authenticated
  using (child_id in (select public.current_parent_child_ids()))
  with check (child_id in (select public.current_parent_child_ids()));

create policy geofence_delete_parent on public.geofence
  for delete to authenticated
  using (child_id in (select public.current_parent_child_ids()));
