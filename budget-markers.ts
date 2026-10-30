// Marks where 100% falls on over-budget Provider usage bars. bb caps a bar's
// fill at 100%, so past budget it is a solid red bar. This content script
// draws a thin line on the fill at budget / spend of its width, so the part
// past the line is the overage.
//
// bb has no slot for usage bars, so this finds them by their classes in the
// built-in provider-usage plugin: the sidebar rows and the Settings panel. A
// bb update that changes them stops the lines appearing; nothing else breaks.

/** Set on a fill this script has drawn on, so it can be cleaned up. */
const MARKED = "data-openrouter-budget-marker";

/** Sidebar: track span; its next sibling shows e.g. "1016%". */
const SIDEBAR_TRACK = "span.h-1.min-w-0.overflow-hidden.rounded-full";
/** Settings panel: track div; the row above ends with e.g. "$32.76 / $3.23". */
const PANEL_TRACK = "div.w-full.overflow-hidden.rounded-full.bg-muted";

/**
 * Percent used from the figure bb prints beside a bar: "$32.76 / $3.23",
 * "1016%" or "1016% used". Null when it isn't one of those.
 */
export function percentFromText(text: string): number | null {
  const money = /^\s*\$([\d,]+(?:\.\d+)?)\s*\/\s*\$([\d,]+(?:\.\d+)?)\s*$/u.exec(text);
  if (money !== null) {
    const used = Number(money[1]!.replaceAll(",", ""));
    const limit = Number(money[2]!.replaceAll(",", ""));
    return limit > 0 ? (used / limit) * 100 : null;
  }
  const percent = /^\s*([\d,]+(?:\.\d+)?)%(?:\s+used)?\s*$/u.exec(text);
  return percent === null ? null : Number(percent[1]!.replaceAll(",", ""));
}

/**
 * Background for a full fill that puts a 2px line at the 100% point, or null
 * when the bar isn't over budget.
 */
export function markerBackground(percentUsed: number): string | null {
  if (!(percentUsed > 100)) return null;
  const at = Math.round((100 / percentUsed) * 100_000) / 1000;
  const color = "var(--background)";
  return (
    `linear-gradient(to right, transparent calc(${at}% - 1px), ` +
    `${color} calc(${at}% - 1px), ${color} calc(${at}% + 1px), ` +
    `transparent calc(${at}% + 1px))`
  );
}

function decorate(fill: HTMLElement | null, text: string | null | undefined): void {
  if (fill === null) return;
  const background = text == null ? null : markerBackground(percentFromText(text) ?? 0);
  if (background === null) {
    if (fill.hasAttribute(MARKED)) {
      fill.style.removeProperty("background-image");
      fill.removeAttribute(MARKED);
    }
    return;
  }
  // Runs from a MutationObserver, so only write on change.
  if (fill.getAttribute(MARKED) === background) return;
  fill.style.backgroundImage = background;
  fill.setAttribute(MARKED, background);
}

export function decorateUsageBars(): void {
  for (const track of document.querySelectorAll<HTMLElement>(SIDEBAR_TRACK)) {
    decorate(
      track.firstElementChild as HTMLElement | null,
      track.nextElementSibling?.textContent,
    );
  }
  for (const track of document.querySelectorAll<HTMLElement>(PANEL_TRACK)) {
    decorate(
      track.firstElementChild as HTMLElement | null,
      track.previousElementSibling?.lastElementChild?.textContent,
    );
  }
}

export function clearUsageBarMarkers(): void {
  for (const fill of document.querySelectorAll<HTMLElement>(`[${MARKED}]`)) {
    fill.style.removeProperty("background-image");
    fill.removeAttribute(MARKED);
  }
}
