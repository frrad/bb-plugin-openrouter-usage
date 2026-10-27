import assert from "node:assert/strict";
import test from "node:test";
import { isOpenRouterGeneration, parsePiSession, retryDelayMs, summarize } from "./thread-costs.ts";

function line(value: unknown): string {
  return JSON.stringify(value);
}

const assistant = (id: string, message: Record<string, unknown>) =>
  line({
    type: "message",
    id,
    message: {
      role: "assistant",
      provider: "openrouter",
      model: "moonshotai/kimi-k3.1-pro",
      timestamp: 1_793_130_503_786,
      usage: {
        input: 5414,
        output: 176,
        cacheRead: 512,
        cacheWrite: 0,
        cost: { total: 0.0126904 },
      },
      ...message,
    },
  });

test("parsePiSession keeps billed assistant replies", () => {
  const text = [
    line({ type: "session", id: "s" }),
    line({ type: "model_change", id: "m", provider: "openrouter" }),
    line({ type: "message", id: "u1", message: { role: "user", content: "hi" } }),
    assistant("a1", { responseId: "gen-1" }),
    assistant("a2", { responseId: "", provider: "anthropic", model: "claude" }),
    line({ type: "message", id: "a3", message: { role: "assistant" } }),
    assistant("a5", {
      responseId: undefined,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
    }),
    assistant("a6", {
      responseId: "gen-aborted",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
    }),
    '{"type":"message","id":"a4","mess', // Pi mid-write
    "",
  ].join("\n");

  assert.deepEqual(parsePiSession("pi_x", text), [
    {
      id: "gen-1",
      provider: "openrouter",
      model: "moonshotai/kimi-k3.1-pro",
      timestamp: 1_793_130_503_786,
      inputTokens: 5414,
      outputTokens: 176,
      cacheReadTokens: 512,
      cacheWriteTokens: 0,
      estimatedUsd: 0.0126904,
    },
    {
      id: "pi_x#a2",
      provider: "anthropic",
      model: "claude",
      timestamp: 1_793_130_503_786,
      inputTokens: 5414,
      outputTokens: 176,
      cacheReadTokens: 512,
      cacheWriteTokens: 0,
      estimatedUsd: 0.0126904,
    },
    {
      id: "gen-aborted",
      provider: "openrouter",
      model: "moonshotai/kimi-k3.1-pro",
      timestamp: 1_793_130_503_786,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedUsd: 0,
    },
  ]);
});

test("only OpenRouter generations get an exact lookup", () => {
  assert.equal(isOpenRouterGeneration({ id: "gen-1", provider: "openrouter" }), true);
  assert.equal(isOpenRouterGeneration({ id: "pi_x#a2", provider: "openrouter" }), false);
  assert.equal(isOpenRouterGeneration({ id: "gen-1", provider: "anthropic" }), false);
});

test("summarize prefers exact costs and groups by model", () => {
  const summary = summarize([
    { model: "a", estimatedUsd: 0.1, exactUsd: 0.12, exactStatus: "done" },
    { model: "a", estimatedUsd: 0.2, exactUsd: null, exactStatus: "pending" },
    { model: "b", estimatedUsd: 0.5, exactUsd: null, exactStatus: "unavailable" },
  ]);
  assert.ok(Math.abs(summary.costUsd - 0.82) < 1e-9);
  assert.ok(Math.abs(summary.estimatedUsd - 0.8) < 1e-9);
  assert.equal(summary.generations, 3);
  assert.equal(summary.exactGenerations, 1);
  assert.equal(summary.pendingGenerations, 1);
  assert.deepEqual(
    summary.models.map((model) => [model.model, model.generations]),
    [
      ["b", 1],
      ["a", 2],
    ],
  );
});

test("retryDelayMs backs off, then gives up", () => {
  assert.equal(retryDelayMs(1), 15_000);
  assert.ok(retryDelayMs(6)! > retryDelayMs(5)!);
  assert.equal(retryDelayMs(7), null);
});
