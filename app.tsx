// Shows what a Pi thread has cost: a chip above the composer (click for a
// per-model breakdown) and a row in the thread's Info tab. The figures come
// from the server, so every client shows the same total.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_DetailRow as DetailRow,
  experimental_Icon as Icon,
  experimental_THREAD_INFO_ROW_GROUPS as INFO_ROW_GROUPS,
  useRealtime,
  useRpc,
  type ExperimentalThreadContextSegmentProps,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import type { CostSummary } from "./thread-costs.ts";
import type { threadCostContract } from "./cost-tracker.ts";

/** Mirrors COST_CHANGED in cost-tracker.ts (a value import would bundle the server). */
const COST_CHANGED = "thread-cost-changed";

// Last answer per thread, so the chip, its details and the Info row don't
// each start empty.
const lastKnown = new Map<string, CostSummary | null>();

/** The thread's cost, or null when there is none, or undefined while loading. */
function useThreadCost(threadId: string): CostSummary | null | undefined {
  const rpc = useRpc<typeof threadCostContract>();
  const [cost, setCost] = useState(() => lastKnown.get(threadId));
  const refetch = useCallback(() => {
    rpc.call("threadCost.get", { threadId }).then(
      (result) => {
        lastKnown.set(threadId, result.cost);
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

function isEstimate(cost: CostSummary): boolean {
  return cost.exactGenerations < cost.generations;
}

function CostChip({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const cost = useThreadCost(threadId);
  if (!cost) return null;
  const label = `${isEstimate(cost) ? "≈" : ""}${formatUsd(cost.costUsd)}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      title={`Thread cost: ${formatUsd(cost.costUsd, true)} over ${plural(cost.generations, "reply")} (${exactness(cost)})`}
      className="flex min-h-6 items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Icon name="CircleDollarSign" className="size-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </button>
  );
}

function CostDetails({ threadId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  const cost = useThreadCost(threadId);
  if (!isExpanded || !cost) return null;
  return (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      <ul className="space-y-0.5">
        {cost.models.map((model) => (
          <li key={model.model} className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate text-foreground">{model.model}</span>
            <span className="shrink-0">{plural(model.generations, "reply")}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-foreground">
              {formatUsd(model.costUsd, true)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1">Total {formatUsd(cost.costUsd, true)}, {exactness(cost)}.</p>
    </div>
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

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "thread-cost",
    title: "Thread cost",
    group: "4_cost",
    summary: CostChip,
    details: CostDetails,
    useVisible: ({ threadId }) => Boolean(useThreadCost(threadId)),
  });
  app.slots.experimental_threadInfoRow({
    id: "thread-cost",
    group: INFO_ROW_GROUPS.thread,
    order: 40,
    component: CostInfoRow,
  });
});
