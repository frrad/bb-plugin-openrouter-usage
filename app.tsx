// Shows what a Pi thread has cost: a muted figure in the thread header that
// opens a per-model breakdown, and a row in the thread's Info tab. The figures come from the server, so every
// client shows the same total.
import { useCallback, useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
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

/** Hover delay before the card closes, so the pointer can move onto it. */
const CLOSE_DELAY_MS = 150;

function HeaderCost({ threadId }: PluginThreadHeaderActionProps) {
  const cost = useThreadCost(threadId);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);
  if (!cost) return null;

  // Like bb's context meter: a mouse opens it on hover, touch on tap.
  const hover = (next: boolean) => (event: { pointerType: string }) => {
    if (event.pointerType !== "mouse") return;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (next) setOpen(true);
    else closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Thread cost ${formatUsd(cost.costUsd, true)}`}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        className="flex h-7 items-center rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {formatUsd(cost.costUsd)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-72 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Thread cost</span>
            <span className="font-medium tabular-nums">{formatUsd(cost.costUsd, true)}</span>
          </div>
          <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
            {cost.models.map((model) => (
              <li key={model.model} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{model.model}</span>
                <span className="shrink-0 text-muted-foreground">
                  {plural(model.generations, "reply")}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {formatUsd(model.costUsd, true)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
            <span>{plural(cost.generations, "reply")}</span>
            <span className="text-right">{exactness(cost)}</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
