import { describe, it, expect } from 'vitest';
import { parseLocalDate, toDateString } from '../date';

describe('parseLocalDate', () => {
  it('should parse ISO string with UTC midnight without timezone shift', () => {
    // This is the critical bug case: UTC midnight shifts to previous day in UTC-3
    const result = parseLocalDate('2026-02-01T00:00:00.000Z');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February (0-indexed)
    expect(result.getDate()).toBe(1);
  });

  it('should parse date-only string correctly', () => {
    const result = parseLocalDate('2026-02-01');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(1);
  });

  it('should handle Date objects from UTC', () => {
    const utcDate = new Date(Date.UTC(2026, 0, 31, 23, 0, 0)); // Jan 31 23:00 UTC
    const result = parseLocalDate(utcDate);
    // Should keep the UTC date (Jan 31), not shift
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(31);
  });

  it('should set time to noon to avoid DST issues', () => {
    const result = parseLocalDate('2026-03-15T00:00:00.000Z');
    expect(result.getHours()).toBe(12);
  });

  it('should not shift month boundaries', () => {
    // Test all month boundaries with UTC midnight
    const months = [
      { iso: '2026-01-01T00:00:00.000Z', month: 0, day: 1 },
      { iso: '2026-02-01T00:00:00.000Z', month: 1, day: 1 },
      { iso: '2026-03-01T00:00:00.000Z', month: 2, day: 1 },
      { iso: '2026-04-01T00:00:00.000Z', month: 3, day: 1 },
      { iso: '2026-12-31T00:00:00.000Z', month: 11, day: 31 },
    ];

    for (const { iso, month, day } of months) {
      const result = parseLocalDate(iso);
      expect(result.getMonth()).toBe(month);
      expect(result.getDate()).toBe(day);
    }
  });
});

describe('toDateString', () => {
  it('should format as YYYY-MM-DD', () => {
    const date = new Date(2026, 1, 9, 12, 0, 0); // Feb 9, 2026
    expect(toDateString(date)).toBe('2026-02-09');
  });

  it('should pad single-digit months and days', () => {
    const date = new Date(2026, 0, 5, 12, 0, 0); // Jan 5
    expect(toDateString(date)).toBe('2026-01-05');
  });
});
