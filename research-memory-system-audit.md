# AI Persona Memory System — Audit & Bug Report

**Date:** 2026-02-25
**Investigator:** QA Engineer Persona
**Status:** Complete

---

## Executive Summary

The tix-kanban memory system has a **dual-path architecture** with two separate memory subsystems that operate in parallel but are partially disconnected from each other and from the UI. The memory page appears sparse because:

1. **No `memory.json` files exist on disk** — the structured memory system (`persona-memory.ts`) has never been populated via its own storage path.
2. **The UI aggregates from agent-memory files** — but most of those are empty (only 2 of 4 personas have entries, and those entries contain parsing artifacts rather than meaningful memories).
3. **Two competing `parseRememberCommand` implementations** exist in different files, causing confusion about which memory system receives writes.
4. **Three personas have zero memory infrastructure** — no agent-memory JSON files exist for qa-engineer, security-reviewer, or code-reviewer.

**Severity: Medium-High** — The memory system is architecturally sound but functionally broken in several key areas.

---

## 1. Architecture Overview

### Three Memory Layers

| Layer | Storage Location | Format | Purpose |
|-------|-----------------|--------|---------|
| **Agent Memory** | `~/.tix-kanban/agent-memories/{personaId}/{userId}.json` | JSON | Per-user, per-persona memories (preferences, context, instructions) |
| **Structured Memory** | `~/.tix-kanban/personas/{personaId}/memory.json` | JSON | Persona-wide structured memories (shared across users) |
| **Task History** | `~/.tix-kanban/personas/{personaId}/MEMORY.md` | Markdown | Chronological log of completed tasks and learnings |

### Two Code Paths for Chat Mentions

| Handler | File | Memory System Used | Remember Storage |
|---------|------|--------------------|-----------------|
| `agent-chat.ts` | Direct chat | `agent-memory.ts` (per-user JSON) | Writes to agent-memories/ |
| `mention-handler.ts` | Channel @mentions | `persona-memory.ts` (structured) | Writes to personas/memory.json |

---

## 2. Memory Write Path Analysis

### Path A: agent-chat.ts → agent-memory.ts
- **Trigger:** Direct chat with a persona
- **Remember parsing:** Uses `parseRememberCommand()` from `agent-memory.ts`
- **Storage:** Writes to `~/.tix-kanban/agent-memories/{personaId}/{userId}.json`
- **Also has:** Automatic inferred memory extraction from `extractAndStoreInferredMemory()` (patterns like "I always...", "our project uses...")
- **Status:** Partially working — files exist but content quality is poor (see Bug #1)

### Path B: mention-handler.ts → persona-memory.ts
- **Trigger:** @mention in a channel
- **Remember parsing:** Uses `processRememberCommand()` from `persona-memory.ts`
- **Storage:** Should write to `~/.tix-kanban/personas/{personaId}/memory.json`
- **Status:** **Not producing output** — no `memory.json` files exist on disk

### Path C: Task completion → persona-storage.ts
- **Trigger:** Task marked complete or rated
- **Storage:** Appends to `~/.tix-kanban/personas/{personaId}/MEMORY.md`
- **Status:** Working — Developer has 961 lines, Tech-Writer has 209 lines

---

## 3. Memory Read Path Analysis

### UI Memory Page (`PersonaMemoriesPage.tsx`)
- **Fetches:** `GET /api/personas/{id}/memories`
- **API handler** (index.ts:1004): Calls `getAllPersonaMemories()` from **agent-memory.ts**
- **Aggregation:** Transforms agent-memory entries (all users) into structured memory format
- **Result:** Only shows agent-memory entries, NOT the structured `memory.json` or `MEMORY.md` content

### Memory Context for AI Prompts
- `mention-handler.ts` calls `generateMemoryContext()` from `persona-memory.ts`
- This reads from the structured memory system (`memory.json`) — which is always empty
- **Result:** Personas never have memory context when responding to @mentions

### MEMORY.md in AI Prompts
- Task history (`MEMORY.md`) is loaded via `getPersonaMemoryWithTokens()` in `persona-storage.ts`
- Used during task execution (not chat) — personas see their task history when working on tasks
- **Status:** Working correctly for task context

---

## 4. Bugs Identified

### Bug #1: Garbled Memory Content (HIGH)
**Location:** `agent-memory.ts` `parseRememberCommand()` + `agent-chat.ts`

The stored memories contain raw message fragments rather than parsed "remember" content:

```json
// developer/Andy.json - Entry 1
{
  "content": "a couple of bugs in the chat, so bear with me. Thank you for your responses so far, and please reply to this.",
  "source": "explicit"
}

// developer/Andy.json - Entry 2
{
  "content": "something? I'm not sure what. Just say, \"Remember that we do QA sessions on Friday.\"",
  "source": "explicit"
}
```

The second entry should have stored `"we do QA sessions on Friday"` but instead stored the entire instruction message. The remember parser is matching too broadly and capturing surrounding message text.

**Root Cause:** The regex `(?:remember|note|keep in mind|don't forget)[\s:]+(?:that\s+)?(.+)` uses `.+` which greedily captures everything after "remember that" including quoted text and surrounding context. When the user's message wraps a remember instruction in conversational text, the parser captures the wrong segment.

### Bug #2: No `memory.json` Files Created (HIGH)
**Location:** `persona-memory.ts` / `mention-handler.ts`

No `memory.json` files exist under `~/.tix-kanban/personas/*/`. The `processRememberCommand` in `persona-memory.ts` should write to these files, but either:
- The code path is never triggered (mentions route through `agent-chat.ts` instead)
- There's a write failure that's silently swallowed
- The structured memory system was added later and never fully integrated

**Impact:** The `generateMemoryContext()` function always returns empty context for AI prompts.

### Bug #3: Duplicate `parseRememberCommand` Implementations (MEDIUM)
**Location:** `agent-memory.ts:223` and `persona-memory.ts:361`

Two separate functions with the same name exist in different modules:
- `agent-memory.ts` version: Returns `{isRemember, category, content, keywords}`
- `persona-memory.ts` version: Returns `ParsedRememberCommand` with different structure

`agent-chat.ts` imports from `agent-memory.ts`, `mention-handler.ts` imports from `persona-memory.ts`. This creates confusion and means memories from different entry points go to different storage backends.

### Bug #4: Empty Agent-Memory Files (MEDIUM)
**Location:** `~/.tix-kanban/agent-memories/`

- `bug-fixer/Andy.json` — 2 interactions, 0 memory entries
- `product-manager/Andy.json` — 6 interactions, 0 memory entries

Interactions are counted but no memories are stored. This suggests the remember-command parsing isn't matching the user's messages, or the inferred-memory extraction patterns are too restrictive.

### Bug #5: Missing Agent-Memory Files for 3 Personas (LOW)
**Location:** `~/.tix-kanban/agent-memories/`

No memory files exist for: `qa-engineer`, `security-reviewer`, `code-reviewer`. These personas have 0 completed tasks and likely 0 chat interactions, so this may be expected — files are only created on first interaction.

### Bug #6: MEMORY.md Not Surfaced in UI (MEDIUM)
**Location:** `PersonaMemoriesPage.tsx`

The UI memory page only shows agent-memory entries (from JSON files). The rich task history in `MEMORY.md` files (Developer has 961 lines of learnings) is completely invisible on the memory page. This is likely why the page "appears sparse" — the most substantial memory content exists but isn't displayed.

### Bug #7: userId Mismatch Between Systems (LOW)
**Location:** Multiple files

- Agent-chat uses `message.author` as userId (e.g., `"Andy"`)
- `useAgentMemory` hook defaults to `userId = 'default'`
- The `MemoryViewer` component defaults to `userId = 'default'`

If the UI queries with `userId='default'` but memories are stored under `userId='Andy'`, the MemoryViewer component would show nothing.

---

## 5. Current State of Memory Data

### Agent-Memory Files (JSON)

| Persona | User | Entries | Interactions | Status |
|---------|------|---------|-------------|--------|
| developer | Andy | 2 (garbled) | 10 | Has data but content is poor quality |
| tech-writer | Andy | 1 | 7 | Has data |
| bug-fixer | Andy | 0 | 2 | Empty |
| product-manager | Andy | 0 | 6 | Empty |
| qa-engineer | — | — | — | No file exists |
| security-reviewer | — | — | — | No file exists |
| code-reviewer | — | — | — | No file exists |

### Structured Memory Files (memory.json)
**None exist.** Zero `memory.json` files on disk under `~/.tix-kanban/personas/`.

### Task History Files (MEMORY.md)

| Persona | Lines | Status |
|---------|-------|--------|
| developer | 961 | Rich task history, well-populated |
| tech-writer | 209 | Good task history |
| code-reviewer | 35 | Minimal (2 reviews) |
| product-manager | 19 | Minimal (1 task) |
| bug-fixer | — | Not checked / may not exist |

### Claude Auto-Memory
`~/.claude/projects/-Users-andrewwilliams-development-tools-tix-kanban/memory/MEMORY.md` — Contains only 1 brief note about task conventions. This is separate from tix-kanban's memory system and managed by Claude Code itself.

---

## 6. Cross-Persona Memory Analysis

- **Agent-memory:** Isolated per persona per user. No cross-persona sharing or conflicts.
- **Structured memory:** Isolated per persona. No sharing mechanism.
- **MEMORY.md:** Isolated per persona. No sharing mechanism.
- **No conflict risk** — each persona has its own storage namespace.
- **No shared learning** — a lesson learned by Developer is invisible to Bug-Fixer, even if relevant.

---

## 7. Recommendations

### Critical Fixes

1. **Fix remember-command parsing** (Bug #1) — The regex in `agent-memory.ts:parseRememberCommand()` needs to be more precise. It should strip conversational wrapper text and extract only the core "remember" content.

2. **Unify or connect the two memory systems** (Bugs #2, #3) — Either:
   - **Option A:** Remove the structured memory system and standardize on agent-memory for everything
   - **Option B:** Make both systems write to a common store, with the API reading from one unified source
   - **Option C:** Have the `GET /api/personas/:id/memories` endpoint aggregate from ALL three sources (agent-memory JSON + memory.json + MEMORY.md)

3. **Surface MEMORY.md in the UI** (Bug #6) — Add MEMORY.md task history to the memory page, perhaps as a "Task History" or "Learnings" tab. This is where the richest memory content lives.

### Medium Priority

4. **Fix userId consistency** (Bug #7) — Ensure the UI passes the correct userId when querying agent-memory. Either standardize on a userId source or make the API return all users' memories.

5. **Add memory write confirmation logging** — When a memory is stored, log the exact content to help debug whether the right content is being captured.

### Nice to Have

6. **Cross-persona memory sharing** — Allow important learnings (e.g., "this project uses Bun not npm") to propagate to all personas.

7. **Memory quality scoring** — Flag garbled or suspiciously long memory entries for review.

---

## 8. End-to-End Flow Diagram

```
User sends message with @mention
        │
        ├──→ Channel mention ──→ mention-handler.ts
        │         │
        │         ├── processRememberCommand() [persona-memory.ts]
        │         │         │
        │         │         └── Writes to memory.json (BROKEN - no files created)
        │         │
        │         └── generatePersonaResponse()
        │                   │
        │                   └── generateMemoryContext() reads memory.json (EMPTY)
        │
        └──→ Direct chat ──→ agent-chat.ts
                  │
                  ├── parseRememberCommand() [agent-memory.ts]
                  │         │
                  │         └── Writes to agent-memories/{pid}/{uid}.json (WORKING but garbled)
                  │
                  ├── extractAndStoreInferredMemory() (auto-detection)
                  │
                  └── buildMemoryContext() reads agent-memories/ (WORKING)

Task completed ──→ persona-storage.ts
        │
        └── updatePersonaMemoryAfterTask()
                  │
                  └── Appends to MEMORY.md (WORKING)

UI Memory Page ──→ GET /api/personas/:id/memories
        │
        └── getAllPersonaMemories() [agent-memory.ts]
                  │
                  └── Reads agent-memories/ JSON files (WORKING but sparse data)

        ❌ Does NOT read memory.json
        ❌ Does NOT read MEMORY.md
```

---

## 9. Conclusion

The memory system's architecture is reasonable — three layers serving different purposes (user-specific recall, structured knowledge, task history). However, the implementation has several integration gaps:

1. The **structured memory layer is effectively dead** — no data is being written to or read from `memory.json` files.
2. The **agent-memory layer has parsing bugs** that store garbage content.
3. The **richest data source (MEMORY.md)** is invisible in the UI.
4. The **two code paths** for handling mentions create a split-brain situation where memories may go to different backends depending on how the user interacts with a persona.

The system needs consolidation: either merge the two memory subsystems or ensure the UI reads from all sources. The most impactful quick win would be surfacing `MEMORY.md` content in the UI and fixing the remember-command parser.
