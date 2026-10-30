import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUsage, keySpendFromResponse } from "./usage.ts";

// 2026-10-25 is a Sunday; October has 31 days.
const sundayNoonUtc = new Date("2026-10-25T12:00:00Z");

test("budget windows are scoped to the key and derived from the monthly budget", () => {
  const usage = buildUsage({
    key: {
      usageDaily: 1,
      usageWeekly: 7,
      usageMonthly: 15.5,
    },
    credits: { totalCredits: 30, totalUsage: 19.5 },
    monthlyBudgetUsd: 31,
    accountLabel: "me@example.com",
    now: sundayNoonUtc,
  });

  assert.equal(usage.accountEmail, "me@example.com");
  assert.equal(usage.planLabel, "$10.50 left");
  assert.deepEqual(usage.windows, [
    {
      kind: "custom",
      id: "today",
      label: "Today $1.00",
      usedPercent: 100,
      resetsAt: "2026-10-26T00:00:00.000Z",
      model: null,
      cost: { usedUsdCents: 100, limitUsdCents: 100 },
    },
    {
      kind: "custom",
      id: "week",
      label: "Week $7.00",
      usedPercent: 100,
      resetsAt: "2026-10-26T00:00:00.000Z",
      model: null,
      cost: { usedUsdCents: 700, limitUsdCents: 700 },
    },
    {
      kind: "custom",
      id: "month",
      label: "Month $15.50",
      usedPercent: 50,
      resetsAt: "2026-11-01T00:00:00.000Z",
      model: null,
      cost: { usedUsdCents: 1550, limitUsdCents: 3100 },
    },
  ]);
});

test("going over budget reports more than 100% and says how much over the month is", () => {
  const usage = buildUsage({
    key: { usageDaily: 3, usageWeekly: 3, usageMonthly: 46.5 },
    credits: { totalCredits: 100, totalUsage: 46.5 },
    monthlyBudgetUsd: 31,
    accountLabel: "",
    now: sundayNoonUtc,
  });

  const today = usage.windows.find((window) => window.id === "today");
  const month = usage.windows.find((window) => window.id === "month");
  assert.equal(today?.usedPercent, 300);
  assert.deepEqual(today?.cost, { usedUsdCents: 300, limitUsdCents: 100 });
  assert.equal(month?.usedPercent, 150);
  assert.equal(usage.planLabel, "$15.50 over budget · $53.50 left");
});

test("the week resets on the next Monday even mid-week", () => {
  const wednesday = new Date("2026-10-28T08:00:00Z");
  const usage = buildUsage({
    key: { usageDaily: 0, usageWeekly: 0, usageMonthly: 0 },
    credits: null,
    monthlyBudgetUsd: 31,
    accountLabel: "",
    now: wednesday,
  });

  const week = usage.windows.find((window) => window.id === "week");
  assert.equal(week?.resetsAt, "2026-11-02T00:00:00.000Z");
});

test("without a budget only the credit balance is shown", () => {
  const usage = buildUsage({
    key: { usageDaily: 1, usageWeekly: 2, usageMonthly: 3 },
    credits: { totalCredits: 30, totalUsage: 3 },
    monthlyBudgetUsd: 0,
    accountLabel: "",
    now: sundayNoonUtc,
  });

  assert.deepEqual(usage.windows, []);
  assert.equal(usage.planLabel, "$27 left");
});

test("a missing or empty credit balance shows no badge", () => {
  const withoutCredits = buildUsage({
    key: { usageDaily: 0, usageWeekly: 0, usageMonthly: 0 },
    credits: null,
    monthlyBudgetUsd: 31,
    accountLabel: "",
    now: sundayNoonUtc,
  });
  const withZeroCredits = buildUsage({
    key: { usageDaily: 0, usageWeekly: 0, usageMonthly: 0 },
    credits: { totalCredits: 0, totalUsage: 0 },
    monthlyBudgetUsd: 31,
    accountLabel: "",
    now: sundayNoonUtc,
  });

  assert.equal(withoutCredits.planLabel, null);
  assert.equal(withZeroCredits.planLabel, null);
});

test("an empty account label shows no account line", () => {
  const usage = buildUsage({
    key: { usageDaily: 0, usageWeekly: 0, usageMonthly: 0 },
    credits: null,
    monthlyBudgetUsd: 31,
    accountLabel: "  ",
    now: sundayNoonUtc,
  });

  assert.equal(usage.accountEmail, null);
});

test("an overdrawn balance reads as $0 left", () => {
  const usage = buildUsage({
    key: { usageDaily: 0, usageWeekly: 0, usageMonthly: 0 },
    credits: { totalCredits: 30, totalUsage: 30.2 },
    monthlyBudgetUsd: 0,
    accountLabel: "",
    now: sundayNoonUtc,
  });

  assert.equal(usage.planLabel, "$0 left");
});

test("spend under a dollar keeps its cents in the label", () => {
  const usage = buildUsage({
    key: { usageDaily: 0.0496, usageWeekly: 0.156, usageMonthly: 0.156 },
    credits: null,
    monthlyBudgetUsd: 100,
    accountLabel: "",
    now: sundayNoonUtc,
  });

  assert.deepEqual(
    usage.windows.map((window) => window.label),
    ["Today $0.05", "Week $0.16", "Month $0.16"],
  );
});

test("key spend adds BYOK inference to OpenRouter usage", () => {
  assert.deepEqual(
    keySpendFromResponse({
      usage_daily: 2.13,
      usage_weekly: 10.62,
      usage_monthly: 10.62,
      byok_usage_daily: 28.16,
      byok_usage_weekly: 28.16,
      byok_usage_monthly: 28.16,
    }),
    { usageDaily: 2.13 + 28.16, usageWeekly: 10.62 + 28.16, usageMonthly: 10.62 + 28.16 },
  );
});

test("key spend treats missing or null BYOK usage as zero", () => {
  assert.deepEqual(
    keySpendFromResponse({
      usage_daily: 1,
      usage_weekly: 2,
      usage_monthly: 3,
      byok_usage_daily: null,
    }),
    { usageDaily: 1, usageWeekly: 2, usageMonthly: 3 },
  );
});
