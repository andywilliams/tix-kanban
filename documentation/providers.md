# CLI Provider Convention

## Overview

Providers in tix-kanban follow a CLI-first architecture. Instead of making direct API calls to external services, providers shell out to CLI tools and parse their JSON output. This approach provides several benefits:

- **Separation of concerns**: Authentication, API complexity, and rate limiting are handled by the CLI tool
- **Reusability**: CLI tools can be used independently and by multiple systems
- **Testability**: Easier to mock and test by stubbing CLI output
- **Flexibility**: Easy to swap implementations without changing the provider interface
- **Maintenance**: CLI tools can be updated independently of the kanban system

## Architecture

### CLITicketProvider Base Class

All CLI-based providers extend `CLITicketProvider`, which provides:

- Standard error handling and timeout management
- JSON parsing of CLI output
- Status normalization to canonical kanban statuses
- Common configuration patterns

### Provider Implementation

A typical provider implementation:

```typescript
import { CLITicketProvider } from './tix-provider.js';

export class MyProvider extends CLITicketProvider {
  name = 'my-provider';
  
  protected getCommand(): string {
    return 'my-cli-tool';
  }
  
  protected getListArgs(): string[] {
    return ['list', '--format=json'];
  }
  
  // Optional: override if CLI output format differs from TicketData
  protected transformTicket(ticket: any): TicketData {
    return {
      id: ticket.id,
      title: ticket.title,
      status: this.normalizeStatus(ticket.status),
      // ... map other fields
    };
  }
}
```

## CLI Tool Requirements

CLI tools integrated with tix-kanban must:

1. **Accept standard flags**:
   - `--json` or `--format=json` to output structured data
   - Exit code 0 on success, non-zero on failure

2. **Output valid JSON to stdout**:
   ```json
   [
     {
       "id": "unique-id",
       "title": "Task title",
       "status": "in-progress",
       "description": "Optional description",
       "priority": 100,
       "assignee": "username",
       "externalId": "external-system-id",
       "externalUrl": "https://external-system.com/item",
       "lastUpdated": "2024-03-13T10:00:00Z"
     }
   ]
   ```

3. **Write errors to stderr**:
   - User-facing error messages go to stderr
   - Stderr is captured and included in error messages

4. **Handle authentication independently**:
   - Providers should not pass API keys or credentials
   - CLI tools manage their own auth (config files, env vars, etc.)

## Status Normalization

The base provider normalizes external statuses to one of four canonical states:

- **backlog**: New, To Do, Backlog
- **in-progress**: In Progress, Doing, Active, Working
- **review**: Review, Testing, Pending, QA
- **done**: Done, Complete, Closed, Shipped

Custom mappings can be implemented by overriding `normalizeStatus()`.

## Error Handling

The `execProvider` utility provides robust error handling:

- **Command not found (ENOENT)**: Clear message about missing CLI tool
- **Timeout (ETIMEDOUT)**: Configurable timeout (default 30s)
- **Invalid JSON**: Parse errors are caught and reported
- **stderr output**: Captured and included in error messages

## Example: Tix Provider

The `tix` provider demonstrates the pattern:

```typescript
export class TixProvider extends CLITicketProvider {
  name = 'tix';
  
  protected getCommand(): string {
    return 'tix';
  }
  
  protected getListArgs(): string[] {
    return ['list', '--json'];
  }
}
```

This shells out to:
```bash
tix list --json
```

And expects output matching the `TicketData` interface.

## Future Providers

The CLI provider pattern enables easy integration with:

- **GitHub**: `gh issue list --json`
- **Linear**: `linear issue list --json`
- **Jira**: `jira issue list --json` (custom wrapper)
- **Custom tools**: Any CLI that can output JSON

## Testing

Mock CLI output by stubbing `execProvider`:

```typescript
import * as cliExec from '../utils/cli-exec.js';

jest.spyOn(cliExec, 'execProvider').mockResolvedValue([
  { id: '1', title: 'Test Task', status: 'backlog' }
]);
```

## Migration from Direct API Calls

To migrate an existing provider:

1. **Create a CLI tool** that wraps the API (see `tix` CLI as example)
2. **Extend CLITicketProvider** instead of implementing TicketProvider directly
3. **Remove direct API dependencies** from package.json
4. **Update configuration** to use CLI tool paths if needed
5. **Test** that `npm run build` succeeds and provider works

## Performance Considerations

- CLI process spawning adds ~10-50ms overhead per call
- For high-frequency syncs, consider batching or caching
- The `maxBuffer` is set to 10MB to handle large datasets
- Timeout is configurable (default 30s)

## Security

- **No credentials in code**: CLI tools handle auth separately
- **Environment isolation**: Each CLI call runs in a clean environment
- **Input validation**: Arguments are passed as array elements (no shell injection)
- **Output sanitization**: JSON parsing prevents code execution
