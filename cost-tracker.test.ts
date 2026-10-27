import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerCostTracker } from "./cost-tracker.ts";
import type { CostSummary } from "./thread-costs.ts";

type CostResult = { cost: CostSummary | null };

const generation = (id: string, provider: string, estimatedUsd: number) => ({
  id,
  provider,
  model: "moonshotai/kimi-k3.1-pro",
  timestamp: 1,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedUsd,
});

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), "condition never held");
}

test("viewing a Pi thread reads its replies from its host and prices them", async (t) => {
  const thread = { id: "thr_pi", providerId: "pi", environmentId: "env_mac" };
  const metadataWrites: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "openrouter-usage",
    sdk: {
      threads: {
        get: async () => thread,
        events: {
          list: async () => [
            { data: { providerThreadId: "pi_a" } },
            { data: { providerThreadId: "pi_a" } },
          ],
        },
        updatePluginMetadata: async (args: unknown) => {
          metadataWrites.push(args);
          return {};
        },
      },
      environments: { get: async () => ({ id: "env_mac", hostId: "host_mac" }) },
    } as never,
    experimental_callHostRpc: () => ({
      sessions: [
        {
          sessionId: "pi_a",
          found: true,
          generations: [
            generation("gen-1", "openrouter", 0.01),
            generation("pi_a#x", "anthropic", 0.5),
          ],
        },
      ],
    }),
  });

  const looked: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    looked.push(url);
    return Response.json({ data: { total_cost: 0.02 } });
  });

  registerCostTracker(bb, async () => "sk-test", {
    syncDelayMs: 0,
    firstLookupDelayMs: 0,
    workerIntervalMs: 5,
  });
  const service = harness.behavior.runService("thread-costs");
  try {
    // Nothing is read until the app asks about the thread.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.inspection.experimental_hostRpcCalls.length, 0);
    const first = (await harness.behavior.callRpc("threadCost.get", {
      threadId: "thr_pi",
    })) as CostResult;
    assert.equal(first.cost, null);

    await until(() =>
      metadataWrites.some(
        (write) =>
          (write as { set: { cost: { exactGenerations: number } } }).set.cost
            .exactGenerations === 1,
      ),
    );
    assert.deepEqual(harness.inspection.experimental_hostRpcCalls.map((call) => ({
      method: call.method,
      input: call.input,
      hostId: call.hostId,
    })), [{ method: "readPiSessions", input: { sessionIds: ["pi_a"] }, hostId: "host_mac" }]);
    assert.deepEqual(looked, ["https://openrouter.ai/api/v1/generation?id=gen-1"]);

    const { cost } = (await harness.behavior.callRpc("threadCost.get", {
      threadId: "thr_pi",
    })) as CostResult;
    assert.ok(cost !== null);
    // Exact for the OpenRouter call, Pi's estimate for the other one.
    assert.ok(Math.abs(cost.costUsd - 0.52) < 1e-9);
    assert.equal(cost.generations, 2);
    assert.equal(cost.pendingGenerations, 0);
    assert.ok(
      harness.inspection.realtimeSignals.some(
        (signal) => signal.channel === "thread-cost-changed",
      ),
    );

    const none = (await harness.behavior.callRpc("threadCost.get", {
      threadId: "thr_other",
    })) as CostResult;
    assert.equal(none.cost, null);
  } finally {
    service.controller.abort();
    await service.done;
    await harness.lifecycle.dispose();
  }
});
