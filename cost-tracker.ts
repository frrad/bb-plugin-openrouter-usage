// Per-thread cost tracking for Pi threads.
//
// Pi records a cost estimate for every reply in its session file, on the host
// that ran the thread. While a Pi thread is active, or when the app first
// shows a thread, the server asks that host (through this plugin's host
// entry) for the replies, stores them in the plugin database, then asks
// OpenRouter for each reply's billed cost. The per-thread total is kept in the
// thread's plugin metadata and served to the app over RPC, so it shows on
// every client and outlives the session file.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.ts";
import {
  isOpenRouterGeneration,
  retryDelayMs,
  summarize,
  type CostSummary,
  type ExactStatus,
  type Generation,
} from "./thread-costs.ts";

/** Realtime channel; payload `{ threadId }`. */
export const COST_CHANGED = "thread-cost-changed";

const PI_PROVIDER_ID = "pi";
const LOOKUP_BATCH = 50;

export type CostTrackerTiming = {
  /** Wait for a burst of thread events to settle before reading the session. */
  syncDelayMs: number;
  /** OpenRouter's generation stats lag the reply by a few seconds. */
  firstLookupDelayMs: number;
  /** How often to look for exact costs that are due. */
  workerIntervalMs: number;
};

const DEFAULT_TIMING: CostTrackerTiming = {
  syncDelayMs: 3_000,
  firstLookupDelayMs: 5_000,
  workerIntervalMs: 10_000,
};

export const costSummarySchema = z.object({
  costUsd: z.number(),
  estimatedUsd: z.number(),
  generations: z.number().int(),
  exactGenerations: z.number().int(),
  pendingGenerations: z.number().int(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  reasoningTokens: z.number(),
  providers: z.array(z.object({ name: z.string(), generations: z.number().int() })),
  models: z.array(
    z.object({ model: z.string(), costUsd: z.number(), generations: z.number().int() }),
  ),
});

export const threadCostContract = defineRpcContract({
  "threadCost.get": {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ cost: costSummarySchema.nullable() }),
  },
});

const generationResponseSchema = z.object({
  data: z.object({ total_cost: z.number(), provider_name: z.string().nullish() }),
});

type Lookup =
  | { kind: "found"; totalCostUsd: number; providerName: string | null }
  | { kind: "missing" };

class LookupUnauthorizedError extends Error {}

async function lookupGeneration(id: string, apiKey: string): Promise<Lookup> {
  const response = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) },
  );
  if (response.status === 404) return { kind: "missing" };
  if (response.status === 401 || response.status === 403) {
    throw new LookupUnauthorizedError(`OpenRouter rejected the key (${response.status}).`);
  }
  if (!response.ok) throw new Error(`OpenRouter /generation returned HTTP ${response.status}.`);
  const { data } = generationResponseSchema.parse(await response.json());
  return {
    kind: "found",
    totalCostUsd: data.total_cost,
    providerName: data.provider_name ?? null,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

type GenerationRow = {
  model: string;
  estimated_usd: number;
  exact_usd: number | null;
  exact_status: ExactStatus;
  provider_name: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
};

export function registerCostTracker(
  bb: BbPluginApi,
  readApiKey: () => Promise<string | null>,
  timing: CostTrackerTiming = DEFAULT_TIMING,
): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE generations (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      estimated_usd REAL NOT NULL,
      exact_usd REAL,
      exact_status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX generations_thread ON generations (thread_id)`,
    `CREATE INDEX generations_pending ON generations (exact_status, next_attempt_at)`,
    // Cleared zero-usage rows from a pre-release build. It removed too much
    // (aborted streams OpenRouter still billed), so a resync restores those.
    // A no-op on a fresh install.
    `DELETE FROM generations WHERE estimated_usd = 0 AND input_tokens = 0 AND output_tokens = 0`,
    `ALTER TABLE generations ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE generations ADD COLUMN provider_name TEXT`,
    // Look up replies priced before provider names were kept. Their cost
    // stays; only the provider fills in. A no-op on a fresh install.
    `UPDATE generations SET exact_status = 'pending', next_attempt_at = 0, attempts = 0
     WHERE exact_status = 'done'`,
  ]);

  // A reply copied into a forked thread's session keeps its original thread:
  // the cost belongs to the thread that incurred it.
  const insertGeneration = db.prepare(
    `INSERT INTO generations (id, thread_id, session_id, provider, model, created_at,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       reasoning_tokens, estimated_usd, exact_status, next_attempt_at)
     VALUES (@id, @threadId, @sessionId, @provider, @model, @timestamp,
       @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens,
       @reasoningTokens, @estimatedUsd, @exactStatus, @nextAttemptAt)
     -- Re-reads fill in fields added since the row was stored.
     ON CONFLICT (id) DO UPDATE SET reasoning_tokens = excluded.reasoning_tokens`,
  );
  const insertAll = db.transaction(
    (threadId: string, sessionId: string, generations: readonly Generation[]) => {
      let added = 0;
      for (const generation of generations) {
        const exactStatus: ExactStatus = isOpenRouterGeneration(generation)
          ? "pending"
          : "not-applicable";
        added += insertGeneration.run({
          ...generation,
          threadId,
          sessionId,
          exactStatus,
          nextAttemptAt: Date.now() + timing.firstLookupDelayMs,
        }).changes;
      }
      return added;
    },
  );
  const selectThreadRows = db.prepare(
    `SELECT model, estimated_usd, exact_usd, exact_status, provider_name, input_tokens,
       output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
     FROM generations WHERE thread_id = ?`,
  );
  const selectDue = db.prepare(
    `SELECT id, thread_id, attempts FROM generations
     WHERE exact_status = 'pending' AND next_attempt_at <= ?
     ORDER BY next_attempt_at LIMIT ${LOOKUP_BATCH}`,
  );
  const markFound = db.prepare(
    `UPDATE generations SET exact_usd = ?, provider_name = ?, exact_status = 'done',
       attempts = attempts + 1 WHERE id = ?`,
  );
  const markRetry = db.prepare(
    `UPDATE generations SET attempts = ?, next_attempt_at = ? WHERE id = ?`,
  );
  const markUnavailable = db.prepare(
    `UPDATE generations SET attempts = ?, exact_status = 'unavailable' WHERE id = ?`,
  );

  const host = bb.hosts.experimental_client({ contract: hostContract });

  function threadSummary(threadId: string): CostSummary | null {
    const rows = selectThreadRows.all(threadId) as GenerationRow[];
    if (rows.length === 0) return null;
    return summarize(
      rows.map((row) => ({
        model: row.model,
        estimatedUsd: row.estimated_usd,
        exactUsd: row.exact_usd,
        exactStatus: row.exact_status,
        providerName: row.provider_name,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheWriteTokens: row.cache_write_tokens,
        reasoningTokens: row.reasoning_tokens,
      })),
    );
  }

  /** Last summary written per thread, so unchanged totals are not rewritten. */
  const published = new Map<string, string>();

  async function publish(threadId: string): Promise<void> {
    const summary = threadSummary(threadId);
    if (summary === null) {
      // Clear a total left over from replies that no longer count.
      const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
      if ("cost" in metadata) {
        await bb.sdk.threads.updatePluginMetadata({ threadId, remove: ["cost"] });
        bb.realtime.publish(COST_CHANGED, { threadId });
      }
      return;
    }
    const serialized = JSON.stringify(summary);
    if (published.get(threadId) === serialized) return;
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      set: { cost: { ...summary, updatedAt: Date.now() } },
    });
    published.set(threadId, serialized);
    bb.realtime.publish(COST_CHANGED, { threadId });
  }

  /** Pull a Pi thread's replies from the host that ran it. */
  async function syncThread(threadId: string): Promise<void> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== PI_PROVIDER_ID || thread.environmentId === null) return;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    const identities = await bb.sdk.threads.events.list({
      threadId,
      types: ["thread/identity"],
    });
    const sessionIds = [
      ...new Set(
        identities.flatMap((event) => {
          const id = (event.data as { providerThreadId?: unknown } | null)?.providerThreadId;
          return typeof id === "string" && id !== "" ? [id] : [];
        }),
      ),
    ];
    if (sessionIds.length === 0) return;
    const { sessions } = await host.call(
      "readPiSessions",
      { sessionIds },
      { hostId: environment.hostId },
    );
    for (const session of sessions) {
      insertAll(threadId, session.sessionId, session.generations);
    }
    await publish(threadId);
  }

  // Syncs run one at a time; each thread syncs at most once per syncDelayMs.
  const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  function enqueueSync(threadId: string): Promise<void> {
    queue = queue.then(() =>
      disposed
        ? undefined
        : syncThread(threadId).catch((error: unknown) => {
            bb.log.warn(`cost sync for ${threadId} failed: ${String(error)}`);
          }),
    );
    return queue;
  }

  function scheduleSync(threadId: string): void {
    if (disposed || scheduled.has(threadId)) return;
    scheduled.set(
      threadId,
      setTimeout(() => {
        scheduled.delete(threadId);
        void enqueueSync(threadId);
      }, timing.syncDelayMs),
    );
  }

  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (thread.providerId === PI_PROVIDER_ID) scheduleSync(thread.id);
  });

  bb.onDispose(() => {
    disposed = true;
    for (const timer of scheduled.values()) clearTimeout(timer);
    scheduled.clear();
  });

  // Threads the app has asked about since the plugin started. Viewing a
  // thread reads its sessions once, which catches up threads that ran while
  // the plugin was off. Nothing walks every thread, so old threads cost
  // nothing until opened.
  const viewed = new Set<string>();

  /** Ask OpenRouter for billed costs that are due. Returns whether more are due. */
  async function resolveExactCosts(): Promise<boolean> {
    const due = selectDue.all(Date.now()) as {
      id: string;
      thread_id: string;
      attempts: number;
    }[];
    if (due.length === 0) return false;
    const apiKey = await readApiKey();
    if (apiKey === null) return false;
    const touched = new Set<string>();
    for (const row of due) {
      const attempts = row.attempts + 1;
      try {
        const lookup = await lookupGeneration(row.id, apiKey);
        if (lookup.kind === "found") {
          markFound.run(lookup.totalCostUsd, lookup.providerName, row.id);
          touched.add(row.thread_id);
          continue;
        }
      } catch (error) {
        if (error instanceof LookupUnauthorizedError) {
          bb.log.warn(`exact cost lookup stopped: ${error.message}`);
          return false;
        }
        bb.log.debug(`exact cost lookup for ${row.id} failed: ${String(error)}`);
      }
      const delay = retryDelayMs(attempts);
      if (delay === null) {
        markUnavailable.run(attempts, row.id);
        touched.add(row.thread_id);
      } else {
        markRetry.run(attempts, Date.now() + delay, row.id);
      }
    }
    for (const threadId of touched) {
      await publish(threadId).catch((error: unknown) => {
        bb.log.warn(`cost update for ${threadId} failed: ${String(error)}`);
      });
    }
    return due.length === LOOKUP_BATCH;
  }

  bb.background.service("thread-costs", {
    async start(signal) {
      while (!signal.aborted) {
        const more = await resolveExactCosts().catch((error: unknown) => {
          bb.log.warn(`exact cost lookups failed: ${String(error)}`);
          return false;
        });
        if (!more) await sleep(timing.workerIntervalMs, signal);
      }
    },
  });

  bb.rpc.register(threadCostContract, {
    "threadCost.get": ({ threadId }) => {
      if (!viewed.has(threadId)) {
        viewed.add(threadId);
        void enqueueSync(threadId);
      }
      return { cost: threadSummary(threadId) };
    },
  });
}
