// Pure pieces of per-thread cost tracking, shared by the host entry (which
// parses Pi's session files) and the server (which stores and sums them).
// Kept free of I/O so they can be tested directly.

/** One billed model call, as Pi recorded it. Amounts are USD. */
export type Generation = {
  /** OpenRouter's `gen-…` id, or `<sessionId>#<entryId>` when Pi has none. */
  id: string;
  provider: string;
  model: string;
  /** Epoch milliseconds. */
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Output tokens spent thinking; part of outputTokens. */
  reasoningTokens: number;
  /** Pi's estimate from its own price table. */
  estimatedUsd: number;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Every billed assistant reply in a Pi session file (JSONL). Replies on
 * abandoned branches count too: they were billed. Unparseable lines are
 * skipped, since Pi may be mid-write on the last one.
 */
export function parsePiSession(sessionId: string, text: string): Generation[] {
  const generations: Generation[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Record<string, unknown> | null;
    try {
      entry = record(JSON.parse(line));
    } catch {
      continue;
    }
    if (entry === null || entry.type !== "message") continue;
    const message = record(entry.message);
    if (message === null || message.role !== "assistant") continue;
    const usage = record(message.usage);
    if (usage === null) continue;
    const cost = num(record(usage.cost)?.total);
    const responseId =
      typeof message.responseId === "string" && message.responseId !== ""
        ? message.responseId
        : null;
    // A request that failed before the provider answered reports no usage and
    // was not billed. One with a response id may still have been (an aborted
    // stream), so OpenRouter gets to say.
    if (responseId === null && cost === 0 && num(usage.input) === 0 && num(usage.output) === 0) {
      continue;
    }
    const entryId = typeof entry.id === "string" ? entry.id : String(generations.length);
    generations.push({
      id: responseId ?? `${sessionId}#${entryId}`,
      provider: typeof message.provider === "string" ? message.provider : "unknown",
      model: typeof message.model === "string" ? message.model : "unknown",
      timestamp: num(message.timestamp),
      inputTokens: num(usage.input),
      outputTokens: num(usage.output),
      cacheReadTokens: num(usage.cacheRead),
      cacheWriteTokens: num(usage.cacheWrite),
      reasoningTokens: num(usage.reasoning),
      estimatedUsd: cost,
    });
  }
  return generations;
}

/** Whether OpenRouter can report the exact cost of this generation. */
export function isOpenRouterGeneration(generation: Pick<Generation, "id" | "provider">): boolean {
  return generation.provider === "openrouter" && generation.id.startsWith("gen-");
}

/** A stored generation: Pi's numbers plus what OpenRouter reported, once known. */
export type StoredGeneration = Pick<
  Generation,
  | "model"
  | "estimatedUsd"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
> & {
  /** null until OpenRouter reports it, or when it never will. */
  exactUsd: number | null;
  exactStatus: ExactStatus;
  /** The upstream provider OpenRouter routed to, e.g. "Moonshot AI". */
  providerName: string | null;
};

/**
 * `pending`: waiting for OpenRouter. `done`: exactUsd is set. `unavailable`:
 * OpenRouter never reported it. `not-applicable`: not an OpenRouter call.
 */
export type ExactStatus = "pending" | "done" | "unavailable" | "not-applicable";

export type CostSummary = {
  /** Exact cost where known, else Pi's estimate. */
  costUsd: number;
  /** Pi's estimate for every generation. */
  estimatedUsd: number;
  generations: number;
  /** Generations whose cost is OpenRouter's billed figure. */
  exactGenerations: number;
  /** Generations still waiting on OpenRouter for their cost. */
  pendingGenerations: number;
  /** All prompt tokens, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the provider's cache. */
  cacheReadTokens: number;
  /** Output tokens spent thinking; part of outputTokens. */
  reasoningTokens: number;
  /** Upstream providers OpenRouter routed to, most replies first. */
  providers: { name: string; generations: number }[];
  /** Cost per model, highest first. */
  models: { model: string; costUsd: number; generations: number }[];
};

export function summarize(rows: readonly StoredGeneration[]): CostSummary {
  let costUsd = 0;
  let estimatedUsd = 0;
  let exactGenerations = 0;
  let pendingGenerations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let reasoningTokens = 0;
  const byProvider = new Map<string, number>();
  const byModel = new Map<string, { costUsd: number; generations: number }>();
  for (const row of rows) {
    const cost = row.exactUsd ?? row.estimatedUsd;
    costUsd += cost;
    estimatedUsd += row.estimatedUsd;
    if (row.exactUsd !== null) exactGenerations += 1;
    if (row.exactStatus === "pending" && row.exactUsd === null) pendingGenerations += 1;
    inputTokens += row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens;
    outputTokens += row.outputTokens;
    cacheReadTokens += row.cacheReadTokens;
    reasoningTokens += row.reasoningTokens;
    if (row.providerName !== null) {
      byProvider.set(row.providerName, (byProvider.get(row.providerName) ?? 0) + 1);
    }
    const model = byModel.get(row.model) ?? { costUsd: 0, generations: 0 };
    model.costUsd += cost;
    model.generations += 1;
    byModel.set(row.model, model);
  }
  return {
    costUsd,
    estimatedUsd,
    generations: rows.length,
    exactGenerations,
    pendingGenerations,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    reasoningTokens,
    providers: [...byProvider.entries()]
      .map(([name, generations]) => ({ name, generations }))
      .sort((a, b) => b.generations - a.generations),
    models: [...byModel.entries()]
      .map(([model, totals]) => ({ model, ...totals }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

/**
 * When to ask OpenRouter again after it had no answer. Generation stats can
 * lag a few seconds behind the reply, so retries start fast and back off.
 * Returns null once the generation should be marked unavailable.
 */
export function retryDelayMs(attempts: number): number | null {
  const delays = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 3 * 3_600_000, 12 * 3_600_000];
  return attempts <= delays.length ? delays[attempts - 1]! : null;
}
