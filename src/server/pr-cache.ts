/**
 * PR Cache — Lightweight in-memory cache for GitHub PR data
 * 
 * Avoids hitting GitHub API on every chat message.
 * Auto-refreshes periodically and after task completions.
 */

import { getGitHubConfig, getRepoPRs } from './github.js';

interface PRCacheEntry {
  repo: string;
  prs: Array<{
    number: number;
    title: string;
    state: string;
    author?: string;
    url?: string;
  }>;
  fetchedAt: number;
}

// Cache state
let prCache: Map<string, PRCacheEntry> = new Map();
let lastFullRefresh = 0;
let refreshInProgress = false;

// Config
const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 minutes — stale after this
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;  // Don't refresh more than once per 30s
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // Background refresh every 10 min

/**
 * Get cached PR data for all configured repos.
 * Returns immediately from cache if available; triggers background refresh if stale.
 */
export async function getCachedPRs(): Promise<string> {
  const now = Date.now();
  
  // If cache is empty, do a blocking first fetch
  if (prCache.size === 0) {
    await refreshPRCache();
  } else if (now - lastFullRefresh > CACHE_TTL_MS) {
    // Cache is stale — trigger background refresh but return stale data now
    refreshPRCache().catch(err => console.error('Background PR refresh failed:', err));
  }
  
  // Build context string from cache
  if (prCache.size === 0) {
    return 'GitHub not configured or no repos set up.';
  }
  
  const lines: string[] = [];
  for (const [repo, entry] of prCache) {
    if (entry.prs.length > 0) {
      const age = Math.round((now - entry.fetchedAt) / 60000);
      lines.push(`**${repo}** (${entry.prs.length} open, updated ${age}m ago):`);
      for (const pr of entry.prs.slice(0, 10)) {
        lines.push(`  - #${pr.number}: ${pr.title}${pr.author ? ` (by ${pr.author})` : ''}`);
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : 'No open PRs found.';
}

/**
 * Force a cache refresh — call after task completion, PR creation, etc.
 */
export async function refreshPRCache(): Promise<void> {
  const now = Date.now();
  
  // Debounce — don't refresh too frequently
  if (refreshInProgress || (now - lastFullRefresh < MIN_REFRESH_INTERVAL_MS)) {
    return;
  }
  
  refreshInProgress = true;
  
  try {
    const ghConfig = await getGitHubConfig();
    if (!ghConfig.repos || ghConfig.repos.length === 0) return;
    
    for (const repo of ghConfig.repos.slice(0, 5)) {
      const repoName = typeof repo === 'string' ? repo : repo.name;
      try {
        const prs = await getRepoPRs(repoName, 'open');
        prCache.set(repoName, {
          repo: repoName,
          prs: prs.map(pr => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            author: pr.author,
            url: pr.url
          })),
          fetchedAt: Date.now()
        });
      } catch (err) {
        // Keep stale data if refresh fails for a repo
        console.warn(`PR cache refresh failed for ${repoName}:`, err);
      }
    }
    
    lastFullRefresh = Date.now();
    const totalPRs = Array.from(prCache.values()).reduce((sum, e) => sum + e.prs.length, 0);
    console.log(`🔄 PR cache refreshed: ${totalPRs} open PRs across ${prCache.size} repos`);
  } finally {
    refreshInProgress = false;
  }
}

/**
 * Invalidate cache for a specific repo (e.g., after creating a PR)
 */
export function invalidatePRCache(repo?: string): void {
  if (repo) {
    prCache.delete(repo);
  } else {
    prCache.clear();
  }
  lastFullRefresh = 0; // Force next getCachedPRs to refresh
}

// Start background auto-refresh
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function startPRCacheAutoRefresh(): void {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    refreshPRCache().catch(err => console.error('PR auto-refresh error:', err));
  }, AUTO_REFRESH_INTERVAL_MS);
  
  // Initial population
  refreshPRCache().catch(() => {});
  console.log('📦 PR cache auto-refresh started (every 10m)');
}

export function stopPRCacheAutoRefresh(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}
