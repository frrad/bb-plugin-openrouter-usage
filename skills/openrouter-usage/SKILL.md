---
name: openrouter-usage
description: Explain or configure the OpenRouter Usage plugin, which shows Pi's OpenRouter spend and the account credit balance in BB's Provider usage tab, and what each Pi thread has cost.
---

# OpenRouter Usage

The plugin adds an **OpenRouter** source to Provider usage on every host,
with the same server-collected figures under each host. It has these bars:

- **Today**, **This week**, **This month**: spend for the OpenRouter key Pi
  uses, including BYOK inference billed by your own provider keys, against the monthly budget. Today's budget is the monthly budget
  divided by the days in the month; the week's is seven of those days.
  OpenRouter resets these in UTC, and the week starts on Monday.
The badge beside the account shows the remaining credit balance, e.g.
`$10.41 left`. The balance is account-wide, so it includes spend from every
key.

Over budget, a bar fills, turns red, and shows more than 100%. A small notch
on the bar marks where 100% falls; the part after it is the overage. A content
script draws it, so a bb update that changes the bars can hide the notch. The badge then
starts with how far this month is over, e.g. `$4.20 over budget · $10.41 left`.

Usage refreshes about every two minutes while it is visible, and when the
window regains focus; the plugin caches OpenRouter's answer for a minute. A
failed refresh shows "Couldn't refresh. Showing last update."

## Thread cost

A Pi thread shows its cost in the thread header, e.g. `$0.80`. Hovering
lists cost per model. The context card (hover or tap the ring by the
composer) adds Thread cost, then below a hairline: tokens in / out (input
counts cached tokens), reasoning tokens (the thinking part of output),
cache hits (share of input served from the provider's cache), replies with
the average cost per reply, and the provider(s) OpenRouter routed to, e.g.
Moonshot AI. Hovering a row explains it. A content script adds it, since bb has no
slot there; if a bb update changes the card, those rows can disappear while
the header and Info tab keep working. The thread's Info tab has a Cost row with the precise
total and how much of it is OpenRouter's billed figure rather than Pi's own
estimate. The plugin replaces each estimate with what OpenRouter billed,
usually within a minute of the reply.

The plugin reads Pi's session files on the machine that ran the thread and
keeps the figures on the bb server. A thread is read while it runs and once
when it is first shown after the plugin starts; old threads are not scanned.
Totals stay after the session file is gone or that machine is offline.
Threads whose session files were deleted before they were opened show no
cost.

The total is also stored in the thread's plugin metadata under `cost`
(`costUsd`, `estimatedUsd`, `generations`, `exactGenerations`,
`pendingGenerations`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`reasoningTokens`, `providers`, `models`). Read it with
`bb plugin rpc call openrouter-usage threadCost.get --input-file <file>`,
where the file holds `{"threadId": "thr_…"}`.

## Key

The plugin reads `openrouter.key` from Pi's `auth.json`
(`$PI_CODING_AGENT_DIR` or `~/.pi/agent`), else `OPENROUTER_API_KEY`, on the bb server. It never
stores the key. Exact thread costs need that key to belong to the account
that served the replies.

## Settings

- `monthlyBudgetUsd`: `bb plugin config openrouter-usage set monthlyBudgetUsd 50`.
  `0` shows only the credit balance.
- `accountLabel`: text shown as the account line, e.g. the OpenRouter email.
  OpenRouter's API does not report the email, so it is set by hand. Empty
  shows no account line.

## Bring your own key (BYOK)

Thread costs include the upstream provider's inference cost plus any
OpenRouter charge for BYOK calls. For ordinary OpenRouter calls, its total
already includes inference. Provider usage bars add the key's BYOK usage
(`byok_usage_*` from `/api/v1/key`) to its OpenRouter usage, so they show total
spend. The credit balance stays OpenRouter-only, since BYOK inference is billed
by the upstream provider. Updating the plugin refreshes previously confirmed
thread costs to include BYOK inference; stored totals remain visible while
those lookups run. If upstream cost is missing, the plugin retries instead of
confirming a zero cost.
