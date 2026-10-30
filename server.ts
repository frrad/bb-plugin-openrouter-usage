// bb-plugin-openrouter-usage — feeds OpenRouter spend into BB's Provider usage
// tab by implementing the provider-usage.v1 source contract.
//
// Spend windows (today, this week, this month) come from GET /api/v1/key and
// count only the key Pi uses. The credit balance comes from GET
// /api/v1/credits and is account-wide.
//
// It also tracks what each Pi thread costs; see cost-tracker.ts.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { registerCostTracker } from "./cost-tracker.ts";
import {
  buildUsage,
  keySpendFromResponse,
  type CreditBalance,
  type KeySpend,
} from "./usage.ts";

const LIST_RESOURCES = "provider-usage.v1.listResources";
const GET_RESOURCE = "provider-usage.v1.getResource";
const RESOURCE_ID = "openrouter";
const CACHE_MS = 60_000;

function resourceIdForHost(hostId: string): string {
  return `${RESOURCE_ID}:${hostId}`;
}

const usageWindowSchema = z.object({
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]),
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z
    .object({
      usedUsdCents: z.number().nonnegative(),
      limitUsdCents: z.number().positive(),
    })
    .nullable(),
});

const accountFields = {
  plan: z.null(),
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};

const usageSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    ...accountFields,
    windows: z.array(usageWindowSchema),
  }),
  z.object({ status: z.literal("unauthenticated"), ...accountFields }),
  z.object({
    status: z.literal("error"),
    ...accountFields,
    message: z.string(),
  }),
]);
type ResourceUsage = z.infer<typeof usageSchema>;

export const usageSourceContract = defineRpcContract({
  [LIST_RESOURCES]: {
    input: z.object({}),
    output: z.object({
      resources: z.array(
        z.object({
          accountKey: z.null(),
          id: z.string().min(1),
          providerId: z.string().min(1),
          label: z.string().min(1),
          scope: z.object({
            kind: z.literal("host"),
            hostId: z.string().min(1),
            hostName: z.string().min(1),
          }),
        }),
      ),
    }),
  },
  [GET_RESOURCE]: {
    input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }),
    output: z.object({
      accountKey: z.null(),
      observedAt: z.number().int().nonnegative().nullable(),
      usage: usageSchema,
    }),
  },
});

const piAuthSchema = z.object({
  openrouter: z.object({ key: z.string().min(1) }).optional(),
});

const keyResponseSchema = z.object({
  data: z.object({
    usage_daily: z.number(),
    usage_weekly: z.number(),
    usage_monthly: z.number(),
    byok_usage_daily: z.number().nullish(),
    byok_usage_weekly: z.number().nullish(),
    byok_usage_monthly: z.number().nullish(),
  }),
});

const creditsResponseSchema = z.object({
  data: z.object({ total_credits: z.number(), total_usage: z.number() }),
});

class UnauthenticatedError extends Error {}

/** The OpenRouter key Pi uses: its auth.json entry, else OPENROUTER_API_KEY. */
async function readPiOpenRouterKey(): Promise<string | null> {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(agentDir, "auth.json"), "utf8"),
    );
    const parsed = piAuthSchema.safeParse(raw);
    if (parsed.success && parsed.data.openrouter !== undefined) {
      return parsed.data.openrouter.key;
    }
  } catch {
    // No readable auth.json; fall back to the environment like Pi does.
  }
  return process.env.OPENROUTER_API_KEY || null;
}

async function getOpenRouter(path: string, apiKey: string): Promise<unknown> {
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new UnauthenticatedError(`OpenRouter rejected the key (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`OpenRouter /${path} returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function fetchKeySpend(apiKey: string): Promise<KeySpend> {
  const { data } = keyResponseSchema.parse(await getOpenRouter("key", apiKey));
  return keySpendFromResponse(data);
}

async function fetchCredits(apiKey: string): Promise<CreditBalance> {
  const { data } = creditsResponseSchema.parse(
    await getOpenRouter("credits", apiKey),
  );
  return { totalCredits: data.total_credits, totalUsage: data.total_usage };
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    monthlyBudgetUsd: {
      type: "number",
      label: "Monthly budget (USD)",
      description:
        "Today and This week are measured against this budget prorated per day. Set 0 to show only the credit balance.",
      experimental_schema: z.number().nonnegative(),
      default: 0,
    },
    accountLabel: {
      type: "string",
      label: "Account label",
      description:
        "Shown under OpenRouter in Provider usage, e.g. your OpenRouter email. OpenRouter's API does not report it.",
      default: "",
    },
  });

  let cached: { observedAt: number; usage: ResourceUsage } | null = null;
  let lastSuccessAt: number | null = null;

  async function collect(): Promise<ResourceUsage> {
    const empty = { plan: null, accountEmail: null, planLabel: null };
    const apiKey = await readPiOpenRouterKey();
    if (apiKey === null) return { status: "unauthenticated", ...empty };
    try {
      const [key, credits] = await Promise.all([
        fetchKeySpend(apiKey),
        // The balance is a nice-to-have; key spend still shows without it.
        fetchCredits(apiKey).catch((error: unknown) => {
          bb.log.warn(`credit balance unavailable: ${String(error)}`);
          return null;
        }),
      ]);
      const { monthlyBudgetUsd, accountLabel } = await settings.get();
      lastSuccessAt = Date.now();
      return {
        status: "ok",
        plan: null,
        ...buildUsage({
          key,
          credits,
          monthlyBudgetUsd,
          accountLabel,
          now: new Date(),
        }),
      };
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return { status: "unauthenticated", ...empty };
      }
      bb.log.warn(`usage collection failed: ${String(error)}`);
      return {
        status: "error",
        ...empty,
        message: "OpenRouter usage could not be loaded. Try refreshing.",
      };
    }
  }

  settings.onChange(() => {
    cached = null;
  });

  registerCostTracker(bb, readPiOpenRouterKey);

  bb.rpc.register(
    usageSourceContract,
    {
      // Show the server-collected usage beside Claude Code and Codex on every
      // host. The figures describe the same OpenRouter key and account.
      [LIST_RESOURCES]: async () => {
        const hosts = await bb.sdk.hosts.list();
        return {
          resources: hosts.map((host) => ({
            accountKey: null,
            id: resourceIdForHost(host.id),
            // Display name falls back to the provider id when no BB provider
            // reports usage for it, so use a readable id.
            providerId: "OpenRouter",
            label: "OpenRouter (Pi key)",
            scope: { kind: "host" as const, hostId: host.id, hostName: host.name },
          })),
        };
      },
      [GET_RESOURCE]: async ({ resourceId, refresh }) => {
        const hosts = await bb.sdk.hosts.list();
        if (!hosts.some((host) => resourceIdForHost(host.id) === resourceId)) {
          throw new Error(`Unknown usage resource ${resourceId}.`);
        }
        if (refresh || cached === null || Date.now() - cached.observedAt > CACHE_MS) {
          cached = { observedAt: Date.now(), usage: await collect() };
        }
        return { accountKey: null, observedAt: lastSuccessAt, usage: cached.usage };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "OpenRouter spend for the key Pi uses, against a monthly budget, plus the account credit balance.",
    },
  );
}

export { threadCostContract } from "./cost-tracker.ts";
