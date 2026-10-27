import type { SchedulePolicy, VacationMode } from '../../types';
import { isWithinAllowedWindow } from '../engine';
import { shouldAutoRestore } from '../vacation';

// All test times are constructed with the local-time `Date` constructor (year, monthIndex,
// day, hour, minute) since SchedulePolicy.startTime/endTime are documented as "HH:mm local".
// 2026-07-10 is a Friday (day 5); 2026-07-09 is Thursday (day 4).

const noVacation: VacationMode = { enabled: false, endDate: null };

function homeworkWindow(allowedCategories: string[]): SchedulePolicy {
  return {
    id: 'homework-weekday',
    type: 'homework',
    daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: '15:00',
    endTime: '17:00',
    allowedCategories,
  };
}

describe('isWithinAllowedWindow', () => {
  it('blocks a category outside the active window\'s allowed list', () => {
    const schedules = [homeworkWindow(['education'])];
    const at = new Date(2026, 6, 10, 16, 0); // Fri 16:00, inside the window

    expect(isWithinAllowedWindow(schedules, noVacation, 'games', at)).toBe(false);
    expect(isWithinAllowedWindow(schedules, noVacation, 'education', at)).toBe(true);
  });

  it('allows any category when no schedule window is active', () => {
    const schedules = [homeworkWindow(['education'])];
    const at = new Date(2026, 6, 10, 20, 0); // Fri 20:00, outside 15:00-17:00

    expect(isWithinAllowedWindow(schedules, noVacation, 'games', at)).toBe(true);
  });

  it('vacation mode bypasses all restrictions when endDate is in the future', () => {
    const schedules = [homeworkWindow(['education'])];
    const at = new Date(2026, 6, 10, 16, 0); // would otherwise block 'games'
    const vacation: VacationMode = { enabled: true, endDate: '2026-07-20T00:00:00' };

    expect(isWithinAllowedWindow(schedules, vacation, 'games', at)).toBe(true);
  });

  it('an expired vacation endDate does not bypass restrictions', () => {
    const schedules = [homeworkWindow(['education'])];
    const at = new Date(2026, 6, 10, 16, 0); // during the restrictive window
    const vacation: VacationMode = { enabled: true, endDate: '2026-07-01T00:00:00' };

    expect(isWithinAllowedWindow(schedules, vacation, 'games', at)).toBe(false);
  });

  it('handles a window that crosses midnight', () => {
    const bedtime: SchedulePolicy = {
      id: 'bedtime-thu',
      type: 'bedtime',
      daysOfWeek: [4], // Thursday only
      startTime: '21:00',
      endTime: '07:00',
      allowedCategories: [],
    };

    const duringWindow = new Date(2026, 6, 10, 2, 0); // Fri 02:00 — still within Thu 21:00-07:00
    const outsideWindow = new Date(2026, 6, 10, 10, 0); // Fri 10:00 — after the window ends

    expect(isWithinAllowedWindow([bedtime], noVacation, 'anything', duringWindow)).toBe(false);
    expect(isWithinAllowedWindow([bedtime], noVacation, 'anything', outsideWindow)).toBe(true);
  });

  it('models weekday vs weekend sleep times as two separate bedtime SchedulePolicy rows', () => {
    const bedtimeWeekday: SchedulePolicy = {
      id: 'bedtime-weekday',
      type: 'bedtime',
      daysOfWeek: [1, 2, 3, 4], // Mon-Thu
      startTime: '21:00',
      endTime: '07:00',
      allowedCategories: [],
    };
    const bedtimeWeekend: SchedulePolicy = {
      id: 'bedtime-weekend',
      type: 'bedtime',
      daysOfWeek: [5, 6], // Fri-Sat
      startTime: '23:00',
      endTime: '08:00',
      allowedCategories: [],
    };
    const schedules = [bedtimeWeekday, bedtimeWeekend];

    const thu22 = new Date(2026, 6, 9, 22, 0); // Thu 22:00 -> weekday bedtime active
    const fri22 = new Date(2026, 6, 10, 22, 0); // Fri 22:00 -> weekend bedtime not yet started
    const fri2330 = new Date(2026, 6, 10, 23, 30); // Fri 23:30 -> weekend bedtime active

    expect(isWithinAllowedWindow(schedules, noVacation, 'anything', thu22)).toBe(false);
    expect(isWithinAllowedWindow(schedules, noVacation, 'anything', fri22)).toBe(true);
    expect(isWithinAllowedWindow(schedules, noVacation, 'anything', fri2330)).toBe(false);
  });

  it('resolves overlapping windows for the same category as most-restrictive-wins', () => {
    const mealtime: SchedulePolicy = {
      id: 'mealtime',
      type: 'mealtime',
      daysOfWeek: [5],
      startTime: '12:00',
      endTime: '13:00',
      allowedCategories: ['education', 'entertainment'],
    };
    const homework: SchedulePolicy = {
      id: 'homework',
      type: 'homework',
      daysOfWeek: [5],
      startTime: '12:30',
      endTime: '14:00',
      allowedCategories: ['education'],
    };
    const schedules = [mealtime, homework];
    const at = new Date(2026, 6, 10, 12, 45); // overlap of both windows

    expect(isWithinAllowedWindow(schedules, noVacation, 'entertainment', at)).toBe(false);
    expect(isWithinAllowedWindow(schedules, noVacation, 'education', at)).toBe(true);
  });
});

describe('shouldAutoRestore', () => {
  it('is false when vacation mode is disabled', () => {
    expect(shouldAutoRestore({ enabled: false, endDate: '2026-07-01T00:00:00' }, new Date(2026, 6, 10))).toBe(false);
  });

  it('is false when endDate is null', () => {
    expect(shouldAutoRestore({ enabled: true, endDate: null }, new Date(2026, 6, 10))).toBe(false);
  });

  it('is false when endDate is still in the future', () => {
    const vacation: VacationMode = { enabled: true, endDate: '2026-07-20T00:00:00' };
    expect(shouldAutoRestore(vacation, new Date(2026, 6, 10))).toBe(false);
  });

  it('is true when endDate has passed', () => {
    const vacation: VacationMode = { enabled: true, endDate: '2026-07-01T00:00:00' };
    expect(shouldAutoRestore(vacation, new Date(2026, 6, 10))).toBe(true);
  });
});
