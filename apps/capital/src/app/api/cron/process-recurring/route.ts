import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  endOfDay,
  isAfter,
} from "date-fns";
import type { RecurrenceFrequency } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";

/**
 * Calculate the next occurrence date based on frequency
 */
function getNextOccurrence(currentDate: Date, frequency: RecurrenceFrequency): Date {
  const date = toNoonUTC(currentDate);
  switch (frequency) {
    case "daily":
      return addDays(date, 1);
    case "weekly":
      return addWeeks(date, 1);
    case "monthly":
      return addMonths(date, 1);
    case "yearly":
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
}

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  // In production, always require CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const now = new Date();
    const today = toNoonUTC(now);
    const todayEnd = endOfDay(now);

    // Find all active recurring transactions that are due
    // Use endOfDay to include all transactions due today regardless of time component
    const dueRecurring = await prisma.recurringTransaction.findMany({
      where: {
        isActive: true,
        nextDueDate: {
          lte: todayEnd,
        },
        OR: [
          { endDate: null },
          { endDate: { gte: today } },
        ],
      },
    });

    let generatedCount = 0;
    const results: Array<{
      recurringId: string;
      transactionsGenerated: number;
      nextDueDate: string;
    }> = [];

    // Process each due recurring transaction
    for (const recurring of dueRecurring) {
      let currentDueDate = toNoonUTC(recurring.nextDueDate);
      let transactionsForThisRecurring = 0;

      // Generate transactions for all due dates up to today (inclusive)
      while (!isAfter(currentDueDate, todayEnd)) {
        // Stop if we've passed the end date
        if (recurring.endDate && isAfter(currentDueDate, toNoonUTC(recurring.endDate))) {
          break;
        }

        // Create the transaction
        await prisma.transaction.create({
          data: {
            entityType: recurring.entityType,
            type: recurring.type,
            amount: recurring.amount,
            currency: recurring.currency,
            exchangeRate: recurring.exchangeRate,
            description: recurring.description,
            category: recurring.category,
            date: currentDueDate,
            recurringTransactionId: recurring.id,
            businessId: recurring.businessId,
            personalAccountId: recurring.personalAccountId,
          },
        });

        generatedCount++;
        transactionsForThisRecurring++;

        // Move to next occurrence
        currentDueDate = getNextOccurrence(currentDueDate, recurring.frequency);
      }

      // Update the recurring transaction with new nextDueDate and lastGeneratedDate
      if (transactionsForThisRecurring > 0) {
        await prisma.recurringTransaction.update({
          where: { id: recurring.id },
          data: {
            nextDueDate: currentDueDate,
            lastGeneratedDate: today,
          },
        });

        results.push({
          recurringId: recurring.id,
          transactionsGenerated: transactionsForThisRecurring,
          nextDueDate: currentDueDate.toISOString(),
        });
      }
    }

    // ============================================
    // PROCESS RECURRING TRANSFERS
    // ============================================
    
    const dueRecurringTransfers = await prisma.recurringTransfer.findMany({
      where: {
        isActive: true,
        nextDueDate: {
          lte: todayEnd,
        },
        OR: [
          { endDate: null },
          { endDate: { gte: today } },
        ],
      },
    });

    let generatedTransferCount = 0;
    const transferResults: Array<{
      recurringTransferId: string;
      transfersGenerated: number;
      nextDueDate: string;
    }> = [];

    // Process each due recurring transfer
    for (const recurringTransfer of dueRecurringTransfers) {
      let currentDueDate = toNoonUTC(recurringTransfer.nextDueDate);
      let transfersForThisRecurring = 0;

      // Generate transfers for all due dates up to today (inclusive)
      while (!isAfter(currentDueDate, todayEnd)) {
        // Stop if we've passed the end date
        if (recurringTransfer.endDate && isAfter(currentDueDate, toNoonUTC(recurringTransfer.endDate))) {
          break;
        }

        // Create the transfer
        await prisma.transfer.create({
          data: {
            fromEntityType: recurringTransfer.fromEntityType,
            toEntityType: recurringTransfer.toEntityType,
            direction: recurringTransfer.direction,
            amount: recurringTransfer.amount,
            currency: recurringTransfer.currency,
            exchangeRate: recurringTransfer.exchangeRate,
            description: recurringTransfer.description,
            date: currentDueDate,
            recurringTransferId: recurringTransfer.id,
            fromBusinessId: recurringTransfer.fromBusinessId,
            fromPersonalAccountId: recurringTransfer.fromPersonalAccountId,
            toBusinessId: recurringTransfer.toBusinessId,
            toPersonalAccountId: recurringTransfer.toPersonalAccountId,
          },
        });

        generatedTransferCount++;
        transfersForThisRecurring++;

        // Move to next occurrence
        currentDueDate = getNextOccurrence(currentDueDate, recurringTransfer.frequency);
      }

      // Update the recurring transfer with new nextDueDate and lastGeneratedDate
      if (transfersForThisRecurring > 0) {
        await prisma.recurringTransfer.update({
          where: { id: recurringTransfer.id },
          data: {
            nextDueDate: currentDueDate,
            lastGeneratedDate: today,
          },
        });

        transferResults.push({
          recurringTransferId: recurringTransfer.id,
          transfersGenerated: transfersForThisRecurring,
          nextDueDate: currentDueDate.toISOString(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Generated ${generatedCount} transaction(s) from ${results.length} recurring transaction(s) and ${generatedTransferCount} transfer(s) from ${transferResults.length} recurring transfer(s)`,
      processedAt: now.toISOString(),
      transactions: results,
      transfers: transferResults,
    });
  } catch (error) {
    console.error("Error processing recurring items:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
