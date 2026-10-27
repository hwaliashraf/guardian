/**
 * Local smoke test — inserts a full Family -> Parent -> Child -> Device -> Policy ->
 * DeviceEvent -> ChildRequest chain against a local Supabase instance using the
 * service-role key (bypasses RLS by design; this is NOT an RLS parent-vs-parent test),
 * then reads each row back and asserts what came back matches what was written.
 *
 * Run: `supabase start` (from packages/backend), `supabase db reset`, then
 *   SUPABASE_SERVICE_ROLE_KEY=<key-from-supabase-status> npx tsx packages/backend/scripts/smoke.ts
 *
 * NOTE on `process`: bare `process` triggers TS2591 under the repo's root
 * `npx tsc -p tsconfig.base.json --noEmit` sweep, which applies tsconfig.base.json's own
 * compilerOptions (no `"types": ["node"]`) to every .ts file in the repo regardless of any
 * nested workspace tsconfig (see T04's LEDGER note reproducing the same constraint for
 * `crypto`). Read env via `globalThis` to avoid depending on Node's ambient global
 * declarations at the type-check level; this still resolves to the real Node `process`
 * object at runtime under `tsx`/`node`.
 */
import { createClient } from '@supabase/supabase-js';

interface NodeProcessLike {
  env?: Record<string, string | undefined>;
  exit?: (code?: number) => void;
}

const nodeProcess = (globalThis as unknown as { process?: NodeProcessLike }).process;
const env: Record<string, string | undefined> = nodeProcess?.env ?? {};

const SUPABASE_URL: string = env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY: string | undefined = env.SUPABASE_SERVICE_ROLE_KEY;
// Well-known local-dev anon key printed by `supabase status`/`supabase start` — not a secret,
// same default-with-override pattern as SUPABASE_URL above.
const SUPABASE_ANON_KEY: string =
  env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main(): Promise<void> {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY env var required. Run `supabase status` (after `supabase ' +
        'start`) and export its "service_role key" value.',
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: family, error: familyErr } = await supabase
    .from('family')
    .insert({ name: 'Smoke Test Family' })
    .select()
    .single();
  assert(!familyErr, `family insert: ${familyErr?.message}`);
  console.log('family:', family);

  // `public.parent.id` is a FK to `auth.users(id)` (this ticket's documented auth-model
  // assumption — see 0002_rls.sql's top comment): a parent must be a real Supabase Auth user
  // before a `parent` row can reference it, so create one via the admin API using the
  // service-role key.
  const parentEmail = `smoke-parent-${Date.now()}@example.com`;
  const parentPassword = 'smoke-test-password-12345';
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: parentEmail,
    password: parentPassword,
    email_confirm: true,
  });
  assert(!authErr, `auth admin createUser: ${authErr?.message}`);
  console.log('auth user:', authUser.user.id);

  const { data: parent, error: parentErr } = await supabase
    .from('parent')
    .insert({ id: authUser.user.id, family_id: family.id, email: authUser.user.email })
    .select()
    .single();
  assert(!parentErr, `parent insert: ${parentErr?.message}`);
  console.log('parent:', parent);

  const { data: child, error: childErr } = await supabase
    .from('child')
    .insert({ family_id: family.id, name: 'Smoke Kid', birthdate: '2015-06-01' })
    .select()
    .single();
  assert(!childErr, `child insert: ${childErr?.message}`);
  console.log('child:', child);

  const { data: device, error: deviceErr } = await supabase
    .from('device')
    .insert({ child_id: child.id, platform: 'android', name: "Smoke Kid's Phone" })
    .select()
    .single();
  assert(!deviceErr, `device insert: ${deviceErr?.message}`);
  console.log('device:', device);

  const { data: policy, error: policyErr } = await supabase
    .from('policy')
    .insert({
      child_id: child.id,
      version: 1,
      screen_time: { dailyLimitMinutes: 120, weeklyLimitMinutes: 600, perApp: {}, perCategory: {} },
      buckets: { perCategory: {}, default: { maxSessionMinutes: 30, mandatoryBreakMinutes: 10, graceFinishEnabled: true } },
      schedules: [],
      vacation: { enabled: false, endDate: null },
      content_filter: {
        categories: {},
        whitelistOnly: false,
        customAllowDomains: [],
        customBlockDomains: [],
        customBlockKeywords: [],
        safeSearchEnforced: true,
        youtubeRestrictedMode: true,
      },
      app_rules: { blockedApps: [], allowedApps: [], blockByStoreRating: [] },
      presence: {
        level0Enabled: true,
        level1Enabled: true,
        level2Enabled: false,
        thresholdMinutes: { level0: 5, level1: 5, level2: 5 },
        onTrigger: 'pauseTimer',
        refundAbandonedMinutes: true,
        notifyParentOnTrigger: true,
      },
      tamper: {
        alertOnUninstallAttempt: true,
        alertOnServiceDisabled: true,
        autoLockUntilRestored: true,
        pinRequired: true,
      },
      instant_pause: false,
    })
    .select()
    .single();
  assert(!policyErr, `policy insert: ${policyErr?.message}`);
  console.log('policy:', policy);

  const { data: deviceEvent, error: deviceEventErr } = await supabase
    .from('device_event')
    .insert({
      device_id: device.id,
      child_id: child.id,
      type: 'app_usage',
      payload: { appId: 'com.example.game', minutes: 10 },
    })
    .select()
    .single();
  assert(!deviceEventErr, `device_event insert: ${deviceEventErr?.message}`);
  console.log('device_event:', deviceEvent);

  const { data: childRequest, error: childRequestErr } = await supabase
    .from('child_request')
    .insert({
      child_id: child.id,
      type: 'extra_time',
      payload: { minutesRequested: 15 },
      status: 'pending',
    })
    .select()
    .single();
  assert(!childRequestErr, `child_request insert: ${childRequestErr?.message}`);
  console.log('child_request:', childRequest);

  // Read every row back and assert the chain is intact.
  const { data: readBack, error: readErr } = await supabase
    .from('family')
    .select(
      'id, name, parent(id, email), child(id, name, device(id, platform), policy(id, version), device_event(id, type), child_request(id, type, status))',
    )
    .eq('id', family.id)
    .single();
  assert(!readErr, `read-back select: ${readErr?.message}`);

  assert(readBack.parent.length === 1, 'expected exactly 1 parent');
  assert(readBack.child.length === 1, 'expected exactly 1 child');
  assert(readBack.child[0].device.length === 1, 'expected exactly 1 device');
  assert(readBack.child[0].policy.length === 1, 'expected exactly 1 policy');
  assert(readBack.child[0].device_event.length === 1, 'expected exactly 1 device_event');
  assert(readBack.child[0].child_request.length === 1, 'expected exactly 1 child_request');

  console.log('READ-BACK OK:', JSON.stringify(readBack, null, 2));

  // Regression check (would have caught the infinite-recursion RLS bug on `policy`'s
  // device-select policy, see T07's "Review findings" — `select * from policy` as an
  // authenticated parent used to error with "infinite recursion detected in policy for
  // relation policy" before policy_select_device's max-version lookup was moved into a
  // security definer function). Sign in as the parent (not service-role) and confirm the
  // policy row for their own child round-trips under RLS with no recursion error.
  const parentClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error: signInErr } = await parentClient.auth.signInWithPassword({
    email: parentEmail,
    password: parentPassword,
  });
  assert(!signInErr, `parent sign-in: ${signInErr?.message}`);

  const { data: parentPolicyRead, error: parentPolicyErr } = await parentClient
    .from('policy')
    .select('id, child_id, version')
    .eq('child_id', child.id);
  assert(
    !parentPolicyErr,
    `parent-scoped policy select (regression check for RLS recursion): ${parentPolicyErr?.message}`,
  );
  assert(
    parentPolicyRead.length === 1 && parentPolicyRead[0].id === policy.id,
    'expected parent-scoped policy select to return exactly the 1 policy row for their own child',
  );
  console.log('PARENT-SCOPED POLICY SELECT OK (no RLS recursion):', parentPolicyRead);

  console.log('SMOKE TEST PASSED');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  nodeProcess?.exit?.(1);
});
