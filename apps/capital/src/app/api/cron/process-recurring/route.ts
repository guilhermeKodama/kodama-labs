import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfDay,
  endOfDay,
  isAfter,
} from "date-fns";
import type { RecurrenceFrequency } from "@prisma/client";

/**
 * Calculate the next occurrence date based on frequency
 */
function getNextOccurrence(currentDate: Date, frequency: RecurrenceFrequency): Date {
  const date = startOfDay(currentDate);
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
    const today = startOfDay(now);
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
      let currentDueDate = startOfDay(recurring.nextDueDate);
      let transactionsForThisRecurring = 0;

      // Generate transactions for all due dates up to today (inclusive)
      while (!isAfter(currentDueDate, todayEnd)) {
        // Stop if we've passed the end date
        if (recurring.endDate && isAfter(currentDueDate, startOfDay(recurring.endDate))) {
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

    return NextResponse.json({
      success: true,
      message: `Generated ${generatedCount} transaction(s) from ${results.length} recurring transaction(s)`,
      processedAt: now.toISOString(),
      details: results,
    });
  } catch (error) {
    console.error("Error processing recurring transactions:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
