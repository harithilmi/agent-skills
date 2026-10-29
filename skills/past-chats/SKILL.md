---
name: past-chats
description: >-
  Search older T3 Code chats whenever a request assumes shared history, names something unfamiliar, or would make you guess or ask — when unsure, search.
metadata:
  author: harithilmi
---

# Past chats

Older T3 Code threads hold audits, decisions and todo lists that memory may have missed.

## Steps

1. Load tools: `ToolSearch` → `select:mcp__t3-code__t3_thread_search,mcp__t3-code__t3_thread_read`.
2. Search several keywords in parallel: feature name, PR number (`#1290`), file or component name, and the user's likely wording ("pending", "the app", "mobile").
3. A snippet looks right → note its `threadId` and `messageCreatedAt`.
4. Read the full message:
   - Short thread: `t3_thread_read` with `limit` and a small `maxCharsPerItem`.
   - Long thread (`itemCount` in the hundreds or more): jump with `afterPosition`, `limit: 3`, `maxCharsPerItem: 60`, `runLimit: 1`. Compare `updatedAt` with the target time and bisect.
   - Found the item → read it again with `itemId` and a large `maxCharsPerItem`.
5. Check if it's still true. Later messages may correct it, and code may have changed since. Re-check code or repos for anything you will act on.
6. Link the source thread in the reply: `[title](t3-thread://v1/<threadId>)`.
7. Durable finding (pending list, decision, gotcha) → save it to memory so next time skips this search.

## Don't

- Don't read every thread. Search first, read only the matches.
- Don't treat a nested `thread:provider:...` subagent thread as the main answer. Prefer the parent thread's assistant message.
