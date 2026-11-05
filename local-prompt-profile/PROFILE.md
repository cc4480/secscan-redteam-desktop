# Local Prompt Profile — spec

Purpose: a fixed prompt small enough for local models with a 32,768-token
context window (Qwen3.5-4B class), built 2026-11-04 at Carlos's direction.
Nothing here modifies the app (freeze respected); this package is the input
a future wiring step (or the in-app agents) consumes.

## Design rules (Carlos's, from the 2026-11-04 session)

1. **AGENTS.md rides whole.** The operating rules are the non-negotiable
   core; compression happens around them, never to them.
2. **Tools are deferred, not deleted.** Only the Layer-1 stub index
   (name + one line) rides in the prompt. A tool's full schema loads at
   call time (Layer-2) and is dropped after. Nothing is removed from the
   agents' reach.
3. **History does not ride.** Local seats start fresh, or carry a summary
   of at most ~2,000 tokens. (The 117,276-token failure on 2026-11-04 was
   an old restored session: assembled bulk, not authored prompt.)
4. **One soul per seat.** The seat's soul file rides; the other six stay
   on disk.

## Assembly order

1. `core/AGENTS.md` (verbatim)
2. `core/SOUL.md`, `core/IDENTITY.md`, `core/USER.md`, `core/TOOLS.md`,
   `core/PROACTIVE_PREFERENCES.md` (verbatim)
3. `app-core/souls/<seat>.md` — one, for the seat in use
4. `tool-index.md` — Layer-1 stubs
5. Engagement/session state, summarized (≤ ~2,000 tok)

`assembled-chat.md` is the worked example: core set + Morpheus soul +
tool index, concatenated in that order.

## Measured budget (tiktoken cl100k_base, 2026-11-04)

| Piece | Tokens |
|---|---|
| AGENTS.md | 5,663 |
| SOUL.md | 402 |
| USER.md | 300 |
| PROACTIVE_PREFERENCES.md | 199 |
| IDENTITY.md | 75 |
| TOOLS.md | 71 |
| **Core total** | **6,710** |
| Soul (one; range across 7 seats) | 683–1,113 |
| Tool stub index (108 tools) | 2,173 |
| Same 108 tools, full schemas as sent today | 8,551 |
| **Assembled chat profile** | **9,732** |
| Window | 32,768 |
| **Headroom for the live conversation** | **23,036** |

Notes:
- Qwen's tokenizer differs from cl100k by roughly ±10%; the verdict does
  not change at this headroom.
- The tool registry snapshot is 2026-11-02 (108 tools). The live bridge
  serves 109; regenerate `tool-index.md` from the live registry when
  wiring. Full-schema cost measured on the bridge catalog; the app's
  total tool surface is larger, which is what deferral is for.
- Research basis: `~/workspace/research_notes/agent-prompt-budget-small-models-20261105-0424/report.md`
  (Anthropic Tool Search: ~77K → ~8.7K with accuracy up; layered prompts;
  compaction). This package applies the same pattern to Carlos's stack.
- Still owed: llama.cpp server-side pass (context size, KV-cache
  quantization, prompt-cache reuse) — the profile makes it unnecessary
  for chat, but fleet seats with Layer-2 skill bodies may still want it.
- MEMORY.md is deliberately NOT in the core set: it is Cho-zen1's memory
  of Carlos, not agent instructions.
