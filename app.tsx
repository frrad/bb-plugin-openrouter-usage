// Shows what a Pi thread has cost: a muted figure in the thread header and a
// row in the thread's Info tab. The figures come from the server, so every
// client shows the same total.
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
// empty.
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

function HeaderCost({ threadId }: PluginThreadHeaderActionProps) {
  const cost = useThreadCost(threadId);
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

export default definePluginApp((app) => {
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
