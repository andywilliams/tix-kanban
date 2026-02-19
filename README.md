# Tix Kanban 🤖

A localhost kanban board with AI-powered task processing. Create tasks, assign them to AI personas, and watch Claude Code work through your backlog automatically.

## Quick Start

```bash
git clone https://github.com/andywilliams/tix-kanban.git
cd tix-kanban
npm install
npm run dev
```

- **Frontend:** http://localhost:3000
- **API:** http://localhost:3001

## How It Works

1. **Create a task** — give it a title, description, and assign a persona
2. **Worker picks it up** — the built-in cron checks for backlog tasks every 5–10 minutes
3. **Claude does the work** — spawns a Claude Code session with the persona's prompt + task context
4. **Result posted** — Claude's output is added as a comment, task moves to Review
5. **You review** — approve, request changes, or move to Done

## Automated Standups 🌅

Tix-Kanban automatically generates daily standups by scanning your:

- **Git commits** from local repositories
- **GitHub PR/issue activity** via `gh` CLI
- **What you did yesterday** → generated from actual activity
- **What you're doing today** → based on current in-progress tasks
- **Blockers** → stale PRs, review dependencies, etc.

### Configuration

- **Default schedule:** 9 AM, Monday-Friday (`0 9 * * 1-5`)
- **API Controls:**
  - `POST /api/worker/standup/toggle` — enable/disable
  - `PUT /api/worker/standup/time` — change schedule (cron expression)
  - `POST /api/worker/standup/trigger` — manual generation
- **View standups:** `GET /api/standup/all`

Instead of manually writing "what I did yesterday," your standup is auto-generated from actual development activity. Perfect for daily standups and progress tracking!

## Personas

Personas are markdown files in `~/.tix-kanban/personas/`. Each one defines an AI personality and system prompt.

### Default Personas

| Persona | Emoji | Use For |
|---------|-------|---------|
| Tech Writer | 📝 | Documentation, READMEs, guides |
| Bug Fixer | 🐛 | Debugging, error investigation |
| QA Engineer | 🔍 | Testing, quality assurance, code reviews with lgtm |
| Security Reviewer | 🔒 | Security audits, vulnerability checks |
| General Developer | 💻 | Full-stack coding tasks |
| Code Reviewer | 🔍 | PR reviews using lgtm tool for thorough analysis |

### Creating Custom Personas

Create a markdown file in `~/.tix-kanban/personas/`:

```markdown
# ~/.tix-kanban/personas/my-persona.md

---
name: My Custom Persona
emoji: 🎨
---

You are a frontend design specialist. You focus on:
- Clean, accessible UI components
- Responsive layouts
- CSS best practices
- User experience improvements

When working on tasks, provide concrete code examples and explain your design decisions.
```

The persona ID is the filename without `.md` (e.g., `my-persona`).

## Features

### Kanban Board
- **4 columns:** Backlog → In Progress → Review → Done
- **Drag and drop** tasks between columns
- **Filter** by persona, status, or tags
- **Dark/light mode** toggle

### AI Worker
- Built-in cron that processes backlog tasks automatically
- Spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions
- Each task gets the assigned persona's prompt as context
- Adaptive scheduling: runs more frequently when there's more work
- Worker status panel shows interval, last run, and workload

### Task Management
- **Comments** — add notes, see AI work output
- **Links** — attach PRs, docs, or references
- **Priority** — higher number = higher priority (processed first)
- **Tags** — organise tasks by category

### GitHub Integration
- Configure repos via the GitHub settings modal
- Link tasks to PRs
- View PR status (checks, reviews, merge state)

### LGTM Code Review Integration
- **Automated PR reviews** using the `lgtm` tool
- **Dedicated personas** for code review tasks (Code Reviewer, QA Engineer)
- **Smart detection** of review tasks based on PR links and keywords
- **Comprehensive analysis** covering security, quality, and best practices
- See [docs/lgtm-integration.md](./docs/lgtm-integration.md) for detailed setup

## Prerequisites

- **Node.js** 18+
- **Claude Code CLI** — install via `npm install -g @anthropic-ai/claude-code`
- **GitHub CLI** (optional) — for PR creation and status checks
- **lgtm** (optional) — for automated code reviews, install via `npm install -g lgtm`

## Configuration

### Storage

All data is stored locally in `~/.tix-kanban/`:

```
~/.tix-kanban/
├── tasks/              # Individual task JSON files
├── personas/           # Persona prompt markdown files
├── worker-state.json   # Worker cron state
├── github-config.json  # GitHub integration settings
└── _summary.json       # Task summary cache
```

### Worker Settings

The worker can be started/stopped from the UI. Configuration is in the worker status panel:

- **Interval** — how often the worker checks for tasks (adaptive based on workload)
- **Start/Stop** — toggle the worker on and off

### Environment

The worker inherits your shell environment, so Claude Code and `gh` CLI should be available in your PATH.

## API Reference

The full API reference is in [API-REFERENCE.md](./API-REFERENCE.md). Key endpoints:

```bash
# List all tasks
GET /api/tasks

# Create a task
POST /api/tasks
{"title": "...", "description": "...", "status": "backlog", "persona": "tech-writer", "priority": 100}

# Update a task
PUT /api/tasks/:id
{"status": "in-progress"}

# Add a comment
POST /api/tasks/:id/comments
{"body": "...", "author": "..."}

# Add a link
POST /api/tasks/:id/links
{"url": "...", "title": "...", "type": "pr"}

# Worker status
GET /api/worker/status

# List personas
GET /api/personas
```

## Development

```bash
# Dev mode (client + server with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type check
npm run type-check
```

### Architecture

- **Frontend:** React + TypeScript + Vite (port 3000)
- **Backend:** Express.js + TypeScript (port 3001)
- **Storage:** JSON files in `~/.tix-kanban/`
- **Worker:** node-cron scheduler spawning Claude Code CLI
- **Styling:** CSS custom properties with dark/light themes

Vite proxies `/api` calls to the Express server in development.

## Roadmap

- [ ] Notion integration (sync tasks from Notion boards)
- [ ] Slack integration (post updates to channels)
- [ ] Real-time updates (WebSocket instead of polling)
- [ ] Custom persona creation from the UI
- [ ] Time tracking per task
- [ ] Task templates

## License

MIT
