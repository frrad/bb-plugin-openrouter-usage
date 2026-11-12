// Draws how much of each Claude Code / Codex limit window has elapsed on its
// Provider usage bar: a thin vertical tick at the elapsed share of the window.
// Usage fill past the tick means usage is ahead of time.
//
// bb's usage data has no window length and bb has no slot for usage bars, so
// this reads the DOM of the built-in provider-usage plugin: the window length
// from the label ("Five-hour limit", "Weekly limit") and the time left from the
// reset figure beside the bar. A bb update that changes either stops the lines
// appearing; nothing else breaks.

import { PANEL_TRACK, SIDEBAR_TRACK } from "./budget-markers.ts";

/** Set on the line element this script adds to a track. */
const LINE = "data-openrouter-elapsed-line";
/** Set on a track this script made position: relative. */
const POSITIONED = "data-openrouter-elapsed-positioned";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Window length for a limit label, or null for windows without a fixed length. */
export function windowMsFromLabel(label: string): number | null {
  const text = label.trim();
  if (/^(Five-hour|5 hours?\b|5h\b|Current session)/iu.test(text)) return 5 * HOUR;
  if (/^(Weekly|7d\b)/iu.test(text)) return 7 * DAY;
  if (/^(Daily limit|1d\b)/iu.test(text)) return DAY;
  return null;
}

/** Time left from the sidebar's compact figure: "35m", "4h 12m", "6d 23h", "now". */
export function remainingMsFromCompact(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "now") return 0;
  const match = /^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/u.exec(trimmed);
  if (match === null || trimmed === "") return null;
  const [, days, hours, minutes] = match;
  return Number(days ?? 0) * DAY + Number(hours ?? 0) * HOUR + Number(minutes ?? 0) * MINUTE;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hours24(hour: number, meridiem: string): number {
  const pm = meridiem.toUpperCase() === "PM";
  return (hour % 12) + (pm ? 12 : 0);
}

/**
 * Time left from the Settings panel's sentence: "Resets in 3 hr 5 min",
 * "Resetting now", or (past a day, en-US only) "Resets Mon 3:59 PM" /
 * "Resets Dec 1, 12:00 AM". Null for anything else.
 */
export function remainingMsFromResetText(text: string, now: number): number | null {
  const trimmed = text.trim().replace(/ /gu, " ");
  if (trimmed === "Resetting now") return 0;

  const relative = /^Resets in (?:(\d+) hr)?\s*(?:(\d+) min)?$/u.exec(trimmed);
  if (relative !== null && (relative[1] !== undefined || relative[2] !== undefined)) {
    return Number(relative[1] ?? 0) * HOUR + Number(relative[2] ?? 0) * MINUTE;
  }

  const weekday = /^Resets (\w{3}),? (\d{1,2}):(\d{2}) (AM|PM)$/iu.exec(trimmed);
  if (weekday !== null) {
    const day = WEEKDAYS.indexOf(weekday[1]!);
    if (day < 0) return null;
    const target = new Date(now);
    target.setHours(hours24(Number(weekday[2]), weekday[4]!), Number(weekday[3]), 0, 0);
    let ahead = (day - target.getDay() + 7) % 7;
    if (ahead === 0 && target.getTime() <= now) ahead = 7;
    target.setDate(target.getDate() + ahead);
    return target.getTime() - now;
  }

  const dated = /^Resets (\w{3}) (\d{1,2}),? (\d{1,2}):(\d{2}) (AM|PM)$/iu.exec(trimmed);
  if (dated !== null) {
    const month = MONTHS.indexOf(dated[1]!);
    if (month < 0) return null;
    const current = new Date(now);
    const target = new Date(
      current.getFullYear(),
      month,
      Number(dated[2]),
      hours24(Number(dated[3]), dated[5]!),
      Number(dated[4]),
    );
    if (target.getTime() < now) target.setFullYear(target.getFullYear() + 1);
    return target.getTime() - now;
  }
  return null;
}

/** Share of the window that has passed, 0-100. */
export function elapsedPercent(windowMs: number, remainingMs: number): number {
  const percent = ((windowMs - remainingMs) / windowMs) * 100;
  return Math.min(100, Math.max(0, percent));
}

function removeLine(track: HTMLElement): void {
  track.querySelector(`:scope > [${LINE}]`)?.remove();
  if (track.hasAttribute(POSITIONED)) {
    track.style.removeProperty("position");
    track.removeAttribute(POSITIONED);
  }
}

/**
 * Tick colour: the page background where the tick sits on the usage fill, so
 * it cuts a gap in it; the foreground on the empty track.
 */
export function tickColor(elapsed: number, usedWidth: number): string {
  return elapsed < usedWidth ? "var(--background)" : "var(--foreground)";
}

function drawLine(track: HTMLElement, percent: number | null): void {
  if (percent === null) {
    removeLine(track);
    return;
  }
  const at = Math.round(percent * 10) / 10;
  // Keep the 2px tick inside the rounded track at 0% and 100%.
  const left = `clamp(0px, calc(${at}% - 1px), calc(100% - 2px))`;
  const fill = track.firstElementChild as HTMLElement | null;
  const used = Number.parseFloat(fill?.style.width ?? "") || 0;
  const color = tickColor(at, used);
  let line = track.querySelector<HTMLElement>(`:scope > [${LINE}]`);
  // Runs from a MutationObserver, so only write on change.
  if (line !== null && line.dataset["at"] === String(at) && line.dataset["color"] === color) return;
  if (line === null) {
    if (getComputedStyle(track).position === "static") {
      track.style.position = "relative";
      track.setAttribute(POSITIONED, "");
    }
    line = document.createElement("span");
    line.setAttribute(LINE, "");
    line.setAttribute("aria-hidden", "true");
    Object.assign(line.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "2px",
      pointerEvents: "none",
    });
    track.append(line);
  }
  line.dataset["at"] = String(at);
  line.dataset["color"] = color;
  line.style.left = left;
  line.style.background = color;
}

function percentFor(label: string | null | undefined, remainingMs: number | null): number | null {
  if (label == null || remainingMs === null) return null;
  const windowMs = windowMsFromLabel(label);
  return windowMs === null ? null : elapsedPercent(windowMs, remainingMs);
}

export function decorateElapsedTime(now: number = Date.now()): void {
  for (const track of document.querySelectorAll<HTMLElement>(SIDEBAR_TRACK)) {
    // The row button's aria-label is "<full label>: <usage>. <reset>".
    const label = track.closest("button")?.getAttribute("aria-label")?.split(":")[0];
    const remaining = track.parentElement?.lastElementChild?.textContent;
    drawLine(track, percentFor(label, remaining == null ? null : remainingMsFromCompact(remaining)));
  }
  for (const track of document.querySelectorAll<HTMLElement>(PANEL_TRACK)) {
    const label = track.previousElementSibling?.firstElementChild?.textContent;
    const reset = track.nextElementSibling?.textContent;
    drawLine(track, percentFor(label, reset == null ? null : remainingMsFromResetText(reset, now)));
  }
}

export function clearElapsedTime(): void {
  for (const line of document.querySelectorAll(`[${LINE}]`)) line.remove();
  for (const track of document.querySelectorAll<HTMLElement>(`[${POSITIONED}]`)) {
    track.style.removeProperty("position");
    track.removeAttribute(POSITIONED);
  }
}
