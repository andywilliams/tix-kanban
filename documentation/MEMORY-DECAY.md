# Memory Decay & Curation System

Implementation of intelligent memory management for Forge personas.

## Overview

The memory system now automatically manages growth through decay, archival, reinforcement, and LLM-powered curation.

## Architecture

### Core Components

1. **memory-archive.ts** - Archive storage (searchable but not in active context)
2. **memory-decay.ts** - Age-based archival with importance thresholds
3. **memory-reinforcement.ts** - Usage tracking and automatic importance boosting
4. **memory-curation.ts** - Weekly LLM analysis and promotion to project memory
5. **memory-jobs.ts** - Cron scheduler for automated maintenance

## Decay Rules

| Importance | Decay Threshold | Notes |
|------------|----------------|-------|
| Low | 30 days | Quick cleanup of low-value memories |
| Medium | 90 days | Standard retention for useful memories |
| High | Never | Important memories persist indefinitely |

**Protection:** Memories recalled within the last 7 days are protected from decay regardless of age.

## Reinforcement

Memories gain importance through usage:

- **5+ recalls** → Boost from low to medium
- **10+ recalls** → Boost to high
- **20+ recalls** → Additional boosts allowed

Success/failure tracking flags unreliable memories for review.

## Weekly Curation

Every Sunday at 3am:

1. LLM (Claude Sonnet) reviews the week's memories
2. Identifies patterns, recurring lessons, decisions
3. Promotes valuable insights to project memory (shared)
4. Flags contradictions and outdated info
5. Archives superseded memories
6. Generates digest report

## API Quick Reference

### Job Management
```bash
# Check job status
GET /api/memory/jobs/status

# Run decay manually
POST /api/memory/jobs/decay

# Run curation manually
POST /api/memory/jobs/curation

# Get recent reports
GET /api/memory/jobs/reports?limit=10
```

### Decay & Archive
```bash
# Preview what would be archived
GET /api/memory/:personaId/decay/preview

# Run decay for a persona
POST /api/memory/:personaId/decay

# Manually archive specific memories
POST /api/memory/:personaId/archive
Body: { "memoryIds": ["mem_xxx", "mem_yyy"] }

# Get archive
GET /api/memory/:personaId/archive

# Archive statistics
GET /api/memory/:personaId/archive/stats

# Search archive
GET /api/memory/:personaId/archive/search?q=query&limit=20

# Restore from archive
POST /api/memory/:personaId/archive/:memoryId/restore
```

### Reinforcement
```bash
# Get usage tracking data
GET /api/memory/:personaId/reinforcement

# Get statistics
GET /api/memory/:personaId/reinforcement/stats

# Get flagged memories (high failure rate)
GET /api/memory/:personaId/reinforcement/flagged?minFailures=3

# Record task outcome
POST /api/memory/:personaId/outcome
Body: { "memoryIds": ["mem_xxx"], "success": true }
```

## Configuration

Jobs can be configured in `initializeMemoryJobs()`:

```typescript
await initializeMemoryJobs({
  decayCron: '0 2 * * *',      // Daily at 2am (default)
  curationCron: '0 3 * * 0',   // Sunday at 3am (default)
  enableDecay: true,           // Enable decay job
  enableCuration: true,        // Enable curation job
});
```

## Storage Locations

All memory data stored in `~/.tix-kanban/personas/:personaId/`:

- `memory.json` - Active memories
- `archive.json` - Archived memories
- `reinforcement.json` - Usage tracking data

Job reports: `~/.tix-kanban/memory-jobs/`

## Integration

### Automatic Tracking

Memory recalls are automatically tracked when using `getRelevantMemories()`:

```typescript
const memories = await getRelevantMemories(personaId, context, 10);
// Tracking happens automatically, non-blocking
```

### Manual Outcome Recording

After using memories in a task:

```typescript
await recordTaskOutcome(personaId, memoryIds, success);
```

## Monitoring

- Job reports saved with full audit trail
- Archive stats provide growth metrics
- Reinforcement stats show usage patterns
- Flagged memories highlight problematic entries

## Future Enhancements

- UI dashboard for memory management
- Tunable decay thresholds per persona
- Custom importance scoring algorithms
- Memory similarity detection for deduplication
- Multi-persona curation analysis
