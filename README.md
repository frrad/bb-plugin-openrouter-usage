# bb-plugin-openrouter-usage

A [bb](https://getbb.app) plugin that shows OpenRouter spend in bb's Provider
usage panel, next to Claude Code and Codex on every host. Each host shows the
same server-collected key usage and account balance.

- **Today / Week / Month** bars: spend for the OpenRouter key
  Pi (`@earendil-works/pi-coding-agent`) uses, against a monthly budget
  prorated per day. Over budget, a bar turns red and passes 100%.
- **Badge**: remaining account credit, e.g. `$10.41 left`.

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
npm test           # node --test usage.test.ts
npm run typecheck
bb plugin build . && bb plugin reload openrouter-usage
```
