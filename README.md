# tix-kanban

A local, lightweight kanban board with built-in AI worker integration. Perfect for solo developers who want to manage tasks locally with optional AI assistance.

## Vision

**Simple Task Management + AI Workers = Productivity**

- 📋 **File-based storage** — Your tasks live in `~/.tix-kanban/` as JSON files
- 🤖 **AI personas** — Assign tasks to specialized AI workers (QA, Security, Tech Writer, etc.)
- ⚡ **Single-process deployment** — Express serves React SPA from one process
- 🔄 **Built-in cron** — Workers pick up tasks automatically
- 🚀 **Zero configuration** — Works out of the box

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React SPA     │◄───┤   Express API    │◄───┤  File Storage   │
│  (Vite build)   │    │  /api/tasks      │    │  ~/.tix-kanban/ │
└─────────────────┘    │  /api/board      │    └─────────────────┘
                       │  /api/personas   │    
                       └──────────────────┘    
                                ▲               
                       ┌────────┴────────┐    
                       │   Cron Worker   │    
                       │ (Claude CLI)    │    
                       └─────────────────┘    
```

## Quick Start

```bash
# Install dependencies
npm install

# Development (React on :3001, API on :3000)
npm run dev

# Production build & start
npm run build
npm start
```

## Task Storage

Tasks are stored as individual JSON files in `~/.tix-kanban/tasks/`:

- `_summary.json` — Fast list view (like tix pattern)
- `{taskId}.json` — Full task details with comments/links
- Atomic writes using tmp file + rename
- No database required!

## AI Workers

AI workers are defined in `personas/` directory as markdown files:

```markdown
---
name: "QA Engineer"
emoji: "🧪"
description: "Focuses on testing and quality"
---

You are a QA Engineer focused on quality and testing.

When reviewing tasks:
- Look for edge cases and potential bugs
- Suggest test scenarios...
```

The cron system picks up tasks assigned to AI workers and spawns Claude CLI sessions with the appropriate persona context.

## Status Flow

```
Backlog → In Progress → Review → Done
```

- **Backlog**: New tasks, ready to be picked up
- **In Progress**: Being worked on (human or AI)  
- **Review**: Completed, needs review/testing
- **Done**: Finished and verified

## Development

```bash
# Watch both client and server
npm run dev

# Type check everything
npm run type-check

# Build for production
npm run build
```

## Configuration

The cron worker runs every 30 minutes by default. Configure via the web UI at `/cron` or by calling the API:

```bash
curl -X PUT http://localhost:3000/api/cron/settings \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "interval": "*/15 * * * *"}'
```

## GitHub Integration

When AI workers complete code tasks, they can automatically:
- Create a branch
- Commit changes
- Open a pull request
- Link the PR back to the task

Requires `gh` CLI to be installed and authenticated.

## Why tix-kanban?

- **Local-first**: Your tasks stay on your machine
- **Lightweight**: No heavy database, just JSON files
- **AI-ready**: Built-in persona system for AI workers
- **Self-contained**: Single process, easy to run anywhere
- **Hackable**: Simple codebase, easy to modify

Perfect for solo developers, small teams, or anyone who wants a kanban board that works with AI without the complexity of hosted solutions.