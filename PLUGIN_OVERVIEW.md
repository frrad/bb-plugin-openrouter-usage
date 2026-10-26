Track what Pi spends on OpenRouter from BB's Provider usage tab.

## What you get

- Today, This week and This month bars for the OpenRouter key Pi uses,
  measured against one monthly budget you set.
- How much OpenRouter credit is left on your account.
- Over budget, a bar turns red and shows more than 100%, and the summary
  says how far over this month is.

## How it works

The plugin reads Pi's OpenRouter key from `~/.pi/agent/auth.json` and asks
OpenRouter for that key's spend and the account balance about once a minute
while usage is shown. The key is never stored by the plugin.
