---
name: openrouter-usage
description: Explain or configure the OpenRouter Usage plugin, which shows Pi's OpenRouter spend and the account credit balance in BB's Provider usage tab.
---

# OpenRouter Usage

The plugin adds an **OpenRouter** source to Provider usage on every host,
with the same server-collected figures under each host. It has these bars:

- **Today**, **This week**, **This month**: spend for the OpenRouter key Pi
  uses, against the monthly budget. Today's budget is the monthly budget
  divided by the days in the month; the week's is seven of those days.
  OpenRouter resets these in UTC, and the week starts on Monday.
The badge beside the account shows the remaining credit balance, e.g.
`$10.41 left`. The balance is account-wide, so it includes spend from every
key.

Over budget, a bar fills, turns red, and shows more than 100%. The badge then
starts with how far this month is over, e.g. `$4.20 over budget · $10.41 left`.

Usage refreshes about every two minutes while it is visible, and when the
window regains focus; the plugin caches OpenRouter's answer for a minute. A
failed refresh shows "Couldn't refresh. Showing last update."

## Key

The plugin reads `openrouter.key` from Pi's `auth.json`
(`$PI_CODING_AGENT_DIR` or `~/.pi/agent`), else `OPENROUTER_API_KEY`. It never
stores the key.

## Settings

- `monthlyBudgetUsd`: `bb plugin config openrouter-usage set monthlyBudgetUsd 50`.
  `0` shows only the credit balance.
- `accountLabel`: text shown as the account line, e.g. the OpenRouter email.
  OpenRouter's API does not report the email, so it is set by hand. Empty
  shows no account line.
