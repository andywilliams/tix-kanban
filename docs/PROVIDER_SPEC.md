# Forge Provider Interface Specification

Version: 1.0  
Last Updated: 2026-03-13

## Overview

This document defines the standard contract that all Forge CLI providers must implement. A **provider** is an external command-line tool that Forge can invoke to fetch data from external systems (tickets, messages, test results, etc.).

Providers enable Forge to integrate with any external system without tight coupling. This specification ensures consistent behavior, error handling, and data formats across all provider implementations.

## Provider Types

Forge supports three provider types:

| Type | Purpose | Examples |
|------|---------|----------|
| `ticket` | Kanban/issue tracking systems | tix (Notion), GitHub Issues, Jira, Linear |
| `message` | Chat/messaging platforms | slx (Slack), Discord, Teams |
| `test-result` | Test/QA results | apix (API tests), Jest, Playwright |

Each provider type has a specific JSON schema (defined below).

## Core Principles

### 1. CLI-Based Interface

A provider is a **command-line executable** that Forge invokes. Providers can be:

- Standalone binaries (`/usr/local/bin/my-provider`)
- Shell scripts (`~/scripts/fetch-tickets.sh`)
- Interpreted scripts (`python3 ~/providers/jira-sync.py`)
- Node.js CLI tools (`npx my-provider`)

The provider path and arguments are configurable in Forge settings.

### 2. JSON Output to stdout

Providers **MUST** write a **JSON array** to stdout containing zero or more items.

**Valid outputs:**

```json
[]
```

```json
[
  {"id": "TICKET-123", "title": "Fix bug", ...},
  {"id": "TICKET-124", "title": "Add feature", ...}
]
```

**Invalid outputs:**
- Plain text
- Single JSON object (must be an array)
- Non-JSON data
- Markdown, CSV, or other formats

### 3. Exit Codes

Providers use standard exit codes to indicate success or failure:

| Exit Code | Meaning | When to Use |
|-----------|---------|-------------|
| 0 | Success | Data fetched successfully (even if empty array) |
| 1 | General error | Unexpected failures, invalid config, network errors |
| 2 | Authentication failure | Missing/invalid credentials, expired tokens |
| 3 | Timeout | Operation exceeded time limit |

Forge will capture the exit code and handle failures appropriately.

### 4. Error Reporting via stderr

When a provider exits with non-zero code, it **SHOULD** write a JSON error object to stderr:

```json
{"error": "Failed to authenticate with API", "code": "auth-failure"}
```

**Error object fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | string | Yes | Human-readable error message |
| `code` | string | No | Machine-readable error code (e.g., `auth-failure`, `network-timeout`) |
| `details` | object | No | Additional context (stack trace, request ID, etc.) |

If the provider writes plain text to stderr, Forge will capture it as an unstructured error message.

### 5. Configuration

Providers are configured via:

- **Environment variables** (recommended for secrets)
- **CLI flags** (recommended for runtime options)
- **Config files** (provider-specific)

Forge passes configuration through environment variables and command-line arguments when invoking the provider.

### 6. Timeout Handling

Forge enforces a timeout on provider execution (default: 30 seconds, configurable). If the provider doesn't complete within the timeout:

1. Forge sends SIGTERM to the provider process
2. After 5 seconds, Forge sends SIGKILL if still running
3. The sync is marked as failed with exit code 3 (timeout)

Providers **SHOULD**:
- Handle SIGTERM gracefully and clean up resources
- Implement their own internal timeouts for network requests
- Fail fast when data sources are unreachable

## Standard Flags

All providers **SHOULD** support these common flags:

| Flag | Type | Description | Example |
|------|------|-------------|---------|
| `--json` | boolean | Enable machine-readable JSON output (vs. human-friendly) | `--json` |
| `--limit N` | integer | Maximum number of items to return | `--limit 50` |
| `--since DATE` | ISO 8601 | Only return items updated after this date | `--since 2026-03-01T00:00:00Z` |
| `--filter STATUS` | string | Filter by status/state | `--filter open` |
| `--cursor TOKEN` | string | Pagination cursor for fetching next page | `--cursor eyJwYWdlIjoyfQ==` |

Providers **MAY** define additional flags specific to their data source.

## Provider Type Schemas

### Ticket Provider

Ticket providers return an array of ticket objects. Each ticket represents an issue, task, or work item.

**JSON Schema:**

```json
{
  "id": "string",
  "ticketNumber": "string",
  "title": "string",
  "status": "string",
  "priority": "string",
  "assignee": "string",
  "labels": ["string"],
  "url": "string",
  "githubLinks": ["string"],
  "lastUpdated": "ISO-8601"
}
```

**Field Definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (stable across syncs) |
| `ticketNumber` | string | No | Human-readable ticket number (e.g., "PROJ-123") |
| `title` | string | Yes | Ticket title/summary |
| `status` | string | Yes | Current status (e.g., "open", "in-progress", "done") |
| `priority` | string | No | Priority level (e.g., "high", "medium", "low") |
| `assignee` | string | No | Username or email of assignee |
| `labels` | array | No | Tags/labels associated with the ticket |
| `url` | string | No | URL to view the ticket in the source system |
| `githubLinks` | array | No | Associated GitHub PR/issue URLs |
| `lastUpdated` | string | No | ISO 8601 timestamp of last update |

**Example:**

```json
[
  {
    "id": "notion-abc123",
    "ticketNumber": "FORGE-42",
    "title": "Add dark mode to settings page",
    "status": "in-progress",
    "priority": "high",
    "assignee": "developer@example.com",
    "labels": ["ui", "enhancement"],
    "url": "https://notion.so/abc123",
    "githubLinks": ["https://github.com/org/repo/pull/123"],
    "lastUpdated": "2026-03-13T10:00:00Z"
  }
]
```

### Message Provider

Message providers return an array of messages from chat/messaging platforms.

**JSON Schema:**

```json
{
  "id": "string",
  "channel": "string",
  "channelId": "string",
  "author": "string",
  "text": "string",
  "timestamp": "ISO-8601",
  "threadTs": "string",
  "replies": [],
  "reactions": [],
  "url": "string"
}
```

**Field Definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique message identifier |
| `channel` | string | Yes | Human-readable channel name |
| `channelId` | string | No | Platform-specific channel ID |
| `author` | string | Yes | Username or display name of author |
| `text` | string | Yes | Message content (plain text or markdown) |
| `timestamp` | string | Yes | ISO 8601 timestamp when message was sent |
| `threadTs` | string | No | Parent message timestamp (for threaded replies) |
| `replies` | array | No | Array of reply message IDs |
| `reactions` | array | No | Array of reaction objects (emoji, count) |
| `url` | string | No | Permalink to the message |

**Example:**

```json
[
  {
    "id": "slack-1234567890.123456",
    "channel": "engineering",
    "channelId": "C01ABC123",
    "author": "jdoe",
    "text": "The deploy is complete!",
    "timestamp": "2026-03-13T09:30:00Z",
    "threadTs": null,
    "replies": [],
    "reactions": [{"emoji": "🎉", "count": 3}],
    "url": "https://workspace.slack.com/archives/C01ABC123/p1234567890123456"
  }
]
```

### Test Result Provider

Test result providers return an array of test suite execution results.

**JSON Schema:**

```json
{
  "id": "string",
  "suite": "string",
  "ticketId": "string",
  "runAt": "ISO-8601",
  "passed": "number",
  "failed": "number",
  "total": "number",
  "status": "passing|failing",
  "failures": [{"test": "string", "expected": "any", "actual": "any", "error": "string"}]
}
```

**Field Definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique test run identifier |
| `suite` | string | Yes | Test suite name (e.g., "API Integration Tests") |
| `ticketId` | string | No | Associated ticket/PR identifier |
| `runAt` | string | Yes | ISO 8601 timestamp of test execution |
| `passed` | number | Yes | Number of passing tests |
| `failed` | number | Yes | Number of failing tests |
| `total` | number | Yes | Total number of tests run |
| `status` | string | Yes | Overall status: "passing" or "failing" |
| `failures` | array | No | Array of failure details (if any) |

**Failure Object Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `test` | string | Yes | Name of the failing test |
| `expected` | any | No | Expected value |
| `actual` | any | No | Actual value received |
| `error` | string | No | Error message or stack trace |

**Example:**

```json
[
  {
    "id": "run-2026-03-13-001",
    "suite": "API Integration Tests",
    "ticketId": "FORGE-42",
    "runAt": "2026-03-13T10:15:00Z",
    "passed": 47,
    "failed": 3,
    "total": 50,
    "status": "failing",
    "failures": [
      {
        "test": "POST /api/tasks returns 201",
        "expected": 201,
        "actual": 500,
        "error": "Internal Server Error: Database connection failed"
      }
    ]
  }
]
```

## Provider Implementation Checklist

When building a new provider, ensure it:

- [ ] Outputs a valid JSON array to stdout
- [ ] Uses exit code 0 for success, 1/2/3 for failures
- [ ] Writes structured errors to stderr as JSON
- [ ] Supports `--json` flag for machine-readable output
- [ ] Supports `--limit` for controlling result size
- [ ] Supports `--since` for incremental sync
- [ ] Implements timeout handling (SIGTERM cleanup)
- [ ] Documents all custom flags and environment variables
- [ ] Validates output against the schema for its type
- [ ] Handles network failures gracefully (retries, backoff)
- [ ] Includes usage/help text (`--help`)

## Validation

Forge provides a validation utility to test provider compliance:

```bash
# Validate a provider
npm run validate-provider -- --type ticket --command "tix sync --json"

# Expected output:
# ✓ Provider executable
# ✓ Returns valid JSON array
# ✓ Exit code 0 on success
# ✓ Items match ticket schema
# ✓ All required fields present
```

See the validation utility source in `scripts/validate-provider.js`.

## Security Considerations

### Credentials

Providers **MUST NOT**:
- Hard-code API keys or tokens
- Log sensitive credentials
- Write credentials to stdout/stderr

Providers **SHOULD**:
- Accept credentials via environment variables
- Support credential files with restricted permissions (0600)
- Use secure credential stores (OS keychain, secret managers)

### Input Validation

Providers **SHOULD**:
- Validate all command-line arguments
- Sanitize inputs before passing to external APIs
- Reject unexpected/malformed data

### Error Messages

Error messages **SHOULD NOT** include:
- API tokens or passwords
- Full URLs with embedded credentials
- Personal identifiable information (PII)

## Examples

### Minimal Ticket Provider (Bash)

```bash
#!/usr/bin/env bash
# github-issues-provider.sh

set -euo pipefail

REPO="${GITHUB_REPO:-}"
LIMIT="${1:-50}"

if [[ -z "$REPO" ]]; then
  echo '{"error": "GITHUB_REPO not set", "code": "config-missing"}' >&2
  exit 1
fi

gh issue list --repo "$REPO" --limit "$LIMIT" --json number,title,state,updatedAt \
  | jq 'map({
      id: ("gh-" + (.number | tostring)),
      ticketNumber: (.number | tostring),
      title: .title,
      status: (if .state == "OPEN" then "open" else "done" end),
      url: "https://github.com/\(env.REPO)/issues/\(.number)",
      lastUpdated: .updatedAt
    })'
```

### Minimal Message Provider (Python)

```python
#!/usr/bin/env python3
# slack-provider.py

import json
import sys
import os
from slack_sdk import WebClient
from datetime import datetime

def main():
    token = os.environ.get('SLACK_TOKEN')
    if not token:
        error = {"error": "SLACK_TOKEN not set", "code": "auth-failure"}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(2)
    
    client = WebClient(token=token)
    
    try:
        response = client.conversations_history(channel="C01ABC123", limit=100)
        messages = []
        
        for msg in response['messages']:
            messages.append({
                "id": f"slack-{msg['ts']}",
                "channel": "general",
                "channelId": "C01ABC123",
                "author": msg.get('user', 'unknown'),
                "text": msg.get('text', ''),
                "timestamp": datetime.fromtimestamp(float(msg['ts'])).isoformat() + 'Z',
                "reactions": msg.get('reactions', [])
            })
        
        print(json.dumps(messages))
    except Exception as e:
        error = {"error": str(e), "code": "api-error"}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
```

## Versioning

This specification follows semantic versioning. Breaking changes to schemas or behavior will increment the major version.

**Current version: 1.0**

Providers **MAY** include a `--spec-version` flag to indicate which version of this spec they implement.

## Contributing

Provider spec improvements and additions should be proposed via GitHub issues or pull requests. All changes require:

1. Clear rationale and use cases
2. Backward compatibility analysis
3. Updated examples
4. Validation script updates (if schemas change)

---

**Specification Maintainer:** Forge Core Team  
**License:** MIT
