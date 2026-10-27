// The host RPC contract shared by server.ts and host.ts. The host entry runs
// on whichever machine ran a Pi thread and reads Pi's session files there.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const generationSchema = z.object({
  id: z.string().min(1),
  provider: z.string(),
  model: z.string(),
  timestamp: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedUsd: z.number(),
});

export const hostContract = defineRpcContract({
  readPiSessions: {
    input: z
      .object({ sessionIds: z.array(z.string().min(1)).min(1).max(100) })
      .strict(),
    output: z.object({
      sessions: z.array(
        z.object({
          sessionId: z.string(),
          /** False when the session file is not on this host (or was removed). */
          found: z.boolean(),
          generations: z.array(generationSchema),
        }),
      ),
    }),
    experimental_retryable: true,
  },
});
