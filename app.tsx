// Shows what a Pi thread has cost: a muted figure in the thread header, cost
// and token details in bb's context card (the ring by the composer), and a
// row in the thread's Info tab. The figures come from the server, so every client shows
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

// bb's context card has no plugin slot, so this script adds rows to it,
// styled like bb's own "Session cost" row (which bb fills only when the agent
// provider reports a cost, and Pi's doesn't). It finds the card by its
// container class; if a bb update renames that, the rows just stop showing.
const CONTEXT_CARD = '[class~="@container/context-window"]';
const ROWS_ATTRIBUTE = "data-openrouter-thread-cost";
const ROW_CLASS =
  "flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground max-md:pointer-coarse:text-sm";

/** The thread the card belongs to: the one on screen, else the one in the URL. */
function cardThreadId(): string | null {
  if (visibleThreads.size === 1) return [...visibleThreads][0]!;
  const inUrl = `${location.pathname}${location.hash}`.match(/thr_[a-z0-9]+/g) ?? [];
  return inUrl.findLast((id) => visibleThreads.has(id)) ?? null;
}

/** 2_412_000 → "2.4M", 29_089 → "29k", 950 → "950". */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(tokens);
}

type CardRow = { label: string; value: string; title?: string };

/** The cost row, then the details below a hairline. */
function cardRows(cost: CostSummary, showCost: boolean): { cost: CardRow[]; details: CardRow[] } {
  const details: CardRow[] = [
    {
      label: "Tokens in / out",
      value: `${formatTokens(cost.inputTokens)} / ${formatTokens(cost.outputTokens)}`,
    },
  ];
  if (cost.reasoningTokens > 0) {
    details.push({
      label: "Reasoning",
      value: `${formatTokens(cost.reasoningTokens)} of output`,
      title: `${Math.round((100 * cost.reasoningTokens) / Math.max(cost.outputTokens, 1))}% of output tokens were thinking`,
    });
  }
  if (cost.inputTokens > 0) {
    details.push({
      label: "Cache hits",
      value: `${Math.round((100 * cost.cacheReadTokens) / cost.inputTokens)}%`,
      title: `${formatTokens(cost.cacheReadTokens)} of ${formatTokens(cost.inputTokens)} input tokens came from the provider's cache`,
    });
  }
  details.push({
    label: "Replies",
    value: `${cost.generations} · avg ${formatUsd(cost.costUsd / cost.generations)}`,
  });
  if (cost.providers.length > 0) {
    details.push({
      label: cost.providers.length === 1 ? "Provider" : "Providers",
      value: cost.providers.map((provider) => provider.name).join(", "),
      title: cost.providers
        .map((provider) => `${provider.name}: ${plural(provider.generations, "reply")}`)
        .join("\n"),
    });
  }
  return {
    cost: showCost
      ? [
          {
            label: "Thread cost",
            value: formatUsd(cost.costUsd, true),
            title: `${plural(cost.generations, "reply")}, ${exactness(cost)}`,
          },
        ]
      : [],
    details,
  };
}

function rowElement(row: CardRow): HTMLElement {
  const element = document.createElement("div");
  element.className = ROW_CLASS;
  const label = document.createElement("span");
  label.textContent = row.label;
  const value = document.createElement("span");
  value.className = "min-w-0 truncate text-right";
  value.textContent = row.value;
  element.append(label, value);
  if (row.title !== undefined) element.title = row.title;
  return element;
}

function decorateContextCards(): void {
  const threadId = cardThreadId();
  const cost = threadId === null ? null : (lastKnown.get(threadId) ?? null);
  for (const card of document.querySelectorAll<HTMLElement>(CONTEXT_CARD)) {
    const body = card.querySelector<HTMLElement>(":scope > .flex.flex-col");
    if (body === null) continue;
    const existing = body.querySelector<HTMLElement>(`:scope > [${ROWS_ATTRIBUTE}]`);
    if (cost === null) {
      existing?.remove();
      continue;
    }
    // bb shows its own "Session cost" if the provider ever reports one.
    const providerReportsCost = [...body.children].some(
      (child) => child !== existing && child.textContent?.startsWith("Session cost"),
    );
    const rows = cardRows(cost, !providerReportsCost);
    // Rebuild only on change: this runs from a MutationObserver.
    const key = JSON.stringify(rows);
    if (existing?.getAttribute(ROWS_ATTRIBUTE) === key) continue;
    const block = document.createElement("div");
    block.setAttribute(ROWS_ATTRIBUTE, key);
    block.className = "order-3 flex flex-col gap-2 max-md:pointer-coarse:gap-3";
    const hairline = document.createElement("div");
    hairline.className = "border-t border-border-hairline";
    block.append(...rows.cost.map(rowElement), hairline, ...rows.details.map(rowElement));
    if (existing === null) body.append(block);
    else existing.replaceWith(block);
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
        for (const block of document.querySelectorAll(`[${ROWS_ATTRIBUTE}]`)) block.remove();
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
