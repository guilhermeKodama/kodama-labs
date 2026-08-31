import { z } from 'zod';

// Reminder-mode push config for a RecurringTransaction, stored as the
// `reminders` JSON column. Google-Calendar-style: N configurable entries
// (offset before the due date + time of day) plus an optional daily nag that
// keeps firing every day the item stays overdue, until Mark as Paid /
// Concluir advances nextDueDate. NULL on the row means "not configured" —
// the reminder cron treats that as feature-off, not "send nothing configured".

export const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const reminderEntrySchema = z.object({
  /** 0 = on the due date itself; N = N days before. */
  daysBefore: z.number().int().min(0).max(30),
  time: reminderTimeSchema.default('09:00'),
});

// Every field carries a default so an unedited control never fails
// validation. The form renders time pickers with a '09:00' visual fallback
// for values it hasn't written yet; without matching defaults here, submitting
// without touching those pickers would reject on a value the user can see.
export const remindersConfigSchema = z.object({
  entries: z.array(reminderEntrySchema).max(5).default([]),
  overdue: z
    .object({
      enabled: z.boolean().default(false),
      time: reminderTimeSchema.default('09:00'),
    })
    .default({ enabled: false, time: '09:00' }),
});

export type ReminderEntry = z.infer<typeof reminderEntrySchema>;
export type RemindersConfig = z.infer<typeof remindersConfigSchema>;

/** Seeded the first time a recurring transaction is switched into Lembrete mode. */
export const DEFAULT_REMINDERS_CONFIG: RemindersConfig = {
  entries: [{ daysBefore: 0, time: '09:00' }],
  overdue: { enabled: true, time: '09:00' },
};

export const REMINDER_DAYS_BEFORE_PRESETS = [0, 1, 2, 3, 7] as const;
