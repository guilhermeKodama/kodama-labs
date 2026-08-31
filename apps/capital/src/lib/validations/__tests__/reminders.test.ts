import { describe, it, expect } from 'vitest';
import { remindersConfigSchema, reminderEntrySchema, reminderTimeSchema } from '../reminders';

describe('reminderTimeSchema', () => {
  it('accepts valid HH:MM values', () => {
    expect(reminderTimeSchema.safeParse('00:00').success).toBe(true);
    expect(reminderTimeSchema.safeParse('09:05').success).toBe(true);
    expect(reminderTimeSchema.safeParse('23:59').success).toBe(true);
  });

  it('rejects malformed or out-of-range times', () => {
    expect(reminderTimeSchema.safeParse('25:00').success).toBe(false);
    expect(reminderTimeSchema.safeParse('9:00').success).toBe(false);
    expect(reminderTimeSchema.safeParse('09:60').success).toBe(false);
    expect(reminderTimeSchema.safeParse('09:00:00').success).toBe(false);
    expect(reminderTimeSchema.safeParse('').success).toBe(false);
  });
});

describe('reminderEntrySchema', () => {
  it('accepts daysBefore 0 through 30', () => {
    expect(reminderEntrySchema.safeParse({ daysBefore: 0, time: '09:00' }).success).toBe(true);
    expect(reminderEntrySchema.safeParse({ daysBefore: 30, time: '09:00' }).success).toBe(true);
  });

  it('rejects negative or fractional daysBefore', () => {
    expect(reminderEntrySchema.safeParse({ daysBefore: -1, time: '09:00' }).success).toBe(false);
    expect(reminderEntrySchema.safeParse({ daysBefore: 1.5, time: '09:00' }).success).toBe(false);
  });

  it('rejects daysBefore beyond 30', () => {
    expect(reminderEntrySchema.safeParse({ daysBefore: 31, time: '09:00' }).success).toBe(false);
  });
});

describe('remindersConfigSchema', () => {
  const validEntry = { daysBefore: 0, time: '09:00' };
  const validOverdue = { enabled: true, time: '09:00' };

  it('accepts a well-formed config', () => {
    const result = remindersConfigSchema.safeParse({
      entries: [validEntry],
      overdue: validOverdue,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty entries array (overdue-only reminders)', () => {
    const result = remindersConfigSchema.safeParse({ entries: [], overdue: validOverdue });
    expect(result.success).toBe(true);
  });

  it('rejects more than 5 entries', () => {
    const result = remindersConfigSchema.safeParse({
      entries: Array.from({ length: 6 }, () => validEntry),
      overdue: validOverdue,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 5 entries', () => {
    const result = remindersConfigSchema.safeParse({
      entries: Array.from({ length: 5 }, () => validEntry),
      overdue: validOverdue,
    });
    expect(result.success).toBe(true);
  });

  // Defaults exist so an unedited time picker (which renders a '09:00'
  // visual fallback) never fails validation on submit.
  it('fills in a default overdue block when omitted', () => {
    const result = remindersConfigSchema.parse({ entries: [validEntry] });
    expect(result.overdue).toEqual({ enabled: false, time: '09:00' });
  });

  it('fills in a default overdue time when only enabled is provided', () => {
    const result = remindersConfigSchema.parse({
      entries: [validEntry],
      overdue: { enabled: true },
    });
    expect(result.overdue).toEqual({ enabled: true, time: '09:00' });
  });

  it('fills in a default entry time when omitted', () => {
    const result = remindersConfigSchema.parse({
      entries: [{ daysBefore: 2 }],
      overdue: validOverdue,
    });
    expect(result.entries[0]).toEqual({ daysBefore: 2, time: '09:00' });
  });

  it('still rejects an explicitly malformed overdue time', () => {
    const result = remindersConfigSchema.safeParse({
      entries: [validEntry],
      overdue: { enabled: true, time: '25:00' },
    });
    expect(result.success).toBe(false);
  });
});
