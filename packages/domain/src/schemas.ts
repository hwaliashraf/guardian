import { z } from 'zod';

export const PlatformSchema = z.union([z.literal('android'), z.literal('ios')]);
export const TierSchema = z.union([z.literal('free'), z.literal('standard'), z.literal('premium')]);

export const FamilySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});

export const ParentSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  email: z.string(),
});

export const ChildSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  name: z.string(),
  birthdate: z.string(),
});

export const DeviceSchema = z.object({
  id: z.string(),
  childId: z.string(),
  platform: PlatformSchema,
  name: z.string(),
  registeredAt: z.string(),
});

export const SubscriptionSchema = z.object({
  familyId: z.string(),
  tier: TierSchema,
  deviceLimit: z.number(),
});

// --- Policy sub-shapes ---
export const ScreenTimePolicySchema = z.object({
  dailyLimitMinutes: z.number(),
  weeklyLimitMinutes: z.number(),
  perApp: z.record(z.string(), z.number()),
  perCategory: z.record(z.string(), z.number()),
});

export const BucketCategoryConfigSchema = z.object({
  maxSessionMinutes: z.number(),
  mandatoryBreakMinutes: z.number(),
  maxSessionsPerDay: z.number().optional(),
  graceFinishEnabled: z.boolean(),
});
export const BucketPolicySchema = z.object({
  perCategory: z.record(z.string(), BucketCategoryConfigSchema),
  default: BucketCategoryConfigSchema,
});

export const RoutineTypeSchema = z.union([
  z.literal('homework'),
  z.literal('bedtime'),
  z.literal('mealtime'),
  z.literal('school'),
  z.literal('custom'),
]);
export const SchedulePolicySchema = z.object({
  id: z.string(),
  type: RoutineTypeSchema,
  daysOfWeek: z.array(z.number()),
  startTime: z.string(),
  endTime: z.string(),
  allowedCategories: z.array(z.string()),
});
export const VacationModeSchema = z.object({
  enabled: z.boolean(),
  endDate: z.string().nullable(),
});

export const ContentFilterPolicySchema = z.object({
  categories: z.record(z.string(), z.union([z.literal('block'), z.literal('allow')])),
  whitelistOnly: z.boolean(),
  customAllowDomains: z.array(z.string()),
  customBlockDomains: z.array(z.string()),
  customBlockKeywords: z.array(z.string()),
  safeSearchEnforced: z.boolean(),
  youtubeRestrictedMode: z.boolean(),
});

export const AppRulePolicySchema = z.object({
  blockedApps: z.array(z.string()),
  allowedApps: z.array(z.string()),
  blockByStoreRating: z.array(z.string()),
});

export const InstalledAppSchema = z.object({
  appId: z.string(),
  name: z.string(),
  storeRating: z.string().nullable(),
});

export const GeofenceSchema = z.object({
  id: z.string(),
  childId: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number(),
  alertOnEnter: z.boolean(),
  alertOnLeave: z.boolean(),
});

export const PresencePolicySchema = z.object({
  level0Enabled: z.boolean(),
  level1Enabled: z.boolean(),
  level2Enabled: z.boolean(),
  thresholdMinutes: z.object({
    level0: z.number(),
    level1: z.number(),
    level2: z.number(),
  }),
  onTrigger: z.union([z.literal('pauseTimer'), z.literal('lockScreen'), z.literal('both')]),
  refundAbandonedMinutes: z.boolean(),
  notifyParentOnTrigger: z.literal(true),
});

export const TamperPolicySchema = z.object({
  alertOnUninstallAttempt: z.boolean(),
  alertOnServiceDisabled: z.boolean(),
  autoLockUntilRestored: z.boolean(),
  pinRequired: z.boolean(),
});

export const PolicySchema = z.object({
  id: z.string(),
  childId: z.string(),
  version: z.number(),
  screenTime: ScreenTimePolicySchema,
  buckets: BucketPolicySchema,
  schedules: z.array(SchedulePolicySchema),
  vacation: VacationModeSchema,
  contentFilter: ContentFilterPolicySchema,
  appRules: AppRulePolicySchema,
  presence: PresencePolicySchema,
  tamper: TamperPolicySchema,
  instantPause: z.boolean(),
});

// --- Events & requests ---
export const EventTypeSchema = z.union([
  z.literal('app_usage'),
  z.literal('block_attempt'),
  z.literal('search_query'),
  z.literal('youtube_view'),
  z.literal('new_install'),
  z.literal('uninstall_attempt'),
  z.literal('service_disabled'),
  z.literal('presence_trigger'),
  z.literal('location_update'),
  z.literal('geofence_enter'),
  z.literal('geofence_leave'),
]);

export const DeviceEventSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  childId: z.string(),
  type: EventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});

export const RequestTypeSchema = z.union([
  z.literal('extra_time'),
  z.literal('unblock'),
  z.literal('schedule_change'),
]);
export const RequestStatusSchema = z.union([
  z.literal('pending'),
  z.literal('approved'),
  z.literal('denied'),
]);
export const ChildRequestSchema = z.object({
  id: z.string(),
  childId: z.string(),
  type: RequestTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  status: RequestStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
