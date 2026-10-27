// Host entry: reads the cost of each Pi reply from Pi's session files on this
// machine, so the server can store it centrally. Returns only the compact
// per-reply records, never conversation content.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { parsePiSession, type Generation } from "./thread-costs.ts";

/** Where bb's Pi bridge keeps sessions; mirrors provider-pi's own lookup. */
function sessionDir(): string {
  const override = process.env.BB_PI_BRIDGE_SESSION_DIR?.trim();
  return override ? resolve(override) : join(homedir(), ".bb", "pi-bridge-sessions");
}

function sessionPath(sessionId: string): string {
  return join(sessionDir(), `${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.jsonl`);
}

async function readSession(sessionId: string): Promise<{
  sessionId: string;
  found: boolean;
  generations: Generation[];
}> {
  let text: string;
  try {
    text = await readFile(sessionPath(sessionId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { sessionId, found: false, generations: [] };
    }
    throw error;
  }
  return { sessionId, found: true, generations: parsePiSession(sessionId, text) };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    readPiSessions: async ({ sessionIds }) => ({
      sessions: await Promise.all(sessionIds.map(readSession)),
    }),
  },
});
