# GitHub Rate Limit Handling

This document explains how tix-kanban handles GitHub API rate limits to ensure reliable operation even with heavy GitHub integration.

## Problem

GitHub's API has rate limits that can be exceeded when:
- Workers perform research on repositories with many PRs/issues
- Multiple operations happen concurrently
- Background jobs check PR status frequently
- Users have extensive GitHub workflows

## Solution

### 1. Rate Limit Awareness

Before making GitHub API calls, the system:
- Checks current rate limit status using `gh api rate_limit`
- Determines if enough requests remain for the operation
- Warns or delays operations when rate limits are low
- Caches rate limit info to reduce overhead

### 2. Local Git Alternatives

When possible, the system prefers local git commands over GitHub API:

**Instead of GitHub API:**
- `gh api repos/owner/repo/commits` → `git log`
- `gh api repos/owner/repo/branches` → `git branch`
- `gh api repos/owner/repo/contents/file` → Read local file
- `gh api repos/owner/repo/compare/...` → `git diff`

**GitHub API only when necessary:**
- Creating PRs (`gh pr create`)
- Checking CI status (`gh pr view --json statusCheckRollup`)
- Getting review status (`gh api repos/owner/repo/pulls/N/reviews`)

### 3. Exponential Backoff

When rate limits are hit:
- First retry: wait 30 seconds
- Second retry: wait 60 seconds  
- Third retry: wait 120 seconds
- After 3 retries: fail with clear error message

### 4. Response Caching

API responses are cached to reduce redundant calls:
- **PR status**: cached for 2 minutes
- **Repository PRs/issues**: cached for 5 minutes
- **Auth status**: cached for 10 minutes
- **Rate limit info**: cached for 1 minute

Cache is stored both in-memory and on disk for persistence.

### 5. Batch Operations

When fetching multiple items:
- Check available rate limit first
- Limit batch size if rate limit is insufficient
- Process in smaller chunks (5 items at a time)
- Add delays between batches

### 6. Worker Guidance

AI workers are instructed to:
- Prefer local git operations for research
- Use GitHub API only when necessary
- Fall back to local alternatives on rate limit errors

## Implementation

### Key Files

- `src/server/github-rate-limit.ts` - Core rate limiting utilities
- `src/server/github.ts` - Updated GitHub functions with rate limiting
- `src/server/worker.ts` - Worker prompt updates and cache cleanup

### Core Functions

```typescript
// Check if we have enough rate limit for an operation
await checkRateLimit(requiredRequests, 'core');

// Execute with automatic retry and backoff
await executeWithRateLimit(operation, 'operationName', requestCount);

// Cache responses to reduce API calls
await getCachedResponse(cacheKey, operation, cacheTtlMs);

// Get local alternatives to GitHub API
await getLocalRepoActivity(repoPath, days);
await getLocalFileHistory(repoPath, filePath);
```

### Configuration

Cache directory: `~/.tix-kanban/cache/`
- Rate limit cache: `github-rate-limit.json`
- Response cache: `operation-name.json` files

## Monitoring

The system logs:
- Rate limit status before major operations
- Cache hits/misses
- Rate limit warnings and backoff delays
- Fallback to local operations

## Best Practices

### For Developers

1. **Always use `executeWithRateLimit()`** for GitHub API calls
2. **Cache responses** with appropriate TTL
3. **Prefer local git** commands when possible
4. **Batch operations** rather than individual calls

### For AI Workers

1. **Start with local git commands** for exploration
2. **Use GitHub API sparingly** - only for PRs, CI, reviews
3. **On rate limit errors** - fall back to local alternatives
4. **Don't retry manually** - the system handles retries automatically

## Example Usage

```typescript
// Good: Rate limit aware PR creation
const pr = await createTaskPR(repo, taskId, title, description);

// Good: Local repository exploration
const activity = await getLocalRepoActivity('./repo', 7);
const history = await getLocalFileHistory('./repo', 'src/file.ts');

// Good: Cached GitHub operations  
const prs = await getRepoPRs(repo, 'open'); // Automatically cached

// Bad: Direct gh CLI calls without rate limiting
exec('gh pr list --repo owner/repo'); // Don't do this
```

## Troubleshooting

### "GitHub API rate limit exceeded"
- Wait for the reset time shown in the error
- Use local git alternatives for exploration
- Reduce concurrent GitHub operations

### "Cache directory permissions"
- Ensure `~/.tix-kanban/cache/` is writable
- Check disk space availability

### "gh CLI not authenticated"
- Run `gh auth login` to authenticate
- Check with `gh auth status`

## Future Improvements

- [ ] GraphQL batching for related queries
- [ ] Webhook integration to reduce polling
- [ ] Smart cache invalidation based on repository changes
- [ ] Rate limit pooling across multiple tokens