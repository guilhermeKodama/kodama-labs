import { describe, it, expect } from 'vitest';
import {
  createRecurringTransactionSchema,
  updateRecurringTransactionSchema,
} from '../recurring';

const baseInput = {
  entityId: 'entity-1',
  entityType: 'personal' as const,
  type: 'expense' as const,
  amount: 100,
  currency: 'USD',
  description: 'Rent',
  category: 'Housing',
  frequency: 'monthly' as const,
  startDate: new Date('2026-01-01'),
};

describe('createRecurringTransactionSchema', () => {
  it('defaults autoGenerateTransaction to true when omitted', () => {
    const result = createRecurringTransactionSchema.parse(baseInput);
    expect(result.autoGenerateTransaction).toBe(true);
  });

  it('preserves autoGenerateTransaction when explicitly set to false', () => {
    const result = createRecurringTransactionSchema.parse({
      ...baseInput,
      autoGenerateTransaction: false,
    });
    expect(result.autoGenerateTransaction).toBe(false);
  });

  it('accepts a valid reminders config', () => {
    const result = createRecurringTransactionSchema.parse({
      ...baseInput,
      autoGenerateTransaction: false,
      reminders: {
        entries: [{ daysBefore: 0, time: '09:00' }],
        overdue: { enabled: true, time: '09:00' },
      },
    });
    expect(result.reminders?.entries).toHaveLength(1);
    expect(result.reminders?.overdue.enabled).toBe(true);
  });

  it('rejects a malformed reminders config', () => {
    const result = createRecurringTransactionSchema.safeParse({
      ...baseInput,
      autoGenerateTransaction: false,
      reminders: {
        entries: [{ daysBefore: 0, time: '9:00' }], // missing leading zero
        overdue: { enabled: true, time: '09:00' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('omits reminders when not provided', () => {
    const result = createRecurringTransactionSchema.parse(baseInput);
    expect(result.reminders).toBeUndefined();
  });
});

describe('updateRecurringTransactionSchema', () => {
  it('does not inject autoGenerateTransaction when omitted from a partial update', () => {
    const result = updateRecurringTransactionSchema.parse({});
    expect('autoGenerateTransaction' in result).toBe(false);
  });
});
