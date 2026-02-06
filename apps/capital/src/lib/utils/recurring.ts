import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isAfter,
  startOfDay,
} from 'date-fns';
import type {
  RecurringTransaction,
  CreateTransactionInput,
  RecurrenceFrequency,
} from '@/types';

/**
 * Calculate the next occurrence date based on frequency
 */
export function getNextOccurrence(
  currentDate: Date,
  frequency: RecurrenceFrequency
): Date {
  const date = startOfDay(currentDate);
  switch (frequency) {
    case 'daily':
      return addDays(date, 1);
    case 'weekly':
      return addWeeks(date, 1);
    case 'monthly':
      return addMonths(date, 1);
    case 'yearly':
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
}

/**
 * Get all occurrence dates between two dates
 */
export function getOccurrencesBetween(
  startDate: Date,
  endDate: Date,
  frequency: RecurrenceFrequency
): Date[] {
  const occurrences: Date[] = [];
  let current = startOfDay(startDate);
  const end = startOfDay(endDate);

  while (!isAfter(current, end)) {
    occurrences.push(current);
    current = getNextOccurrence(current, frequency);
  }

  return occurrences;
}

/**
 * Check if a recurring transaction is due (should generate a transaction)
 */
export function isDue(recurring: RecurringTransaction, asOfDate: Date = new Date()): boolean {
  if (!recurring.isActive) return false;

  const today = startOfDay(asOfDate);
  const nextDue = startOfDay(new Date(recurring.nextDueDate));

  // Check if the recurring transaction has an end date and if we've passed it
  if (recurring.endDate && isAfter(today, startOfDay(new Date(recurring.endDate)))) {
    return false;
  }

  // Check if we're at or past the next due date
  return !isAfter(nextDue, today);
}

/**
 * Get all recurring transactions that are due
 */
export function getDueRecurringTransactions(
  recurringTransactions: RecurringTransaction[],
  asOfDate: Date = new Date()
): RecurringTransaction[] {
  return recurringTransactions.filter((rt) => isDue(rt, asOfDate));
}

/**
 * Generate a transaction from a recurring transaction
 */
export function generateTransactionFromRecurring(
  recurring: RecurringTransaction,
  transactionDate: Date
): CreateTransactionInput {
  return {
    entityId: recurring.entityId,
    entityType: recurring.entityType,
    type: recurring.type,
    amount: recurring.amount,
    currency: recurring.currency,
    exchangeRate: recurring.exchangeRate,
    description: recurring.description,
    category: recurring.category,
    date: transactionDate,
    recurringTransactionId: recurring.id,
  };
}

/**
 * Generate all due transactions for a recurring transaction
 * This handles cases where multiple occurrences might be due (e.g., app not opened for a while)
 */
export function generateDueTransactions(
  recurring: RecurringTransaction,
  asOfDate: Date = new Date()
): CreateTransactionInput[] {
  if (!recurring.isActive) return [];

  const transactions: CreateTransactionInput[] = [];
  const today = startOfDay(asOfDate);
  let currentDueDate = startOfDay(new Date(recurring.nextDueDate));

  // Check end date
  const endDate = recurring.endDate ? startOfDay(new Date(recurring.endDate)) : null;

  // Generate transactions for all due dates up to today
  while (!isAfter(currentDueDate, today)) {
    // Stop if we've passed the end date
    if (endDate && isAfter(currentDueDate, endDate)) {
      break;
    }

    transactions.push(generateTransactionFromRecurring(recurring, currentDueDate));
    currentDueDate = getNextOccurrence(currentDueDate, recurring.frequency);
  }

  return transactions;
}

/**
 * Get human-readable frequency label
 */
export function getFrequencyLabel(frequency: RecurrenceFrequency): string {
  const labels: Record<RecurrenceFrequency, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly',
  };
  return labels[frequency];
}

/**
 * Get the appropriate preposition for a frequency
 */
export function getFrequencyPreposition(frequency: RecurrenceFrequency): string {
  switch (frequency) {
    case 'daily':
      return 'every day';
    case 'weekly':
      return 'every week';
    case 'monthly':
      return 'every month';
    case 'yearly':
      return 'every year';
    default:
      return '';
  }
}

/**
 * Calculate how many occurrences have happened since start
 */
export function countOccurrencesSince(
  startDate: Date,
  frequency: RecurrenceFrequency,
  asOfDate: Date = new Date()
): number {
  const occurrences = getOccurrencesBetween(startDate, asOfDate, frequency);
  return occurrences.length;
}

/**
 * Calculate total amount spent/earned from a recurring transaction since start
 */
export function calculateTotalFromRecurring(
  recurring: RecurringTransaction,
  asOfDate: Date = new Date()
): number {
  const start = new Date(recurring.startDate);
  const end = recurring.endDate 
    ? new Date(Math.min(new Date(recurring.endDate).getTime(), asOfDate.getTime()))
    : asOfDate;
  
  const occurrences = countOccurrencesSince(start, recurring.frequency, end);
  return recurring.amount * occurrences;
}
