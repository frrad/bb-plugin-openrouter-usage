# bb-plugin-openrouter-usage

A [bb](https://getbb.app) plugin that shows OpenRouter spend in bb's Provider
usage panel, next to Claude Code and Codex on every host, and what each Pi
thread has cost. Each host shows the same server-collected key usage and
account balance.

- **Today / Week / Month** bars: spend for the OpenRouter key
  Pi (`@earendil-works/pi-coding-agent`) uses, against a monthly budget
  prorated per day. Over budget, a bar turns red and passes 100%.
- **Badge**: remaining account credit, e.g. `$10.41 left`.

- **Thread cost**: a muted figure in a Pi thread's header, e.g. `$0.80`
  (hover for cost per model), and a Cost row in the thread's Info tab.

## Thread costs

Pi writes each reply's token usage and an estimated cost to its session file,
`~/.bb/pi-bridge-sessions/<session>.jsonl` (or `$BB_PI_BRIDGE_SESSION_DIR`), on
the machine that ran the thread. The plugin's host entry (`host.ts`) reads
those files and returns only per-reply cost records. The server
(`cost-tracker.ts`):

1. Re-reads a Pi thread's sessions a few seconds after its activity settles,
   and once when the app first shows a thread. Nothing walks every thread,
   so old threads cost nothing until opened.
2. Stores each reply in the plugin database, keyed by OpenRouter's `gen-…` id,
   so totals outlive the session file and an offline host.
3. Asks OpenRouter's `/api/v1/generation` for each reply's billed cost,
   retrying with backoff while the stats are not ready yet.
4. Writes the thread total to the thread's plugin metadata (`cost`) and tells
   open clients to refresh.

Replies on abandoned branches count, since they were billed. A request that
failed before the provider answered is skipped; one with an OpenRouter id is
kept, because aborted streams can still be billed. Threads whose session files
were deleted before they were opened show no cost.

The key is read from Pi's `auth.json` (`$PI_CODING_AGENT_DIR` or
`~/.pi/agent`), falling back to `OPENROUTER_API_KEY`. The plugin never stores
it.

## Install

```sh
git clone git@github.com:frrad/bb-plugin-openrouter-usage.git
cd bb-plugin-openrouter-usage
npm install
bb plugin install .
bb plugin config openrouter-usage set monthlyBudgetUsd 100
bb plugin config openrouter-usage set accountLabel you@example.com  # optional
```

## Develop

```sh
npm test           # node --test *.test.ts
npm run typecheck
bb plugin build . && bb plugin reload openrouter-usage
```
