# Phase 2 Production Hardening - Integration Guide

See this file for complete integration instructions. The Phase 2 modules are implemented but require manual integration into the main codebase.

## Modules Implemented

1. **collaboration-budget.ts** - Budget tracking ($10/day global, $2/ticket, $0.50/persona)
2. **collaboration-context.ts** - Context summarisation with Haiku
3. **collaboration-control.ts** - Pause/resume and turn limits (20 max)
4. **collaboration-audit.ts** - Immutable JSONL audit logs

## Quick Start

1. `npm install` (adds @anthropic-ai/sdk)
2. Set `ANTHROPIC_API_KEY` env var
3. Add initialization calls in `src/server/index.ts` startServer():

```typescript
await initializeBudgetStorage();
await initializeControlStorage();
await initializeAuditStorage();
```

4. Add API endpoints (7 routes - see full guide in this file)
5. Integrate into `agent-chat.ts` generatePersonaResponse():
   - Check `canTakeTurn()` before generating
   - Check `checkBudget()` before API call
   - Call `recordUsage()` and `auditTurnTaken()` after response
   - Call `recordTurn()` to track collaboration progress
   - Use `buildContextWindow()` for long conversations

## Testing

Run `test-phase2.md` test plan after integration.

## Full integration instructions available in this file (scroll down).
