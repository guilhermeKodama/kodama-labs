import type { DbClient } from "@capital/server/lib/prisma";

const FRANKFURTER_API = "https://api.frankfurter.dev/v1/latest";

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface UpdateRatesResult {
  usersProcessed: number;
  ratesUpdated: number;
  errors: number;
}

/**
 * Fetch latest exchange rates from Frankfurter API and update all users' currency rates.
 * Frankfurter is free, no API key, backed by ECB data.
 *
 * For each user, we fetch rates relative to their baseCurrency,
 * then update all their Currency records with the latest manualRate.
 */
export async function updateAllCurrencyRates(
  db: DbClient
): Promise<UpdateRatesResult> {
  const result: UpdateRatesResult = {
    usersProcessed: 0,
    ratesUpdated: 0,
    errors: 0,
  };

  // Get all users with their base currency and their currency records
  const users = await db.user.findMany({
    select: {
      id: true,
      baseCurrency: true,
      currencies: {
        select: {
          id: true,
          code: true,
        },
      },
    },
  });

  // Group users by base currency to minimize API calls
  const usersByBaseCurrency: Record<
    string,
    Array<{ id: string; currencies: Array<{ id: string; code: string }> }>
  > = {};

  for (const user of users) {
    if (!usersByBaseCurrency[user.baseCurrency]) {
      usersByBaseCurrency[user.baseCurrency] = [];
    }
    usersByBaseCurrency[user.baseCurrency].push({
      id: user.id,
      currencies: user.currencies,
    });
  }

  // Fetch rates for each unique base currency
  for (const [baseCurrency, usersForBase] of Object.entries(
    usersByBaseCurrency
  )) {
    // Collect all unique target currencies needed
    const targetCodes = new Set<string>();
    for (const user of usersForBase) {
      for (const curr of user.currencies) {
        if (curr.code !== baseCurrency) {
          targetCodes.add(curr.code);
        }
      }
    }

    if (targetCodes.size === 0) {
      result.usersProcessed += usersForBase.length;
      continue;
    }

    // Fetch rates from Frankfurter
    const to = Array.from(targetCodes).join(",");
    const url = `${FRANKFURTER_API}?base=${baseCurrency}&symbols=${to}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(
          `[RateUpdate] Frankfurter error for base ${baseCurrency}: ${res.status}`
        );
        result.errors++;
        continue;
      }

      const data = (await res.json()) as FrankfurterResponse;

      // Update each user's currency records
      for (const user of usersForBase) {
        for (const curr of user.currencies) {
          if (curr.code === baseCurrency) {
            // Base currency rate is always 1
            continue;
          }

          const rate = data.rates[curr.code];
          if (rate !== undefined) {
            try {
              await db.currency.update({
                where: { id: curr.id },
                data: { manualRate: rate },
              });
              result.ratesUpdated++;
            } catch (err) {
              console.error(
                `[RateUpdate] Failed to update ${curr.code} for user ${user.id}:`,
                err
              );
              result.errors++;
            }
          }
        }
        result.usersProcessed++;
      }
    } catch (error) {
      console.error(
        `[RateUpdate] Frankfurter fetch failed for base ${baseCurrency}:`,
        error
      );
      result.errors++;
    }
  }

  return result;
}
