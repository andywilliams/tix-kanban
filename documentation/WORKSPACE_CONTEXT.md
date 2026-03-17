# Workspace Context System

**Status:** ✅ Implemented and integrated

The workspace context system provides personas with rich situational awareness about the development environment, tasks, knowledge base, and project state.

## Features

### 1. Repository Discovery

Auto-discovers Git repositories from:
- `~/repos`
- `~/code`
- `~/projects`
- User-configured workspace directory (see User Settings)

For each repository, extracts:
- Name and path
- Description (from package.json or README)
- Tech stack (React, TypeScript, Express, etc.)
- Key files (API docs, architecture, tests)

#### Manual Configuration

Create `data/repos.yaml` or `~/.tix-kanban/repos.yaml` for manual repo configuration:

```yaml
repos:
  - name: my-app
    path: ~/code/my-app
    description: My application
    stack: [TypeScript, React]
    keyFiles: [src/index.ts, README.md]
```

See `examples/repos.yaml.example` for a template.

### 2. Board State Summary

Provides comprehensive board insights:
- **Task counts** by status (backlog, in-progress, review, done)
- **Work assignments** by persona
- **In-progress tasks** with priorities
- **Blocked tasks** with reasons
- **Stale tasks** (not updated in 7+ days)
- **Recent completions** (last 7 days)
- **High-priority backlog** (priority < 300)

### 3. Knowledge Base Integration

Searches knowledge articles for relevant context based on conversation topic.

### 4. Reports & History

Includes recent standup reports and worker run history.

### 5. Token Budgeting

Automatically limits context to ~2000 tokens to avoid overwhelming the LLM:
- Repos: ~100 tokens each
- Board state: ~200 tokens base
- Knowledge: ~30 tokens per item
- Reports: ~40 tokens per item

### 6. Caching

Workspace context is cached for 5 minutes to reduce overhead. Auto-refreshes when expired.

## Implementation

### Files

- `src/server/workspace-context.ts` - Main implementation
- `examples/repos.yaml.example` - Sample manual configuration

### Integration

Workspace context is automatically included in persona conversations via `agent-chat.ts`:

```typescript
// Get workspace context (repos, board overview, recent reports)
const wsContext = await getCachedWorkspaceContext();
const workspaceContext = renderWorkspaceContext(wsContext, 800);

// Include in prompt
const prompt = `
${workspaceContext}

${taskContext}

${conversationHistory}

${message}
`;
```

## API Reference

### `discoverRepos(): Promise<RepoInfo[]>`

Discovers all repositories (manual config + auto-discovery).

**Returns:** Array of repository metadata objects.

### `getBoardSummary(): Promise<BoardSummary>`

Builds comprehensive board state summary.

**Returns:** Board summary with task counts, assignments, blockers, etc.

### `buildWorkspaceContext(options?): Promise<WorkspaceContext>`

Assembles workspace context with token budgeting.

**Options:**
- `includeRepos` (boolean) - Include repository registry
- `includeBoard` (boolean) - Include board state
- `includeKnowledge` (boolean) - Include knowledge articles
- `includeReports` (boolean) - Include recent reports
- `knowledgeQuery` (string) - Search query for knowledge
- `maxTokens` (number) - Token budget (default: 2000)

**Returns:** Workspace context object with estimated token count.

### `renderWorkspaceContext(context, tokenBudget?): string`

Renders workspace context as markdown.

**Parameters:**
- `context` (WorkspaceContext) - Context to render
- `tokenBudget` (number) - Max tokens (default: 2000)

**Returns:** Markdown string, truncated if exceeding budget.

### `getCachedWorkspaceContext(forceRefresh?): Promise<WorkspaceContext>`

Get cached workspace context (5min TTL).

**Parameters:**
- `forceRefresh` (boolean) - Force rebuild (default: false)

**Returns:** Cached or freshly built workspace context.

### `invalidateWorkspaceCache(): void`

Invalidate cache, forcing rebuild on next access.

## Configuration

### User Settings

Configure workspace directory via user settings:

```typescript
{
  "workspaceDir": "~/code"
}
```

### Manual Repo Config

Copy `examples/repos.yaml.example` to one of:
- `data/repos.yaml` (project-local)
- `~/.tix-kanban/repos.yaml` (user-global)

Edit with your repositories.

## Token Budget Example

With default settings (~2000 tokens):
- 10 repos × 100 tokens = 1000 tokens
- Board state = 200 tokens
- 5 knowledge items × 30 = 150 tokens
- 3 reports × 40 = 120 tokens
- **Total: ~1470 tokens** (well within budget)

## Future Enhancements

Potential improvements:
- Git history integration (recent commits, branches)
- PR status and review comments
- CI/CD pipeline status
- Deployment history
- Dependencies and security alerts
- Test coverage metrics

## Related Systems

- **Knowledge Storage** (`src/server/knowledge-storage.ts`) - Knowledge base
- **Reports Storage** (`src/server/reports-storage.ts`) - Standup reports
- **User Settings** (`src/server/user-settings.ts`) - Configuration
- **Agent Chat** (`src/server/agent-chat.ts`) - Integration point
