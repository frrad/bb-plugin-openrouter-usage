// Pure conversion from OpenRouter's key and credit figures to provider-usage
// windows. Kept free of I/O so it can be tested directly.

/** Spend for one API key, from GET /api/v1/key. Amounts are USD. */
export type KeySpend = {
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
};

/** Account-wide balance, from GET /api/v1/credits. Amounts are USD. */
export type CreditBalance = {
  totalCredits: number;
  totalUsage: number;
};

export type UsageWindow = {
  kind: "custom";
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  model: null;
  cost: { usedUsdCents: number; limitUsdCents: number };
};

export type Usage = {
  accountEmail: string | null;
  planLabel: string | null;
  windows: UsageWindow[];
};

function formatUsd(amount: number): string {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

/** Always cents, so small spend like $0.05 stays visible. */
function formatSpend(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// The usage UI shows only the label and a percentage on each bar row, so the
// spend goes in the label. Names stay short to fit the sidebar.
function window(
  id: string,
  name: string,
  usedUsd: number,
  limitUsd: number,
  resetsAt: Date | null,
): UsageWindow {
  const usedUsdCents = Math.max(0, usedUsd) * 100;
  const limitUsdCents = limitUsd * 100;
  return {
    kind: "custom",
    id,
    label: `${name} ${formatSpend(Math.max(0, usedUsd))}`,
    // Exceeds 100 when over budget; the usage UI caps the bar and turns it red.
    usedPercent: Math.round((usedUsdCents / limitUsdCents) * 1000) / 10,
    resetsAt: resetsAt?.toISOString() ?? null,
    model: null,
    cost: {
      usedUsdCents: Math.round(usedUsdCents * 100) / 100,
      limitUsdCents: Math.round(limitUsdCents * 100) / 100,
    },
  };
}

// OpenRouter's daily, weekly and monthly key usage roll over in UTC, and the
// week starts on Monday.
function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

function nextUtcMonday(now: Date): Date {
  const daysUntilMonday = ((8 - now.getUTCDay()) % 7) || 7;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilMonday,
    ),
  );
}

function nextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function daysInUtcMonth(now: Date): number {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

export function buildUsage({
  key,
  credits,
  monthlyBudgetUsd,
  accountLabel,
  now,
}: {
  key: KeySpend;
  credits: CreditBalance | null;
  monthlyBudgetUsd: number;
  /** Shown as the account line; OpenRouter's API does not expose the email. */
  accountLabel: string;
  now: Date;
}): Usage {
  const windows: UsageWindow[] = [];
  // The badge beside the account: how far over budget, then credit left.
  // Every window row adds a "% used" figure, so the balance lives here.
  const badge: string[] = [];

  if (monthlyBudgetUsd > 0) {
    const dailyBudgetUsd = monthlyBudgetUsd / daysInUtcMonth(now);
    windows.push(
      window("today", "Today", key.usageDaily, dailyBudgetUsd, nextUtcMidnight(now)),
      window(
        "week",
        "Week",
        key.usageWeekly,
        dailyBudgetUsd * 7,
        nextUtcMonday(now),
      ),
      window(
        "month",
        "Month",
        key.usageMonthly,
        monthlyBudgetUsd,
        nextUtcMonth(now),
      ),
    );
    const overUsd = key.usageMonthly - monthlyBudgetUsd;
    if (overUsd > 0) badge.push(`${formatUsd(overUsd)} over budget`);
  }

  if (credits !== null && credits.totalCredits > 0) {
    const remainingUsd = Math.max(0, credits.totalCredits - credits.totalUsage);
    badge.push(`${formatUsd(Math.round(remainingUsd * 100) / 100)} left`);
  }

  return {
    accountEmail: accountLabel.trim() || null,
    planLabel: badge.length > 0 ? badge.join(" · ") : null,
    windows,
  };
}
