# Phase 2 Test Plan

## API Endpoints to Test

```bash
# Budget status
curl http://localhost:5050/api/collaboration/budget

# Collaboration status
curl http://localhost:5050/api/collaboration/status/general-chat

# Pause
curl -X POST http://localhost:5050/api/collaboration/pause/general-chat \
  -H "Content-Type: application/json" -d '{"pausedBy": "admin"}'

# Resume
curl -X POST http://localhost:5050/api/collaboration/resume/general-chat

# Audit log
curl http://localhost:5050/api/collaboration/audit/general-chat

# Audit report
curl http://localhost:5050/api/collaboration/audit/general-chat/report
```

## Expected Behavior

1. **Budget enforcement** - Personas stop when limits hit
2. **Turn limits** - Max 20 turns per collaboration
3. **Pause/resume** - Human can halt collaboration
4. **Audit trail** - All events logged to ~/.tix-kanban/audit/
5. **Context summarisation** - Long conversations summarised with Haiku

## Files Created

- `~/.tix-kanban/budgets/daily-budget.json`
- `~/.tix-kanban/collaboration-control/*.json`
- `~/.tix-kanban/audit/*.jsonl`

See full test plan in repository.
