# Tix-Kanban API Reference

**Base URL:** `http://localhost:3001/api`

## Task Operations

### GET /api/tasks
Get all tasks in the system.
```bash
curl http://localhost:3001/api/tasks
```
Response: `{"tasks": [...]}`

### GET /api/tasks/:id
Get single task with full details (comments, links, activity).
```bash
curl http://localhost:3001/api/tasks/ABC123XYZ
```
Response: `{"task": {...}}`

### POST /api/tasks
Create a new task.
```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Task title", "status": "backlog", "description": "Details", "priority": 100}'
```

### PUT /api/tasks/:id
Update a task (status, description, priority, etc.).
```bash
curl -X PUT http://localhost:3001/api/tasks/ABC123XYZ \
  -H "Content-Type: application/json" \
  -d '{"status": "in-progress"}'
```

### DELETE /api/tasks/:id
Delete a task.
```bash
curl -X DELETE http://localhost:3001/api/tasks/ABC123XYZ
```

## Task Status Values
- `"backlog"` - Task waiting to be picked up
- `"in-progress"` - Task currently being worked on
- `"review"` - Task completed, needs review
- `"done"` - Task fully completed

## Comments

### POST /api/tasks/:id/comments
Add a work comment to a task.
```bash
curl -X POST http://localhost:3001/api/tasks/ABC123XYZ/comments \
  -H "Content-Type: application/json" \
  -d '{"body": "Implemented feature X with tests", "author": "claude-worker"}'
```

## Links

### POST /api/tasks/:id/links
Add a link to a task (PR, document, reference).
```bash
curl -X POST http://localhost:3001/api/tasks/ABC123XYZ/links \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/owner/repo/pull/123", "title": "PR #123", "type": "pr"}'
```

### DELETE /api/tasks/:id/links/:linkId
Remove a link from a task.
```bash
curl -X DELETE http://localhost:3001/api/tasks/ABC123XYZ/links/LINKID
```

**Link Types:**
- `"pr"` - Pull request link
- `"attachment"` - Document or file attachment  
- `"reference"` - External reference or resource

## Worker Management

### GET /api/worker/status
Get current worker status and configuration.
```bash
curl http://localhost:3001/api/worker/status
```

### POST /api/worker/toggle
Enable or disable the worker.
```bash
curl -X POST http://localhost:3001/api/worker/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

### PUT /api/worker/interval
Update worker cron interval.
```bash
curl -X PUT http://localhost:3001/api/worker/interval \
  -H "Content-Type: application/json" \
  -d '{"interval": "*/10 * * * *"}'
```

## Personas

### GET /api/personas
Get all available AI personas.
```bash
curl http://localhost:3001/api/personas
```

## GitHub Integration

### GET /api/github/config
Get GitHub configuration.

### PUT /api/github/config
Update GitHub configuration.

### GET /api/github/auth
Check GitHub authentication status.

### POST /api/github/pr
Create a pull request from a task.

### GET /api/github/pr/:repo/:number
Get PR status (replace `/` in repo with `--`, e.g., `owner--repo`).

### GET /api/github/prs/:repo
Get all PRs for a repository.

### GET /api/github/issues/:repo
Get all issues for a repository.

### POST /api/github/sync/:taskId
Sync task with its linked PRs.

### GET /api/github/task/:taskId
Get GitHub data for a specific task.

## Common Task Workflow

1. **GET /api/tasks** to find tasks assigned to you
2. **PUT /api/tasks/:id** to move status to `"in-progress"`
3. Do the actual work described in the task
4. **POST /api/tasks/:id/comments** with detailed summary of work done
5. If code changes: create PR and **POST /api/tasks/:id/links** with PR URL
6. If non-code work: **PUT /api/tasks/:id** status to `"review"`

## Task Fields

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'in-progress' | 'review' | 'done';
  priority: number; // Higher number = higher priority
  assignee?: string; // Email or name
  persona?: string; // AI persona type
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  estimate?: string;
  repo?: string; // GitHub repo (owner/repo format)
  branch?: string; // Git branch name
  comments?: Comment[];
  links?: Link[];
}
```

## Error Responses

All endpoints return appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad request (missing required fields)
- `404` - Resource not found
- `500` - Internal server error

Error responses include `{"error": "description"}` body.