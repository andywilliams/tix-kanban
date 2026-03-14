# Persona Collaboration Phase 2: Production Hardening

**Status:** ✅ Implemented  
**Ticket:** MMNPRY3X6QWOYB  
**Branch:** feature/MMNPRY3X6QWOYB-persona-phase2

## Overview

Phase 2 makes the persona collaboration system safe for production by adding comprehensive safety controls, budget management, and monitoring.

Builds on [Phase 1](./persona-phase1.md) (MMNPRNPP9WURO6) which introduced basic turn-taking.

## Features

### 1. Kill Switch (Human Override)

Humans can pause and resume persona conversations at any time.

**API Endpoints:**
```bash
# Pause a conversation
POST /api/conversation/:taskId/pause
{
  "reason": "Need to review progress"
}

# Resume a paused conversation
POST /api/conversation/:taskId/resume
```

**Priority:** Highest (paused conversations will not continue regardless of other conditions)

### 2. Max Iterations

Prevents infinite loops by capping the number of conversation turns per ticket.

**Default:** 20 iterations per ticket

**Behavior:**
- Each persona response increments the iteration counter
- Once max iterations is reached, conversation terminates with status `completed`
- Configurable per-conversation on startup

### 3. Three-Tier Budget Caps

**Budget limits (USD):**
- **Global daily:** $10.00 (across all conversations)
- **Per-ticket:** $2.00 (for each conversation)
- **Per-persona:** $0.50 (daily spend limit per persona)

**Enforcement:**
- All tiers are checked after each persona response
- If any cap is exceeded, conversation terminates with status `budget-exceeded`
- Budget resets daily at midnight UTC

**API Endpoint:**
```bash
# Get current budget status
GET /api/conversation/budget
```

### 4. Circuit Breaker

Detects runaway spending patterns and trips automatically.

**Threshold:** 3x expected spend rate

**How it works:**
1. Each conversation has an `expectedSpendRate` (default: $0.05/iteration)
2. After 3+ iterations, actual spend rate is calculated
3. If actual rate exceeds 3x expected rate, circuit breaker trips
4. Conversation terminates with status `budget-exceeded` and flag `circuitBreakerTripped: true`

### 5. Full Audit Trail

Every conversation event is logged immutably to the task activity timeline.

**Event types:**
- `started` - Conversation initialized
- `paused` - Human pause
- `resumed` - Conversation resumed
- `completed` - Successful completion
- `failed` - Failure (timeout, error)
- `iteration` - Iteration checkpoint
- `persona-response` - Persona spoke (includes token/cost data)
- `budget-check` - Budget limit reached
- `circuit-breaker` - Circuit breaker tripped
- `deadlock-detected` - Deadlock condition detected
- `idle-timeout` - Inactivity timeout

**Storage:**
- Events are logged to `task.activity[]`
- Each event includes: ID, timestamp, type, persona ID, details, budget spent, metadata

### 6. Deadlock Detection

Prevents conversations from stalling when personas are waiting on each other.

**Detection logic:**
- If `waitingOn` is set and no activity for >30 seconds → deadlock detected
- Conversation terminates with status `deadlocked`

**Monitoring:**
- Background monitor runs every 30 seconds
- Checks all active conversations for deadlock conditions

### 7. Idle Timeout

Terminates conversations that have stalled due to inactivity.

**Default timeout:** 10 minutes

**Behavior:**
- `lastActivityAt` is updated on every persona response
- If elapsed time exceeds `idleTimeoutMs` → conversation terminated
- Status set to `failed`

### 8. Async Event Loop

Personas do not block each other or the main server thread.

**Implementation:**
- Each conversation runs in an independent async loop
- Turn-taking is managed via `acquireSpeakingTurn` / `releaseSpeakingTurn`
- Personas wait for their turn without blocking other conversations
- Background monitor handles timeout/deadlock detection in parallel

**Loop termination priority:**
1. Human pause (kill switch)
2. Budget exhaustion (any tier)
3. Deadlock detected
4. Max iterations reached
5. Idle timeout
6. Explicit completion

## Architecture

### Core Components

**`persona-conversation.ts`** - State machine and safety controls
- Conversation state management
- Budget tracking (global, per-ticket, per-persona)
- Termination condition checks
- Event logging

**`conversation-context.ts`** - Context window management
- Summarizes older messages using Haiku (cheap, fast model)
- Keeps last 5 messages verbatim
- ~8K tokens/turn budget
- Token estimation and trimming

**`conversation-loop.ts`** - Async orchestration
- Non-blocking event loop per conversation
- Turn selection (round-robin)
- Persona response generation
- Integration with safety controls

**`conversation-api.ts`** - HTTP API
- Start/pause/resume endpoints
- Conversation state queries
- Budget status endpoint

### Data Model

**ConversationState** (stored in `task.conversationState`):
```typescript
{
  taskId: string;
  status: 'idle' | 'active' | 'paused' | 'completed' | 'failed' | 'budget-exceeded' | 'deadlocked';
  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
  currentIteration: number;
  maxIterations: number;
  lastActivityAt: Date;
  idleTimeoutMs: number;
  participants: string[]; // persona IDs
  waitingOn?: string; // current speaker
  budgetSpent: number; // USD
  budgetCap: number; // USD
  circuitBreakerTripped: boolean;
  expectedSpendRate: number; // USD/iteration
}
```

## API Reference

### Start Conversation

```bash
POST /api/conversation/:taskId/start
{
  "personaIds": ["developer", "qa", "tech-writer"],
  "maxIterations": 20,
  "budgetCap": 2.0
}
```

**Response:**
```json
{
  "started": true
}
```

### Pause Conversation (Kill Switch)

```bash
POST /api/conversation/:taskId/pause
{
  "reason": "Need to review direction"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation TASK123 paused"
}
```

### Resume Conversation

```bash
POST /api/conversation/:taskId/resume
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation TASK123 resumed"
}
```

### Get Conversation State

```bash
GET /api/conversation/:taskId
```

**Response:**
```json
{
  "taskId": "TASK123",
  "status": "active",
  "startedAt": "2026-03-14T00:00:00Z",
  "currentIteration": 5,
  "maxIterations": 20,
  "budgetSpent": 0.25,
  "budgetCap": 2.0,
  "participants": ["developer", "qa"],
  "lastActivityAt": "2026-03-14T00:05:00Z",
  ...
}
```

### Get Budget Status

```bash
GET /api/conversation/budget
```

**Response:**
```json
{
  "date": "2026-03-14",
  "globalSpent": 1.45,
  "perPersona": {
    "developer": 0.80,
    "qa": 0.45,
    "tech-writer": 0.20
  },
  "caps": {
    "globalDaily": 10.0,
    "perTicket": 2.0,
    "perPersona": 0.5
  },
  "remaining": {
    "global": 8.55,
    "perTicket": 2.0,
    "perPersona": 0.5
  }
}
```

## Testing

Comprehensive test suite in `src/server/__tests__/persona-conversation.test.ts`

**Coverage:**
- ✅ Conversation lifecycle (init, start, pause, resume, complete)
- ✅ Budget caps (per-ticket, per-persona, global)
- ✅ Max iterations
- ✅ Circuit breaker (3x spend rate)
- ✅ Idle timeout
- ✅ Deadlock detection
- ✅ Kill switch (pause override)

**Run tests:**
```bash
npm test -- persona-conversation
```

## Monitoring

Background monitor runs every 30 seconds (`runConversationMonitor` in `persona-conversation.ts`)

**Checks:**
- Idle timeout for all active conversations
- Deadlock detection
- Daily budget reset (at midnight UTC)

**Logging:**
- All safety events logged to console
- Full audit trail in task activity

## Configuration

**Environment variables** (optional):
```bash
# Budget caps (defaults shown)
CONVERSATION_GLOBAL_DAILY_BUDGET=10.0
CONVERSATION_PER_TICKET_BUDGET=2.0
CONVERSATION_PER_PERSONA_BUDGET=0.5

# Timeouts
CONVERSATION_IDLE_TIMEOUT_MS=600000  # 10 minutes
CONVERSATION_TURN_TIMEOUT_MS=120000  # 2 minutes (from Phase 1)
CONVERSATION_DEADLOCK_CHECK_MS=30000 # 30 seconds
```

## Migration from Phase 1

Phase 2 is fully backward compatible with Phase 1.

**No migration required:**
- Existing turn-taking code continues to work
- Conversations without Phase 2 state will initialize on first access
- Older tasks without `conversationState` will function normally

## Future Enhancements (Phase 3)

Potential additions for Phase 3:
- Dynamic persona selection based on task requirements
- Adaptive context summarization (quality vs. cost tradeoff)
- Conversation quality metrics and ratings
- Multi-threaded conversations (parallel sub-discussions)
- Conversation templates/patterns
- Real-time streaming persona responses

## Related Documentation

- [Phase 1: Basic Collaboration](./persona-phase1.md)
- [Provider System](./providers.md)
- [Chat Storage](../src/server/chat-storage.ts)
