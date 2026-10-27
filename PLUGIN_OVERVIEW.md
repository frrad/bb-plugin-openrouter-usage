Track what Pi spends on OpenRouter: overall in BB's Provider usage tab, and
per thread beside the composer.

## What you get

- Today, This week and This month bars for the OpenRouter key Pi uses,
  measured against one monthly budget you set.
- How much OpenRouter credit is left on your account.
- Over budget, a bar turns red and shows more than 100%, and the summary
  says how far over this month is.
- What each Pi thread has cost, above its composer (click for a per-model
  breakdown) and in its Info tab. The same total shows on every device.

## How it works

The plugin reads Pi's OpenRouter key from `~/.pi/agent/auth.json` and asks
OpenRouter for that key's spend and the account balance about once a minute
while usage is shown. The key is never stored by the plugin.

For thread costs, the plugin reads the cost of each reply from Pi's session
files on the machine that ran the thread, stores it on the bb server, and
replaces Pi's estimate with what OpenRouter actually billed. Only cost and
token counts leave the machine, never conversation text.
