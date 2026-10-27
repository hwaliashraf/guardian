export type Platform = 'android' | 'ios';
export type Tier = 'free' | 'standard' | 'premium';

export interface Family {
  id: string;
  name: string;
  createdAt: string;
}

export interface Parent {
  id: string;
  familyId: string;
  email: string;
}

export interface Child {
  id: string;
  familyId: string;
  name: string;
  birthdate: string; // ISO date; ageTier is derived, never stored
}

export interface Device {
  id: string;
  childId: string;
  platform: Platform;
  name: string;
  registeredAt: string;
}

export interface Subscription {
  familyId: string;
  tier: Tier;
  deviceLimit: number;
}

// --- Policy sub-shapes ---
export interface ScreenTimePolicy {
  dailyLimitMinutes: number;
  weeklyLimitMinutes: number;
  perApp: Record<string, number>; // appId -> minutes/day
  perCategory: Record<string, number>; // categoryId -> minutes/day
}

export interface BucketCategoryConfig {
  maxSessionMinutes: number;
  mandatoryBreakMinutes: number;
  maxSessionsPerDay?: number;
  graceFinishEnabled: boolean; // +3 min once per session
}
export interface BucketPolicy {
  perCategory: Record<string, BucketCategoryConfig>; // categoryId -> config
  default: BucketCategoryConfig; // applies to categories with no override
}

export type RoutineType = 'homework' | 'bedtime' | 'mealtime' | 'school' | 'custom';
export interface SchedulePolicy {
  id: string;
  type: RoutineType;
  daysOfWeek: number[]; // 0=Sun..6=Sat
  startTime: string; // "HH:mm" local
  endTime: string; // "HH:mm" local
  allowedCategories: string[]; // categories permitted during this window; [] = none
}
export interface VacationMode {
  enabled: boolean;
  endDate: string | null;
}

export interface ContentFilterPolicy {
  categories: Record<string, 'block' | 'allow'>; // see contentCategories.ts (T15) for the id list
  whitelistOnly: boolean;
  customAllowDomains: string[];
  customBlockDomains: string[];
  customBlockKeywords: string[];
  safeSearchEnforced: boolean;
  youtubeRestrictedMode: boolean;
}

export interface AppRulePolicy {
  blockedApps: string[];
  allowedApps: string[];
  blockByStoreRating: string[]; // e.g. ['17+','Mature']
}

// T16 addition — T02 didn't anticipate this. The shape a device reports an installed app in
// (`AppManagementScreen`'s installed-app list) and the assumed shape of a `new_install`
// DeviceEvent's `payload` (T24's future `PackageAddedReceiver.kt` must emit these three fields
// verbatim to feed T16's InstallAlertsScreen correctly).
export interface InstalledApp {
  appId: string;
  name: string;
  storeRating: string | null;
}

// T17 addition — T02 didn't anticipate this. Backs `geofence_enter`/`geofence_leave` server-side
// evaluation (packages/backend/src/geofence.ts) and the parent-facing GeofenceEditorScreen.
export interface Geofence {
  id: string;
  childId: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  alertOnEnter: boolean;
  alertOnLeave: boolean;
}

export interface PresencePolicy {
  level0Enabled: boolean; // media/interaction heuristics
  level1Enabled: boolean; // device motion
  level2Enabled: boolean; // camera presence (Android only)
  thresholdMinutes: { level0: number; level1: number; level2: number };
  onTrigger: 'pauseTimer' | 'lockScreen' | 'both';
  refundAbandonedMinutes: boolean;
  notifyParentOnTrigger: true; // Phase-0 decision: always real-time, not configurable to off
}

export interface TamperPolicy {
  alertOnUninstallAttempt: boolean;
  alertOnServiceDisabled: boolean;
  autoLockUntilRestored: boolean;
  pinRequired: boolean;
}

export interface Policy {
  id: string;
  childId: string;
  version: number;
  screenTime: ScreenTimePolicy;
  buckets: BucketPolicy;
  schedules: SchedulePolicy[];
  vacation: VacationMode;
  contentFilter: ContentFilterPolicy;
  appRules: AppRulePolicy;
  presence: PresencePolicy;
  tamper: TamperPolicy;
  instantPause: boolean; // parent one-tap lock of all family devices
}

// --- Events & requests ---
export type EventType =
  | 'app_usage'
  | 'block_attempt'
  | 'search_query'
  | 'youtube_view'
  | 'new_install'
  | 'uninstall_attempt'
  | 'service_disabled'
  | 'presence_trigger'
  | 'location_update'
  | 'geofence_enter'
  | 'geofence_leave';

export interface DeviceEvent {
  id: string;
  deviceId: string;
  childId: string;
  type: EventType;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type RequestType = 'extra_time' | 'unblock' | 'schedule_change';
export type RequestStatus = 'pending' | 'approved' | 'denied';
export interface ChildRequest {
  id: string;
  childId: string;
  type: RequestType;
  payload: Record<string, unknown>;
  status: RequestStatus;
  createdAt: string;
  resolvedAt: string | null;
}
