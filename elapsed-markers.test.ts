import assert from "node:assert/strict";
import { test } from "node:test";
import {
  elapsedPercent,
  remainingMsFromCompact,
  remainingMsFromResetText,
  tickColor,
  windowMsFromLabel,
} from "./elapsed-markers.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("window length comes from the Claude / Codex label", () => {
  assert.equal(windowMsFromLabel("Five-hour limit"), 5 * HOUR);
  assert.equal(windowMsFromLabel("Current session"), 5 * HOUR);
  assert.equal(windowMsFromLabel("5 hours"), 5 * HOUR);
  assert.equal(windowMsFromLabel("Weekly limit"), 7 * DAY);
  assert.equal(windowMsFromLabel("Weekly · Fable"), 7 * DAY);
  assert.equal(windowMsFromLabel("Weekly Opus limit"), 7 * DAY);
  assert.equal(windowMsFromLabel("Daily limit"), DAY);
  assert.equal(windowMsFromLabel("Today $0.32"), null);
  assert.equal(windowMsFromLabel("Month $44.25"), null);
});

test("remaining time comes from the sidebar's compact figure", () => {
  assert.equal(remainingMsFromCompact("35m"), 35 * MINUTE);
  assert.equal(remainingMsFromCompact("4h"), 4 * HOUR);
  assert.equal(remainingMsFromCompact("4h 12m"), 4 * HOUR + 12 * MINUTE);
  assert.equal(remainingMsFromCompact("6d"), 6 * DAY);
  assert.equal(remainingMsFromCompact("6d 23h"), 6 * DAY + 23 * HOUR);
  assert.equal(remainingMsFromCompact("now"), 0);
  assert.equal(remainingMsFromCompact("—"), null);
  assert.equal(remainingMsFromCompact("37%"), null);
});

test("remaining time comes from the panel's reset sentence", () => {
  // Wednesday 11 Nov 2026, 10:00 local time.
  const now = new Date(2026, 10, 11, 10, 0).getTime();
  assert.equal(remainingMsFromResetText("Resetting now", now), 0);
  assert.equal(remainingMsFromResetText("Resets in 12 min", now), 12 * MINUTE);
  assert.equal(remainingMsFromResetText("Resets in 3 hr", now), 3 * HOUR);
  assert.equal(remainingMsFromResetText("Resets in 3 hr 5 min", now), 3 * HOUR + 5 * MINUTE);
  // Within a week bb prints weekday and time.
  assert.equal(
    remainingMsFromResetText("Resets Mon 3:59 PM", now),
    new Date(2026, 10, 16, 15, 59).getTime() - now,
  );
  // Same weekday, earlier hour: next week.
  assert.equal(
    remainingMsFromResetText("Resets Wed 9:00 AM", now),
    new Date(2026, 10, 18, 9, 0).getTime() - now,
  );
  assert.equal(
    remainingMsFromResetText("Resets Thu 12:30 AM", now),
    new Date(2026, 10, 12, 0, 30).getTime() - now,
  );
  // Further out bb prints month and day.
  assert.equal(
    remainingMsFromResetText("Resets Dec 1, 12:00 AM", now),
    new Date(2026, 11, 1, 0, 0).getTime() - now,
  );
  assert.equal(remainingMsFromResetText("Reset time not reported.", now), null);
  assert.equal(remainingMsFromResetText("Resets 18.11. 15:59", now), null);
});

test("elapsed share of the window", () => {
  assert.equal(elapsedPercent(5 * HOUR, 5 * HOUR), 0);
  assert.equal(elapsedPercent(5 * HOUR, 4 * HOUR), 20);
  assert.equal(elapsedPercent(7 * DAY, 0), 100);
  // Clock skew or rounding past the window clamps.
  assert.equal(elapsedPercent(5 * HOUR, 6 * HOUR), 0);
  assert.equal(elapsedPercent(5 * HOUR, -MINUTE), 100);
});

test("the tick cuts the fill in the background colour and marks the empty track in the foreground", () => {
  assert.equal(tickColor(30, 37), "var(--background)");
  assert.equal(tickColor(96, 37), "var(--foreground)");
  assert.equal(tickColor(37, 37), "var(--foreground)");
});
