# Forge

A localhost kanban board with AI-powered task processing. Create tasks, assign them to AI personas, and watch Claude Code work through your backlog automatically.

## Table of Contents

- [Setup from Scratch](#setup-from-scratch)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Integrations](#integrations)
- [Personas](#personas)
- [Features](#features)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Development](#development)

---

## Setup from Scratch

This section walks through everything you need to get Forge running on a fresh machine.

### 1. Prerequisites

#### Node.js 18+

```bash
# Check your version
node --version

# Install via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 18
nvm use 18

# Or via Homebrew (macOS)
brew install node@18
```

#### Claude Code CLI (required)

The AI worker and persona chat system both spawn Claude Code to process tasks and generate responses.

```bash
npm install -g @anthropic-ai/claude-code
```

After installing, authenticate by running `claude` once — it will walk you through Anthropic API key setup. Verify it works:

```bash
claude -p "Say hello"
```

#### GitHub CLI (required for PR/GitHub features)

Used for PR creation, status checks, code review, and repository management.

```bash
# macOS
brew install gh

# Linux
sudo apt install gh   # Debian/Ubuntu
sudo dnf install gh   # Fedora

# Then authenticate
gh auth login
```

Follow the interactive prompts to log in via browser. Choose HTTPS and authenticate with your GitHub account.

Verify:

```bash
gh auth status
```

> **Note:** If you have a `GITHUB_TOKEN` environment variable set, `gh` will use that instead of its own credentials. To use `gh auth login` interactively, first run `unset GITHUB_TOKEN` and remove the export from your shell profile.

### 2. Clone and Install

```bash
git clone https://github.com/andywilliams/forge.git
cd forge
npm install
```

### 3. Run

```bash
# Development (hot reload on both client and server)
npm run dev

# Or build and run production
npm run build
npm start
```

- **Frontend:** http://localhost:3000
- **API:** http://localhost:3001

On first startup, tix-kanban automatically creates its data directory at `~/.tix-kanban/` and initialises default personas, storage, and worker state.

### 4. Configure GitHub Repos

Open the UI at http://localhost:3000 and click the GitHub settings icon. Add the repositories you want Forge to track (in `owner/repo` format). This enables:

- Linking tasks to PRs
- PR status tracking (CI checks, reviews, merge state)
- Automated standup generation from GitHub activity
- PR cache auto-refresh (every 5 minutes)

Config is stored in `~/.tix-kanban/github-config.json`.

### 5. Optional Integrations

These are not required for core functionality but extend what Forge can do.

#### Notion Sync

Sync tasks from a Notion database into your kanban board.

1. Create a [Notion integration](https://www.notion.so/my-integrations) and copy the API key
2. Share your Notion database with the integration
3. Copy the database ID from the Notion URL (the 32-character hex string)
4. In the Forge UI, go to Notion settings and enter:
   - **API Key** — your integration token
   - **Database ID** — the database to sync from
   - **Status Mappings** — map your Notion status values to kanban columns (backlog, in-progress, review, done)
5. Click Sync to pull tasks

Config is stored in `~/.tix-kanban/notion-config.json`.

You can also use the Notion MCP server with Claude Code for richer Notion integration. Add it to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\": \"Bearer YOUR_NOTION_API_KEY\", \"Notion-Version\": \"2022-06-28\"}"
      }
    }
  }
}
```

#### Tix CLI

Tix is a companion developer CLI that bridges Notion tickets and GitHub PRs. It syncs tickets from Notion via Claude Code (no Notion API key needed for basic sync), manages work logs, generates standups, and can push tickets directly to the Forge board.

Tix-kanban reads from the `~/.tix/` directory for activity logs and daily notes, which feed into automated standup generation.

1. Clone and install tix:
   ```bash
   git clone https://github.com/andywilliams/tix.git
   cd tix
   npm install
   npm run build
   npm link
   ```

2. Run the setup wizard:
   ```bash
   tix setup
   ```
   This walks you through configuring your Notion workspace, GitHub repos, and identity.

3. To configure Notion sync specifically for the Forge board:
   ```bash
   tix setup-notion
   ```

**Key tix commands:**

| Command | What It Does |
|---------|-------------|
| `tix sync` | Sync tickets from Notion via Claude CLI |
| `tix kanban-sync` | Push Notion tickets directly to Forge (requires Forge running) |
| `tix status` | Show your assigned Notion tickets |
| `tix work <ticket>` | Implement a ticket with AI — fetches context, creates branch, runs AI, offers PR |
| `tix review <pr>` | AI-powered code review for a GitHub PR |
| `tix log "did X"` | Quick work log entry (read by Forge for standups) |
| `tix standup` | Generate daily standup from git commits and GitHub activity |
| `tix prs` | Show all your open GitHub PRs with ticket IDs |

**Data shared with Forge:**

```
~/.tix/
  logs/       # Activity log entries — Forge reads these for standup generation
  notes/      # Daily notes — displayed in the Forge UI
  tickets/    # Cached Notion ticket data
  _prs.json   # Cached PR-to-ticket mappings
```

Tix-kanban exposes this data via API endpoints (`/api/activity-log`, `/api/daily-notes`) and uses it to generate automated standups.

#### Slack Integration (via SLX)

SLX syncs Slack messages and generates focus digests. It runs as a separate CLI tool that Forge wraps.

1. Install SLX:
   ```bash
   npm install -g slx
   ```

2. Configure SLX:
   ```bash
   slx init
   ```
   This creates `~/.slx/config.json` with your Slack workspace settings.

3. In the Forge UI, go to Slack settings to configure:
   - Which channels to monitor
   - DM sync preferences
   - Auto-sync interval (default: hourly)
   - Digest generation settings

SLX syncs Slack data to `~/.tix-kanban/slack/`. The auto-sync scheduler runs in the background and can be toggled from the UI.

You can also enable the Slack MCP server for Claude Code to read Slack channels directly. This is configured in your Claude Code settings (`.claude/settings.local.json`):

```json
{
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["notion"]
}
```

The Slack MCP is provided by Anthropic's built-in `claude_ai_Slack` server and doesn't require separate installation — just connect your Slack workspace through Claude Code's settings.

#### LGTM Code Reviews

Automated PR review tool used by the Code Reviewer and QA Engineer personas.

```bash
npm install -g lgtm
```

See [docs/lgtm-integration.md](./docs/lgtm-integration.md) for detailed setup and configuration.

### 6. Verify Everything Works

Run through this checklist after setup:

```bash
# Core tools
node --version          # Should be 18+
claude -p "hello"       # Should get a response
gh auth status          # Should show logged in

# Recommended
tix --help              # If using tix for Notion sync and work logs

# Optional tools
slx --version           # If using Slack integration
lgtm --version          # If using code reviews
```

Then open http://localhost:3000 and:

1. Create a test task with title "Hello world test" and assign it to the Developer persona
2. The worker should pick it up within 5-10 minutes (or trigger it manually from the worker panel)
3. Check that Claude processes the task and posts a comment

### Storage Directory Structure

All data is stored locally. Nothing is sent to external services except via the explicit integrations you configure.

```
~/.tix-kanban/
  tasks/                 # Individual task JSON files
  personas/              # Persona definitions and prompts
    {id}.md              # Persona system prompt
    {id}/MEMORY.md       # Persona cross-user learnings
  personas-index.json    # Persona registry
  agent-memories/        # Per-user, per-persona memory
    {personaId}/
      {userId}.json      # Memory entries for this user-persona pair
  souls/                 # Persona personality data (traits, quirks, catchphrases)
    {personaId}.json
  chat/                  # Chat message history
    {channelId}.json     # Active messages
    archives/            # Archived older messages (monthly)
  knowledge/             # Knowledge base articles (markdown + YAML frontmatter)
  reports/               # Generated reports and analyses
  standups/              # Daily standup entries
  cache/                 # GitHub API response cache (2-min TTL)
  slack/                 # Synced Slack data from SLX
  worker-state.json      # Worker cron state and settings
  github-config.json     # GitHub repos and branch settings
  notion-config.json     # Notion API key and status mappings
  user-settings.json     # User preferences
  _summary.json          # Task summary cache

~/.tix/                    # Tix CLI data (shared with Forge)
  logs/                  # Activity log entries (read by Forge for standups)
  notes/                 # Daily notes (displayed in the Forge UI)
  tickets/               # Cached Notion ticket data
  _prs.json              # Cached PR-to-ticket mappings

~/.slx/
  config.json            # SLX Slack configuration (if using Slack integration)
```

### Ports

| Service | Port | Purpose |
|---------|------|---------|
| Vite dev server | 3000 | React frontend (dev mode) |
| Express API | 3001 | REST API + static files (prod) |

In development, Vite proxies `/api` requests to port 3001. In production, Express serves both the API and the built client files.

---

## Quick Start

If you already have Node 18+, Claude Code, and gh installed:

```bash
git clone https://github.com/andywilliams/forge.git
cd forge
npm install
npm run dev
```

Open http://localhost:3000.

---

## How It Works

1. **Create a task** — give it a title, description, and assign a persona
2. **Worker picks it up** — the built-in cron checks for backlog tasks every 5-10 minutes
3. **Claude does the work** — spawns a Claude Code session with the persona's prompt + task context
4. **Result posted** — Claude's output is added as a comment, task moves to Review
5. **You review** — approve, request changes, or move to Done

### AI Persona Chat

You can also chat directly with personas via the chat interface. Mention a persona with `@PersonaName` in any channel, or open a direct conversation. Personas have:

- **Personality** — unique traits, communication style, catchphrases
- **Memory** — remembers your preferences, instructions, and project context across conversations
- **Knowledge** — accesses the knowledge base for relevant articles when responding
- **Team awareness** — knows about other personas and can suggest who to ask
- **Board awareness** — sees relevant tasks, PRs, and project state

### Automated Standups

Tix-Kanban automatically generates daily standups by scanning your:

- **Git commits** from local repositories
- **GitHub PR/issue activity** via `gh` CLI
- **What you did yesterday** — generated from actual activity
- **What you're doing today** — based on current in-progress tasks
- **Blockers** — stale PRs, review dependencies, etc.

**Default schedule:** 9 AM, Monday-Friday (`0 9 * * 1-5`)

**API Controls:**
- `POST /api/worker/standup/toggle` — enable/disable
- `PUT /api/worker/standup/time` — change schedule (cron expression)
- `POST /api/worker/standup/trigger` — manual generation
- `GET /api/standup/all` — view all standups

---

## Integrations

| Integration | Required | What It Does |
|------------|----------|-------------|
| Claude Code CLI | Yes | Powers AI task processing and persona chat |
| GitHub CLI (`gh`) | Recommended | PR tracking, code review, standup generation |
| Tix CLI | Recommended | Notion ticket sync, work logs, standups, AI-powered ticket implementation |
| Notion | Optional | Sync tasks from Notion databases (direct API or via tix) |
| Slack (SLX) | Optional | Sync Slack messages, generate focus digests |
| LGTM | Optional | Automated PR code reviews |

See [Setup from Scratch](#5-optional-integrations) for configuration details.

---

## Providers

Providers are the abstraction layer between Forge and external tools. They let you swap out where tickets and messages come from without changing anything else.

### Built-in Providers

| Name | Type | Source |
|------|------|--------|
| `tix` | Ticket | Notion via the tix CLI |
| `slx` | Message | Slack via the slx CLI |

Switch providers in **Settings → Providers**, or via API:

```bash
curl -X PUT http://localhost:3000/api/providers/config \
  -H "Content-Type: application/json" \
  -d '{"ticketProvider": "tix", "messageProvider": "slx"}'
```

### Adding a Custom Provider

**1. Create the provider file** in `src/server/providers/`:

```ts
// src/server/providers/github-issues-provider.ts
import { TicketProvider, TicketData } from './types.js';

class GitHubIssuesProvider implements TicketProvider {
  name = 'github-issues';

  async sync(): Promise<TicketData[]> {
    // Fetch issues from GitHub API and map to TicketData
    const issues = await fetch('https://api.github.com/repos/owner/repo/issues')
      .then(r => r.json());

    return issues.map((issue: any) => ({
      id: `gh-${issue.number}`,
      title: issue.title,
      status: issue.state === 'open' ? 'backlog' : 'done',
      description: issue.body,
      externalId: String(issue.number),
      externalUrl: issue.html_url,
    }));
  }
}

export const githubIssuesProvider = new GitHubIssuesProvider();
```

**2. Register it** in `src/server/providers/index.ts`:

```ts
import { githubIssuesProvider } from './github-issues-provider.js';

const ticketProviders: Map<string, TicketProvider> = new Map([
  ['tix', tixProvider],
  ['github-issues', githubIssuesProvider], // ← add here
]);
```

That's it — it will appear in the Settings dropdown immediately.

### Provider Interface Reference

```ts
interface TicketProvider {
  name: string;
  sync(): Promise<TicketData[]>;         // Pull tickets from external source
  push?(ticket: TicketData): Promise<void>; // Optional: write updates back
  configure?(config: any): Promise<void>;   // Optional: runtime configuration
}

interface MessageProvider {
  name: string;
  sync(): Promise<MessageData[]>;        // Pull messages from external source
  configure?(config: any): Promise<void>;
}
```

---

## Personas

Personas are AI personalities that process tasks and participate in chat. Each has a system prompt, specialties, and a persistent memory.

### Default Personas

| Persona | Emoji | Use For |
|---------|-------|---------|
| Product Manager | PM | Strategic planning, ticket creation, project oversight |
| Developer | Dev | Full-stack coding tasks |
| Tech Writer | TW | Documentation, READMEs, guides |
| Bug Fixer | BF | Debugging, error investigation |
| QA Engineer | QA | Testing, quality assurance |
| Security Reviewer | SR | Security audits, vulnerability checks |
| Code Reviewer | CR | PR reviews using lgtm tool for thorough analysis |
| PR | 📢 | Public Relations specialist for Slack communication and team messaging |

### Creating Custom Personas

Create a markdown file in `~/.tix-kanban/personas/`:

```markdown
# ~/.tix-kanban/personas/my-persona.md

---
name: My Custom Persona
emoji: art
---

You are a frontend design specialist. You focus on:
- Clean, accessible UI components
- Responsive layouts
- CSS best practices
- User experience improvements

When working on tasks, provide concrete code examples and explain your design decisions.
```

The persona ID is the filename without `.md` (e.g., `my-persona`).

---

## Features

### Kanban Board
- **5 columns:** Backlog, In Progress, Auto-Review, Review, Done
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
- **Priority** — lower number = higher priority (100=critical, 500=low)
- **Tags** — organise tasks by category
- **Activity log** — tracks all state changes

### GitHub Integration
- Configure repos via the GitHub settings modal
- Link tasks to PRs
- View PR status (checks, reviews, merge state)
- PR cache with auto-refresh every 5 minutes

### Knowledge Base
- Store project documentation as markdown articles with metadata
- Automatically surfaced to personas when relevant to conversations

### Smart Reminder Rules
- Automated monitoring of board state with configurable rules
- 5 built-in rule templates (stale reviews, stale PRs, backlog overflow, blocked tasks, unresolved comments)
- Create custom rules with flexible conditions and actions
- Slack notifications via `slx` integration
- Cooldown periods to prevent notification spam
- Dry-run mode for testing rules
- History tracking of all triggered reminders
- Searchable by topic, area, repo, and tags

### LGTM Code Review Integration
- **Automated PR reviews** using the `lgtm` tool
- **Dedicated personas** for code review tasks (Code Reviewer, QA Engineer)
- **Smart detection** of review tasks based on PR links and keywords
- **Comprehensive analysis** covering security, quality, and best practices
- See [docs/lgtm-integration.md](./docs/lgtm-integration.md) for detailed setup

---

## Configuration

### Worker Settings

The worker can be started/stopped from the UI. Configuration is in the worker status panel:

- **Interval** — how often the worker checks for tasks (adaptive based on workload)
- **Start/Stop** — toggle the worker on and off

### Reminder Rules Settings

Configure automatic reminders in the Settings page:

- **Enable/Disable** — toggle the reminder check scheduler
- **Schedule** — set cron expression for when to check rules (default: 9 AM weekdays)
- **Manage Rules** — access from Reminder Rules page to enable/disable individual rules
- **Custom Rules** — create rules with conditions for task status, age, priority, PR state, etc.

### Environment

The worker inherits your shell environment, so `claude`, `gh`, and `slx` should be available in your PATH.

The only environment variable is `PORT` (defaults to 3001) for the API server.

---

## API Reference

The full API reference is in [API-REFERENCE.md](./API-REFERENCE.md). Key endpoints:

```bash
# List all tasks
GET /api/tasks

# Create a task
POST /api/tasks
{"title": "...", "description": "...", "status": "backlog", "persona": "developer", "priority": 400}

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

# Chat with a persona
POST /api/chat/:channelId/messages
{"author": "user", "content": "Hey @Developer, can you help with this?"}

# Health check
GET /api/health
```

---

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

---

## License

MIT
