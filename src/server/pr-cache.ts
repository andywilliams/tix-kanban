/**
 * PR Cache — In-memory cache with non-blocking background refresh
 * 
 * Uses a detached child process for GitHub API calls so they never
 * block the main server's HTTP responses.
 */

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

interface CachedPR {
  number: number;
  title: string;
  state: string;
  author?: string;
}

interface PRCacheEntry {
  repo: string;
  prs: CachedPR[];
  fetchedAt: number;
}

// Cache state
const prCache: Map<string, PRCacheEntry> = new Map();
let lastFullRefresh = 0;
let refreshInProgress = false;
let initialLoadDone = false;
let initialLoadResolvers: Array<() => void> = [];

// Config
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;
const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Fetch PRs for a single repo using gh CLI — runs in background
 */
async function fetchRepoPRs(repo: string): Promise<CachedPR[]> {
  try {
    const { stdout } = await exec(
      `gh pr list --repo ${repo} --state open --json number,title,state,author --jq '.[] | {number, title, state, author: .author.login}'`,
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    
    if (!stdout.trim()) return [];
    
    // Parse JSONL output (one object per line)
    return stdout.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          const pr = JSON.parse(line);
          return {
            number: pr.number,
            title: pr.title,
            state: pr.state || 'open',
            author: pr.author
          };
        } catch {
          return null;
        }
      })
      .filter((pr): pr is CachedPR => pr !== null);
  } catch (err) {
    console.warn(`PR cache: failed to fetch ${repo}:`, (err as Error).message?.substring(0, 100));
    return [];
  }
}

/**
 * Background refresh — fetches all repos without blocking
 */
async function doRefresh(): Promise<void> {
  if (refreshInProgress) return;
  
  const now = Date.now();
  if (now - lastFullRefresh < MIN_REFRESH_INTERVAL_MS) return;
  
  refreshInProgress = true;
  
  try {
    // Get configured repos
    let repos: string[] = [];
    try {
      const { stdout } = await exec(
        `gh repo list --json nameWithOwner --jq '.[].nameWithOwner' 2>/dev/null || echo ""`,
        { timeout: 10000 }
      );
      // Fall back to reading from tix-kanban's github config
      const configPath = `${process.env.HOME || '~'}/.tix-kanban/github-config.json`;
      const { stdout: configData } = await exec(`cat "${configPath}" 2>/dev/null || echo "{}"`, { timeout: 2000 });
      const config = JSON.parse(configData);
      if (config.repos && Array.isArray(config.repos)) {
        repos = config.repos.map((r: any) => typeof r === 'string' ? r : r.name).filter(Boolean);
      }
    } catch {
      // No config — that's fine
    }
    
    if (repos.length === 0) {
      lastFullRefresh = Date.now();
      return;
    }
    
    // Fetch all repos in parallel (non-blocking since each is async)
    const results = await Promise.allSettled(
      repos.slice(0, 5).map(async (repo) => {
        const prs = await fetchRepoPRs(repo);
        return { repo, prs, fetchedAt: Date.now() } as PRCacheEntry;
      })
    );
    
    // Update cache with successful results
    let totalPRs = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        prCache.set(result.value.repo, result.value);
        totalPRs += result.value.prs.length;
      }
    }
    
    lastFullRefresh = Date.now();
    console.log(`🔄 PR cache refreshed: ${totalPRs} open PRs across ${repos.length} repos`);
    
  } finally {
    refreshInProgress = false;
    
    // Resolve initial load waiters
    if (!initialLoadDone) {
      initialLoadDone = true;
      for (const resolve of initialLoadResolvers) resolve();
      initialLoadResolvers = [];
    }
  }
}

/**
 * Get cached PR context string. Returns instantly from cache.
 * First call waits up to 5s for initial data.
 */
export async function getCachedPRs(): Promise<string> {
  const now = Date.now();
  
  // First call — wait briefly for initial data
  if (!initialLoadDone && prCache.size === 0) {
    doRefresh().catch(() => {});
    await new Promise<void>((resolve) => {
      initialLoadResolvers.push(resolve);
      setTimeout(() => {
        // Timeout — resolve anyway with empty cache
        if (!initialLoadDone) {
          initialLoadDone = true;
          for (const r of initialLoadResolvers) r();
          initialLoadResolvers = [];
        }
      }, 5000);
    });
  } else if (now - lastFullRefresh > CACHE_TTL_MS) {
    // Stale — trigger background refresh, return stale data immediately
    doRefresh().catch(() => {});
  }
  
  if (prCache.size === 0) {
    return 'GitHub not configured or no open PRs.';
  }
  
  const lines: string[] = [];
  for (const [repo, entry] of prCache) {
    if (entry.prs.length > 0) {
      const age = Math.round((now - entry.fetchedAt) / 60000);
      lines.push(`**${repo}** (${entry.prs.length} open${age > 0 ? `, ${age}m ago` : ''}):`);
      for (const pr of entry.prs.slice(0, 10)) {
        lines.push(`  - #${pr.number}: ${pr.title}${pr.author ? ` (by ${pr.author})` : ''}`);
      }
    }
  }
  
  return lines.length > 0 ? lines.join('\n') : 'No open PRs found.';
}

/** Force refresh (non-blocking) */
export function refreshPRCache(): void {
  lastFullRefresh = 0;
  doRefresh().catch(() => {});
}

/** Invalidate cache */
export function invalidatePRCache(repo?: string): void {
  if (repo) prCache.delete(repo); else prCache.clear();
  lastFullRefresh = 0;
}

// Auto-refresh
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function startPRCacheAutoRefresh(): void {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => doRefresh().catch(() => {}), AUTO_REFRESH_INTERVAL_MS);
  doRefresh().catch(() => {}); // Initial population
  console.log('📦 PR cache started (parallel fetch, auto-refresh every 10m)');
}

export function stopPRCacheAutoRefresh(): void {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}
