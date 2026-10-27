// Shows what a Pi thread has cost: a muted figure in the thread header, a
// row in bb's context card (the ring by the composer), and a row in the
// thread's Info tab. The figures come from the server, so every client shows
// the same total.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_DetailRow as DetailRow,
  experimental_THREAD_INFO_ROW_GROUPS as INFO_ROW_GROUPS,
  useRealtime,
  useRpc,
  type ExperimentalThreadInfoProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { CostSummary } from "./thread-costs.ts";
import type { threadCostContract } from "./cost-tracker.ts";

/** Mirrors COST_CHANGED in cost-tracker.ts (a value import would bundle the server). */
const COST_CHANGED = "thread-cost-changed";

// Last answer per thread, so the header and the Info row don't each start
// empty, and so the context-card script can read it.
const lastKnown = new Map<string, CostSummary | null>();
const costListeners = new Set<() => void>();
/** Threads whose header is on screen; the context card belongs to one. */
const visibleThreads = new Set<string>();

function rememberCost(threadId: string, cost: CostSummary | null): void {
  lastKnown.set(threadId, cost);
  for (const listener of costListeners) listener();
}

/** The thread's cost, or null when there is none, or undefined while loading. */
function useThreadCost(threadId: string): CostSummary | null | undefined {
  const rpc = useRpc<typeof threadCostContract>();
  const [cost, setCost] = useState(() => lastKnown.get(threadId));
  const refetch = useCallback(() => {
    rpc.call("threadCost.get", { threadId }).then(
      (result) => {
        rememberCost(threadId, result.cost);
        setCost(result.cost);
      },
      () => {
        // Keep the last figure; the next change signal retries.
      },
    );
  }, [rpc, threadId]);
  useEffect(() => {
    setCost(lastKnown.get(threadId));
    refetch();
  }, [threadId, refetch]);
  useRealtime(COST_CHANGED, (payload) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) refetch();
  });
  return cost;
}

function formatUsd(usd: number, precise = false): string {
  if (usd === 0) return "$0";
  if (usd < 0.01 && !precise) return "<$0.01";
  if (precise && usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** How much of the total is OpenRouter's billed figure rather than Pi's estimate. */
function exactness(cost: CostSummary): string {
  if (cost.exactGenerations === cost.generations) return "billed by OpenRouter";
  if (cost.pendingGenerations > 0) {
    return `confirming ${plural(cost.pendingGenerations, "reply")} with OpenRouter`;
  }
  if (cost.exactGenerations === 0) return "Pi's estimate";
  return `${cost.exactGenerations} of ${cost.generations} replies billed, rest estimated`;
}

function HeaderCost({ threadId }: PluginThreadHeaderActionProps) {
  const cost = useThreadCost(threadId);
  useEffect(() => {
    visibleThreads.add(threadId);
    for (const listener of costListeners) listener();
    return () => {
      visibleThreads.delete(threadId);
    };
  }, [threadId]);
  if (!cost) return null;
  const models = cost.models
    .map((model) => `${model.model}: ${formatUsd(model.costUsd, true)}`)
    .join("\n");
  const detail = `Thread cost ${formatUsd(cost.costUsd, true)} over ${plural(cost.generations, "reply")}, ${exactness(cost)}`;
  return (
    <span
      role="img"
      aria-label={detail}
      title={`${detail}\n${models}`}
      className="flex h-7 items-center px-1.5 text-xs tabular-nums text-muted-foreground"
    >
      {formatUsd(cost.costUsd)}
    </span>
  );
}

function CostInfoRow({ threadId }: ExperimentalThreadInfoProps) {
  const cost = useThreadCost(threadId);
  if (!cost) return null;
  return (
    <DetailRow label="Cost" icon="CircleDollarSign">
      <span className="text-xs">
        <span className="tabular-nums text-foreground">{formatUsd(cost.costUsd, true)}</span>
        <span className="text-muted-foreground">
          {" "}· {plural(cost.generations, "reply")} · {exactness(cost)}
        </span>
      </span>
    </DetailRow>
  );
}

// bb's context card has no plugin slot, so this script adds a row to it,
// styled like bb's own "Session cost" row (which bb fills only when the agent
// provider reports a cost, and Pi's doesn't). It finds the card by its
// container class; if a bb update renames that, the row just stops showing.
const CONTEXT_CARD = '[class~="@container/context-window"]';
const ROW_ATTRIBUTE = "data-openrouter-thread-cost";

/** The thread the card belongs to: the one on screen, else the one in the URL. */
function cardThreadId(): string | null {
  if (visibleThreads.size === 1) return [...visibleThreads][0]!;
  const inUrl = `${location.pathname}${location.hash}`.match(/thr_[a-z0-9]+/g) ?? [];
  return inUrl.findLast((id) => visibleThreads.has(id)) ?? null;
}

function decorateContextCards(): void {
  const threadId = cardThreadId();
  const cost = threadId === null ? null : (lastKnown.get(threadId) ?? null);
  for (const card of document.querySelectorAll<HTMLElement>(CONTEXT_CARD)) {
    const body = card.querySelector<HTMLElement>(":scope > .flex.flex-col");
    if (body === null) continue;
    let row = body.querySelector<HTMLElement>(`:scope > [${ROW_ATTRIBUTE}]`);
    const providerReportsCost = [...body.children].some(
      (child) => child !== row && child.textContent?.startsWith("Session cost"),
    );
    if (cost === null || providerReportsCost) {
      row?.remove();
      continue;
    }
    if (row === null) {
      row = document.createElement("div");
      row.setAttribute(ROW_ATTRIBUTE, "");
      row.className =
        "order-3 flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground max-md:pointer-coarse:text-sm";
      row.append(document.createElement("span"), document.createElement("span"));
      body.append(row);
    }
    const [label, value] = row.children as unknown as [HTMLElement, HTMLElement];
    const amount = formatUsd(cost.costUsd, true);
    // Only write on change: this runs from a MutationObserver.
    if (label.textContent !== "Thread cost") label.textContent = "Thread cost";
    if (value.textContent !== amount) value.textContent = amount;
    row.title = `${plural(cost.generations, "reply")}, ${exactness(cost)}`;
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "context-card-cost",
    mount() {
      let frame: number | null = null;
      const schedule = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          decorateContextCards();
        });
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      costListeners.add(schedule);
      schedule();
      return () => {
        observer.disconnect();
        costListeners.delete(schedule);
        if (frame !== null) cancelAnimationFrame(frame);
        for (const row of document.querySelectorAll(`[${ROW_ATTRIBUTE}]`)) row.remove();
      };
    },
  });

  app.slots.experimental_threadHeaderAction({
    id: "thread-cost",
    title: "Thread cost",
    component: HeaderCost,
  });
  app.slots.experimental_threadInfoRow({
    id: "thread-cost",
    group: INFO_ROW_GROUPS.thread,
    order: 40,
    component: CostInfoRow,
  });
});
