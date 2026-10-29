# agent-skills

Skills for Claude Code (and other agents that read `SKILL.md`), by [@harithilmi](https://github.com/harithilmi).

| Skill | What it does |
|---|---|
| [pr-screenshots](skills/pr-screenshots/SKILL.md) | Red-boxed before/after screenshots of a local web app, put in a GitHub PR body |
| [helium-browser](skills/helium-browser/SKILL.md) | Drive your real Helium browser through the Playwright MCP extension without stealing focus |
| [past-chats](skills/past-chats/SKILL.md) | Search older [T3 Code](https://github.com/pingdotgg/t3code/) chats for past decisions and todo lists |
| [marketplace-price-research](skills/marketplace-price-research/SKILL.md) | Used-price research on FB Marketplace and Carousell MY (needs `helium-browser`) |

## Install

```bash
npx skills add harithilmi/agent-skills -s pr-screenshots -g -y
```

Want another skill? Swap the name after `-s`, or use `-s '*'` for all.

Update later with `npx skills update`. Setup steps for each skill are in its `SKILL.md`.
