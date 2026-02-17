import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const exec = promisify(execCallback);

const CACHE_DIR = path.join(os.homedir(), '.tix-kanban', 'cache');
const RATE_LIMIT_CACHE_FILE = path.join(CACHE_DIR, 'github-rate-limit.json');

interface RateLimit {
  limit: number;
  remaining: number;
  resetAt: string; // ISO timestamp
  resource: string; // 'core', 'graphql', 'integration_manifest', etc.
}

interface RateLimitResponse {
  resources: {
    core: RateLimit;
    graphql: RateLimit;
    integration_manifest: RateLimit;
    source_import: RateLimit;
    code_scanning_upload: RateLimit;
    actions_runner_registration: RateLimit;
    scim: RateLimit;
  };
  rate: RateLimit; // Alias for resources.core
}

interface CachedResponse {
  data: any;
  cachedAt: string;
  expiresAt: string;
}

// Ensure cache directory exists
async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

// Get current GitHub API rate limits
export async function getCurrentRateLimit(): Promise<RateLimitResponse | null> {
  try {
    const { stdout } = await exec('gh api rate_limit');
    const rateLimit: RateLimitResponse = JSON.parse(stdout);
    
    // Cache the rate limit info
    await ensureCacheDir();
    await fs.writeFile(RATE_LIMIT_CACHE_FILE, JSON.stringify({
      data: rateLimit,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString() // Cache for 1 minute
    }));
    
    return rateLimit;
  } catch (error) {
    console.error('Failed to get GitHub rate limit:', error);
    
    // Try to load from cache if API call failed
    try {
      const cached = await fs.readFile(RATE_LIMIT_CACHE_FILE, 'utf8');
      const cachedData: CachedResponse = JSON.parse(cached);
      if (new Date(cachedData.expiresAt) > new Date()) {
        console.log('Using cached rate limit data');
        return cachedData.data;
      }
    } catch {
      // Cache miss or expired
    }
    
    return null;
  }
}

// Check if we have enough remaining requests for an operation
export async function checkRateLimit(requiredRequests: number = 1, resource: 'core' | 'graphql' = 'core'): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: string;
  waitTime?: number; // seconds to wait if not allowed
}> {
  const rateLimit = await getCurrentRateLimit();
  
  if (!rateLimit) {
    // If we can't get rate limit info, assume we're rate limited
    console.warn('Cannot determine rate limit status - assuming rate limited');
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 3600000).toISOString(), // Assume 1 hour reset
      waitTime: 3600
    };
  }
  
  const limit = rateLimit.resources[resource];
  const allowed = limit.remaining >= requiredRequests;
  
  if (!allowed) {
    const resetTime = new Date(limit.resetAt);
    const now = new Date();
    const waitTime = Math.max(0, Math.ceil((resetTime.getTime() - now.getTime()) / 1000));
    
    console.warn(`GitHub ${resource} rate limit exceeded: ${limit.remaining}/${limit.limit} remaining, resets at ${limit.resetAt}`);
    
    return {
      allowed: false,
      remaining: limit.remaining,
      resetAt: limit.resetAt,
      waitTime
    };
  }
  
  return {
    allowed: true,
    remaining: limit.remaining,
    resetAt: limit.resetAt
  };
}

// Execute GitHub API call with rate limit awareness and retry logic
export async function executeWithRateLimit<T>(
  operation: () => Promise<T>,
  operationName: string,
  requiredRequests: number = 1,
  maxRetries: number = 3
): Promise<T> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    attempt++;
    
    // Check rate limit before making the call
    const rateLimitCheck = await checkRateLimit(requiredRequests);
    
    if (!rateLimitCheck.allowed) {
      if (rateLimitCheck.waitTime && rateLimitCheck.waitTime > 0) {
        const waitMs = Math.min(rateLimitCheck.waitTime * 1000, 300000); // Max 5 minutes
        console.log(`${operationName}: Rate limited, waiting ${Math.ceil(waitMs / 1000)}s before retry (attempt ${attempt}/${maxRetries})`);
        
        if (attempt === maxRetries) {
          throw new Error(`GitHub API rate limit exceeded for ${operationName}. Try again after ${rateLimitCheck.resetAt}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      } else {
        throw new Error(`GitHub API rate limit exceeded for ${operationName}. Remaining: ${rateLimitCheck.remaining}`);
      }
    }
    
    try {
      // Execute the operation
      console.log(`${operationName}: Executing (${rateLimitCheck.remaining} requests remaining)`);
      const result = await operation();
      return result;
    } catch (error: any) {
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      
      // Check if this is a rate limit error
      if (errorMsg.includes('rate limit') || errorMsg.includes('API rate limit exceeded')) {
        console.warn(`${operationName}: Hit rate limit during execution (attempt ${attempt}/${maxRetries})`);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Exponential backoff: 2^attempt * 30 seconds
        const backoffMs = Math.pow(2, attempt) * 30000;
        console.log(`${operationName}: Backing off for ${Math.ceil(backoffMs / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      } else {
        // Not a rate limit error, rethrow immediately
        throw error;
      }
    }
  }
  
  throw new Error(`${operationName}: Max retries (${maxRetries}) exceeded`);
}

// Cache management for API responses
const responseCache = new Map<string, CachedResponse>();

export async function getCachedResponse<T>(
  cacheKey: string,
  operation: () => Promise<T>,
  cacheTtlMs: number = 300000 // 5 minutes default
): Promise<T> {
  const now = new Date();
  
  // Check in-memory cache first
  const cached = responseCache.get(cacheKey);
  if (cached && new Date(cached.expiresAt) > now) {
    console.log(`Cache hit for ${cacheKey}`);
    return cached.data;
  }
  
  // Check file system cache
  try {
    await ensureCacheDir();
    const cacheFilePath = path.join(CACHE_DIR, `${cacheKey.replace(/[\/\\:*?"<>|]/g, '-')}.json`);
    const fileContent = await fs.readFile(cacheFilePath, 'utf8');
    const fileCached: CachedResponse = JSON.parse(fileContent);
    
    if (new Date(fileCached.expiresAt) > now) {
      console.log(`File cache hit for ${cacheKey}`);
      // Update in-memory cache
      responseCache.set(cacheKey, fileCached);
      return fileCached.data;
    }
  } catch {
    // File cache miss or error - continue to fetch fresh data
  }
  
  // Cache miss - fetch fresh data
  console.log(`Cache miss for ${cacheKey} - fetching fresh data`);
  const data = await operation();
  
  const cachedResponse: CachedResponse = {
    data,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + cacheTtlMs).toISOString()
  };
  
  // Update both caches
  responseCache.set(cacheKey, cachedResponse);
  
  try {
    const cacheFilePath = path.join(CACHE_DIR, `${cacheKey.replace(/[\/\\:*?"<>|]/g, '-')}.json`);
    await fs.writeFile(cacheFilePath, JSON.stringify(cachedResponse));
  } catch (error) {
    console.warn(`Failed to write cache file for ${cacheKey}:`, error);
  }
  
  return data;
}

// Clear expired cache entries
export async function clearExpiredCache(): Promise<void> {
  const now = new Date();
  
  // Clear in-memory cache
  for (const [key, cached] of responseCache.entries()) {
    if (new Date(cached.expiresAt) <= now) {
      responseCache.delete(key);
    }
  }
  
  // Clear file system cache
  try {
    await ensureCacheDir();
    const files = await fs.readdir(CACHE_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(CACHE_DIR, file);
        const content = await fs.readFile(filePath, 'utf8');
        const cached: CachedResponse = JSON.parse(content);
        
        if (new Date(cached.expiresAt) <= now) {
          await fs.unlink(filePath);
          console.log(`Cleared expired cache file: ${file}`);
        }
      } catch (error) {
        console.warn(`Failed to process cache file ${file}:`, error);
        // Try to delete malformed cache files
        try {
          await fs.unlink(path.join(CACHE_DIR, file));
        } catch {
          // Ignore deletion errors
        }
      }
    }
  } catch (error) {
    console.warn('Failed to clear file system cache:', error);
  }
}

// Get local git information instead of using GitHub API where possible
export async function getLocalGitInfo(repoPath: string = '.'): Promise<{
  currentBranch: string;
  remoteUrl: string;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
  uncommittedChanges: boolean;
  unpushedCommits: number;
}> {
  try {
    const [
      currentBranch,
      remoteUrl, 
      lastCommitInfo,
      statusOutput,
      unpushedCount
    ] = await Promise.all([
      exec('git branch --show-current', { cwd: repoPath }).then(r => r.stdout.trim()),
      exec('git remote get-url origin', { cwd: repoPath }).then(r => r.stdout.trim()),
      exec('git log -1 --format="%H|%s|%an|%ai"', { cwd: repoPath }).then(r => r.stdout.trim()),
      exec('git status --porcelain', { cwd: repoPath }).then(r => r.stdout.trim()),
      exec('git rev-list --count @{upstream}..HEAD 2>/dev/null || echo 0', { cwd: repoPath }).then(r => parseInt(r.stdout.trim()) || 0)
    ]);
    
    const [hash, message, author, date] = lastCommitInfo.split('|');
    
    return {
      currentBranch,
      remoteUrl,
      lastCommit: {
        hash,
        message,
        author,
        date
      },
      uncommittedChanges: statusOutput.length > 0,
      unpushedCommits: unpushedCount
    };
  } catch (error) {
    throw new Error(`Failed to get local git info: ${error}`);
  }
}

// Prefer local git commands over GitHub API for common operations
export async function getLocalBranches(repoPath: string = '.'): Promise<{
  current: string;
  all: string[];
  remote: string[];
}> {
  try {
    const [currentBranch, allBranches, remoteBranches] = await Promise.all([
      exec('git branch --show-current', { cwd: repoPath }).then(r => r.stdout.trim()),
      exec('git branch --format="%(refname:short)"', { cwd: repoPath }).then(r => r.stdout.trim().split('\n').filter(Boolean)),
      exec('git branch -r --format="%(refname:short)"', { cwd: repoPath }).then(r => r.stdout.trim().split('\n').filter(Boolean))
    ]);
    
    return {
      current: currentBranch,
      all: allBranches,
      remote: remoteBranches
    };
  } catch (error) {
    throw new Error(`Failed to get local branches: ${error}`);
  }
}

export { RateLimit, RateLimitResponse };