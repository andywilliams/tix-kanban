# Persona Session Infrastructure

## Overview

Each persona now maintains a persistent conversation thread stored in the SQLite database. This enables conversational continuity across tasks and chat interactions—personas "remember" previous tasks, decisions, and conversations.

## Core Concepts

### Session Thread
- Each persona has exactly one active session thread
- Messages are typed: `system`, `user`, `assistant`, `tool`
- The thread is passed as conversation history to every AI invocation for that persona
- Sessions are created automatically on first interaction with a persona

### Context Window Management
- Token count is tracked for the entire session thread
- When approaching context limit (~80% of 100k tokens by default), automatic compaction triggers
- Compaction:
  - Keeps recent 20 messages verbatim
  - Summarizes older messages using Claude
  - Stores summary as a new system message
  - Records compaction metadata in `compactions` table
- Compaction is transparent—persona continues without losing important context

### Session Lifecycle
- Session created automatically on first interaction with a persona
- Persists indefinitely (or until manually reset)
- Can be reset/archived from the UI or API
- Each persona has exactly one active session thread

## Database Schema

### `sessions` table
- `id` — unique session ID
- `personaId` — reference to persona
- `createdAt` — session creation timestamp
- `updatedAt` — last message timestamp
- `tokenCount` — current total token count
- `compactionCount` — number of times session has been compacted

### `messages` table
- `id` — unique message ID
- `sessionId` — reference to session
- `role` — `system`, `user`, `assistant`, or `tool`
- `content` — message content
- `tokenCount` — tokens in this message
- `createdAt` — message timestamp
- `metadataJson` — optional JSON metadata (task ID, etc.)

### `compactions` table
- `id` — unique compaction ID
- `sessionId` — reference to session
- `summary` — summarized content
- `messagesCompacted` — number of messages replaced
- `tokensFreed` — tokens saved by compaction
- `createdAt` — compaction timestamp

## API Endpoints

### GET `/api/personas/:personaId/session`
Get session info and stats

**Response:**
```json
{
  "sessionId": "sess_1234567890_abc123",
  "tokenCount": 45230,
  "messageCount": 42,
  "compactionCount": 2,
  "createdAt": "2026-03-18T12:00:00Z",
  "updatedAt": "2026-03-18T23:30:00Z"
}
```

### POST `/api/personas/:personaId/session/reset`
Reset session (clear all messages and compactions)

**Response:**
```json
{
  "success": true,
  "message": "Session reset successfully"
}
```

### GET `/api/personas/:personaId/session/messages`
Get session message history

**Query params:**
- `limit` (optional) — maximum number of messages to return

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_1234567890_xyz789",
      "role": "user",
      "content": "## Task: Implement feature X\n\n...",
      "tokenCount": 523,
      "createdAt": "2026-03-18T12:00:00Z",
      "metadata": {
        "taskId": "TASK123",
        "taskTitle": "Implement feature X"
      }
    },
    {
      "id": "msg_1234567891_abc456",
      "role": "assistant",
      "content": "I've implemented feature X. Here's what I did:\n...",
      "tokenCount": 1234,
      "createdAt": "2026-03-18T12:15:00Z",
      "metadata": {
        "taskId": "TASK123",
        "success": true
      }
    }
  ]
}
```

## Integration

### Worker Task Invocations
When a persona is invoked to work on a task:

1. **Before execution:**
   - Get or create session for the persona
   - Add task context as a `user` message
   - Session history (last 10 exchanges) is included in the prompt via `createPersonaContext`

2. **After execution:**
   - Add AI output as an `assistant` message
   - Automatic compaction triggers if token count exceeds threshold

### Prompt Construction
The `createPersonaContext` function now includes:
- System prompt (persona's base instructions)
- Soul prompt (personality traits)
- Memory context (long-term learnings)
- **Session conversation history** (recent exchanges for continuity)
- Current task details
- Completion summary requirement (for work-doing personas)

Session history is injected between memory and task context, showing the last 10 exchanges (truncated to 500 chars per message for token efficiency).

## Token Counting

Uses `tiktoken` library with GPT-4 encoding for accurate token estimation.

**Fallback:** If tiktoken fails, falls back to rough estimate (4 chars per token).

## Compaction Strategy

Triggered when session exceeds 80,000 tokens (80% of 100k context limit).

**Process:**
1. Keep most recent 20 messages verbatim
2. Collect older messages to summarize
3. Use Claude Sonnet 4.5 to generate summary with prompt:
   > "Summarize the key decisions, outcomes, and context from these messages. Focus on what's important for maintaining conversational continuity. Be concise but preserve critical details."
4. Create new `system` message with summary
5. Delete old messages
6. Record compaction in `compactions` table
7. Update session `tokenCount` and `compactionCount`

## Example Flow

1. Worker picks up task TASK123 for `developer` persona
2. Session service:
   - Gets or creates session for `developer`
   - Adds task context as `user` message
   - Retrieves last 10 exchanges for context
3. Prompt builder includes session history in context
4. Claude executes task with full conversational continuity
5. Session service adds output as `assistant` message
6. If token count > 80k, compaction automatically triggers
7. Persona retains important context without hitting limits

## Benefits

- **Continuity:** Personas remember previous tasks and decisions
- **Context-aware:** Follow-up tasks can reference earlier work
- **Scalable:** Automatic compaction prevents context window overflow
- **Transparent:** Compaction is invisible to the persona—no interruption
- **Auditable:** Full conversation history in database
- **Efficient:** Token counting ensures predictable costs

## Future Enhancements

- UI for viewing session history
- Manual compaction trigger
- Session archival/export
- Per-persona context limits
- Session branching for parallel task streams
- Cross-persona session sharing for collaboration
