// Types for the presence/attention signal-ladder policy layer (spec §6). Pure data — the
// booleans below are all derived upstream by native sensors (touch/scroll/key listeners,
// accelerometer/gyroscope, CameraX+MLKit face detection — T25); this module never touches a
// sensor, it only decides what a given sample means.
import type { DeviceEvent } from '../types';

export interface PresenceSignalSample {
  /** No touch/scroll/key input for `policy.thresholdMinutes.level0` minutes on a watched app. */
  level0Idle: boolean;
  /** The periodic "Still watching?" prompt (30s to respond) timed out with no response. */
  stillPromptTimedOut: boolean;
  /** Accelerometer/gyroscope stillness for `policy.thresholdMinutes.level1` minutes. */
  level1Still: boolean;
  /** Rolling window of face-presence samples (Android only); most recent last. */
  level2FaceSamples: boolean[];
  foregroundAppCategory: string;
  /** ISO timestamp of this sample. */
  now: string;
}

export interface PresenceDecision {
  triggered: boolean;
  level?: 0 | 1 | 2;
  action?: 'pauseTimer' | 'lockScreen' | 'both';
  /** Minutes to refund to the child's daily bucket via `BucketEngine.refundMinutes` (T03). */
  minutesToRefund: number;
  event?: DeviceEvent;
}
