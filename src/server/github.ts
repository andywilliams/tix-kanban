import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { 
  executeWithRateLimit, 
  getCachedResponse, 
  getLocalGitInfo,
  getLocalBranches,
  checkRateLimit 
} from './github-rate-limit.js';

const exec = promisify(execCallback);

const CONFIG_FILE = path.join(os.homedir(), '.tix-kanban', 'github-config.json');

// Helper to get repo name from string or object
const getRepoName = (repo: string | RepoConfig): string =>
  typeof repo === 'string' ? repo : repo.name;

// Helper to get default branch for a specific repo
const getRepoBranch = (repo: string | RepoConfig, fallback: string): string =>
  typeof repo === 'object' && repo.defaultBranch ? repo.defaultBranch : fallback;

export interface RepoConfig {
  name: string;
  defaultBranch: string;
}

export interface GitHubConfig {
  repos: (string | RepoConfig)[]; // Strings for backwards compat, or objects with per-repo settings
  defaultBranch: string; // Fallback default branch
  branchPrefix: string; // Prefix for feature branches (e.g., "tix/")
  autoLink: boolean; // Auto-link tasks to PRs when created
}

export interface PRStatus {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  url: string;
  checks: {
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
    status: 'queued' | 'in_progress' | 'completed';
  }[];
  reviews: {
    state: 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENTED' | 'DISMISSED';
    reviewer: string;
  }[];
  mergeable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

// Default configuration
const DEFAULT_CONFIG: GitHubConfig = {
  repos: [],
  defaultBranch: 'main',
  branchPrefix: 'tix/',
  autoLink: true,
};

// Load GitHub configuration
export async function getGitHubConfig(): Promise<GitHubConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Config doesn't exist, create default
      await saveGitHubConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

// Save GitHub configuration
export async function saveGitHubConfig(config: GitHubConfig): Promise<void> {
  const dir = path.dirname(CONFIG_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// Test GitHub CLI authentication
export async function testGitHubAuth(): Promise<{ authenticated: boolean; username?: string }> {
  return getCachedResponse('gh-auth-status', async () => {
    try {
      const { stdout } = await exec('gh auth status --show-token 2>&1');
      // Updated regex to match the actual output format: "Logged in to github.com account USERNAME"
      const usernameMatch = stdout.match(/Logged in to github\.com account ([^\s]+)/);
      return {
        authenticated: true,
        username: usernameMatch ? usernameMatch[1] : undefined,
      };
    } catch (error) {
      return { authenticated: false };
    }
  }, 600000); // Cache auth status for 10 minutes
}

// Resolve the default branch for a given repo name
function resolveDefaultBranch(config: GitHubConfig, repoName: string): string {
  const entry = config.repos.find(r => getRepoName(r) === repoName);
  return entry ? getRepoBranch(entry, config.defaultBranch) : config.defaultBranch;
}

// Create a new branch for a task
export async function createTaskBranch(repo: string, taskId: string, taskTitle: string): Promise<string> {
  const config = await getGitHubConfig();
  const baseBranch = resolveDefaultBranch(config, repo);
  const branchName = `${config.branchPrefix}${taskId}-${taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  
  return executeWithRateLimit(async () => {
    // Create branch using gh CLI
    await exec(`gh api repos/${repo}/git/refs -f ref=refs/heads/${branchName} -f sha=$(gh api repos/${repo}/git/refs/heads/${baseBranch} --jq '.object.sha')`);
    return branchName;
  }, `createTaskBranch(${repo}, ${taskId})`, 2); // 2 API calls: get base sha + create branch
}

// Create a PR from a task
export async function createTaskPR(
  repo: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  branchName?: string
): Promise<PRStatus> {
  return executeWithRateLimit(async () => {
    const config = await getGitHubConfig();
    
    // Create branch if not provided
    if (!branchName) {
      branchName = await createTaskBranch(repo, taskId, taskTitle);
    }
    
    // Create PR using gh CLI
    const prTitle = `[${taskId}] ${taskTitle}`;
    const prBody = `## Task: ${taskTitle}

${taskDescription}

---
*This PR was automatically created from task ${taskId} via tix-kanban*`;

    const baseBranch = resolveDefaultBranch(config, repo);
    const { stdout } = await exec(`gh pr create --repo ${repo} --title "${prTitle}" --body "${prBody}" --head ${branchName} --base ${baseBranch} --draft`);
    
    // Extract PR number from output
    const urlMatch = stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
    if (!urlMatch) {
      throw new Error('Failed to extract PR number from gh output');
    }
    
    const prNumber = parseInt(urlMatch[1], 10);
    return await getPRStatus(repo, prNumber);
  }, `createTaskPR(${repo}, ${taskId})`, 4); // Branch creation (2) + PR creation (1) + PR status (1)
}

// Get PR status and details
export async function getPRStatus(repo: string, prNumber: number): Promise<PRStatus> {
  const cacheKey = `pr-status-${repo}-${prNumber}`;
  
  return getCachedResponse(cacheKey, async () => {
    return executeWithRateLimit(async () => {
      // Get basic PR info
      const { stdout: prData } = await exec(`gh pr view ${prNumber} --repo ${repo} --json number,title,state,isDraft,url,createdAt,updatedAt,mergeable`);
      const pr = JSON.parse(prData);
      
      // Get check runs (may 404 for repos without CI)
      let checks: PRStatus['checks'] = [];
      try {
        const { stdout: checksData } = await exec(`gh pr view ${prNumber} --repo ${repo} --json statusCheckRollup --jq '.statusCheckRollup[] | {conclusion: .conclusion, status: .status}'`);
        checks = checksData.trim() ? checksData.split('\n').map(line => JSON.parse(line)) : [];
      } catch {
        // No CI checks configured — that's fine
      }
      
      // Get reviews (may 404 for some repo configurations)
      let reviewsRaw: Array<{ state: string; user: { login: string } }> = [];
      try {
        const { stdout: reviewsData } = await exec(`gh api repos/${repo}/pulls/${prNumber}/reviews --jq '.[] | select(.state != null) | {state, user: {login}}'`);
        reviewsRaw = reviewsData.trim() ? reviewsData.split('\n').map(line => JSON.parse(line)) : [];
      } catch {
        // No reviews — that's fine
      }
      const reviews = reviewsRaw.map(review => ({
        state: review.state as PRStatus['reviews'][0]['state'],
        reviewer: review.user.login,
      }));
      
      return {
        number: pr.number,
        title: pr.title,
        state: pr.state === 'MERGED' ? 'merged' : pr.state.toLowerCase(),
        draft: pr.isDraft,
        url: pr.url,
        checks,
        reviews,
        mergeable: pr.mergeable,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
    }, `getPRStatus(${repo}#${prNumber})`, 3); // 3 API calls: basic info, checks, reviews
  }, 120000); // Cache PR status for 2 minutes
}

// Get all PRs for a repo (optionally filtered by state)
export async function getRepoPRs(repo: string, state: 'open' | 'closed' | 'merged' | 'all' = 'open'): Promise<PRStatus[]> {
  const cacheKey = `repo-prs-${repo}-${state}`;
  
  return getCachedResponse(cacheKey, async () => {
    return executeWithRateLimit(async () => {
      const { stdout } = await exec(`gh pr list --repo ${repo} --state ${state} --json number`);
      const prs = JSON.parse(stdout);
      
      // Check rate limit before processing all PRs
      const rateLimitCheck = await checkRateLimit(prs.length * 3); // 3 calls per PR
      if (!rateLimitCheck.allowed && prs.length > 5) {
        console.warn(`Rate limit insufficient for ${prs.length} PRs. Processing only first 5.`);
        prs.splice(5); // Limit to first 5 PRs to avoid rate limit
      }
      
      const prStatuses: PRStatus[] = [];
      for (const pr of prs) {
        try {
          // Yield to event loop between PR fetches to avoid blocking the server
          await new Promise(resolve => setImmediate(resolve));
          const status = await getPRStatus(repo, pr.number);
          prStatuses.push(status);
        } catch (error) {
          console.error(`Failed to get status for PR #${pr.number}:`, error);
        }
      }
      
      return prStatuses;
    }, `getRepoPRs(${repo}, ${state})`, 1); // Initial list call
  }, 300000); // Cache repo PRs for 5 minutes
}

// Import GitHub issues as tasks
export async function getRepoIssues(repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
  const cacheKey = `repo-issues-${repo}-${state}`;
  
  return getCachedResponse(cacheKey, async () => {
    return executeWithRateLimit(async () => {
      const { stdout } = await exec(`gh issue list --repo ${repo} --state ${state} --json number,title,body,state,labels,assignees,createdAt,updatedAt,url`);
      const issues = JSON.parse(stdout);
      
      return issues.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state.toLowerCase(),
        labels: issue.labels?.map((label: any) => label.name) || [],
        assignees: issue.assignees?.map((assignee: any) => assignee.login) || [],
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url,
      }));
    }, `getRepoIssues(${repo}, ${state})`, 1);
  }, 300000); // Cache issues for 5 minutes
}

// Sync PR status and auto-move tasks based on PR state
export async function syncTaskWithPR(_taskId: string, repo: string, prNumber: number): Promise<{
  prStatus: PRStatus;
  taskStatusUpdate?: 'review' | 'done';
  reason?: string;
}> {
  const prStatus = await getPRStatus(repo, prNumber);
  
  let taskStatusUpdate: 'review' | 'done' | undefined;
  let reason: string | undefined;
  
  // Auto-move logic based on PR state and checks
  if (prStatus.state === 'merged') {
    taskStatusUpdate = 'done';
    reason = 'PR merged successfully';
  } else if (prStatus.state === 'open' && !prStatus.draft) {
    // PR is open and not draft
    const hasFailingChecks = prStatus.checks.some(check => check.conclusion === 'failure');
    const hasApproval = prStatus.reviews.some(review => review.state === 'APPROVED');
    const hasChangesRequested = prStatus.reviews.some(review => review.state === 'REQUEST_CHANGES');
    
    if (hasFailingChecks) {
      // Keep in progress due to failing checks
      reason = 'PR has failing checks';
    } else if (hasChangesRequested) {
      // Keep in progress due to requested changes
      reason = 'PR has requested changes';
    } else if (hasApproval && prStatus.mergeable) {
      taskStatusUpdate = 'review';
      reason = 'PR approved and ready to merge';
    } else if (prStatus.checks.length > 0 && prStatus.checks.every(check => check.conclusion === 'success')) {
      taskStatusUpdate = 'review';
      reason = 'All checks passing, awaiting review';
    }
  }
  
  return { prStatus, taskStatusUpdate, reason };
}

// Get GitHub-related data for a task (PRs, issues, etc.)
export async function getTaskGitHubData(taskId: string): Promise<{
  linkedPRs: PRStatus[];
  suggestedRepos: string[];
}> {
  const config = await getGitHubConfig();
  const linkedPRs: PRStatus[] = [];
  
  // For now, we'll need to search through PRs to find ones linked to this task
  // This is a simplified approach - in a real system you'd store these links
  for (const repoEntry of config.repos) {
    const repoName = getRepoName(repoEntry);
    try {
      // Yield to event loop between repo checks to avoid blocking the server
      await new Promise(resolve => setImmediate(resolve));
      const prs = await getRepoPRs(repoName, 'all');
      const taskPRs = prs.filter(pr => pr.title.includes(`[${taskId}]`));
      linkedPRs.push(...taskPRs);
    } catch (error) {
      console.error(`Failed to check PRs for repo ${repoName}:`, error);
    }
  }
  
  return {
    linkedPRs,
    suggestedRepos: config.repos.map(r => getRepoName(r)),
  };
}

// Helper functions for local alternatives to GitHub API

// Get repository activity using local git commands instead of GitHub API
export async function getLocalRepoActivity(repoPath: string, days: number = 7): Promise<{
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
    filesChanged: number;
  }>;
  branches: {
    current: string;
    all: string[];
    stale: string[]; // Branches older than 30 days
  };
  status: {
    uncommittedChanges: boolean;
    unpushedCommits: number;
    unpulledCommits: number;
  };
}> {
  try {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Get recent commits with file change counts
    const { stdout: commitData } = await exec(`git log --since="${sinceDate}" --pretty=format:"%H|%s|%an|%ai" --numstat`, { cwd: repoPath });
    const commits = [];
    
    if (commitData.trim()) {
      const lines = commitData.split('\n');
      let currentCommit: any = null;
      let filesChanged = 0;
      
      for (const line of lines) {
        if (line.includes('|') && !line.match(/^\d+\s+\d+/)) {
          // New commit line
          if (currentCommit) {
            currentCommit.filesChanged = filesChanged;
            commits.push(currentCommit);
          }
          const [hash, message, author, date] = line.split('|');
          currentCommit = { hash, message, author, date };
          filesChanged = 0;
        } else if (line.match(/^\d+\s+\d+/) || line.match(/^-\s+-/)) {
          // File change line
          filesChanged++;
        }
      }
      if (currentCommit) {
        currentCommit.filesChanged = filesChanged;
        commits.push(currentCommit);
      }
    }
    
    // Get branch information
    const branches = await getLocalBranches(repoPath);
    
    // Find stale branches (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { stdout: staleBranchData } = await exec(`git for-each-ref --format="%(refname:short)|%(committerdate:iso)" refs/heads/`, { cwd: repoPath });
    const staleBranches = staleBranchData.split('\n')
      .filter(Boolean)
      .map(line => {
        const [branch, date] = line.split('|');
        return { branch, date };
      })
      .filter(item => item.date < thirtyDaysAgo && item.branch !== branches.current)
      .map(item => item.branch);
    
    // Get status information
    const [unpushedCount, unpulledCount, statusOutput] = await Promise.all([
      exec('git rev-list --count @{upstream}..HEAD 2>/dev/null || echo 0', { cwd: repoPath }).then(r => parseInt(r.stdout.trim()) || 0),
      exec('git rev-list --count HEAD..@{upstream} 2>/dev/null || echo 0', { cwd: repoPath }).then(r => parseInt(r.stdout.trim()) || 0),
      exec('git status --porcelain', { cwd: repoPath }).then(r => r.stdout.trim())
    ]);
    
    return {
      commits,
      branches: {
        current: branches.current,
        all: branches.all,
        stale: staleBranches
      },
      status: {
        uncommittedChanges: statusOutput.length > 0,
        unpushedCommits: unpushedCount,
        unpulledCommits: unpulledCount
      }
    };
  } catch (error) {
    throw new Error(`Failed to get local repository activity: ${error}`);
  }
}

// Get local file history instead of using GitHub API for blame/history
export async function getLocalFileHistory(repoPath: string, filePath: string, maxCommits: number = 10): Promise<Array<{
  hash: string;
  message: string;
  author: string;
  date: string;
  changes: {
    added: number;
    deleted: number;
  };
}>> {
  try {
    const { stdout } = await exec(`git log -${maxCommits} --pretty=format:"%H|%s|%an|%ai" --numstat -- "${filePath}"`, { cwd: repoPath });
    
    if (!stdout.trim()) {
      return [];
    }
    
    const lines = stdout.split('\n');
    const commits = [];
    let currentCommit: any = null;
    
    for (const line of lines) {
      if (line.includes('|') && !line.match(/^\d+\s+\d+/)) {
        // New commit line
        if (currentCommit) {
          commits.push(currentCommit);
        }
        const [hash, message, author, date] = line.split('|');
        currentCommit = { hash, message, author, date, changes: { added: 0, deleted: 0 } };
      } else if (line.match(/^\d+\s+\d+/) && currentCommit) {
        // Numstat line
        const [added, deleted] = line.split('\t').map(Number);
        currentCommit.changes.added += added || 0;
        currentCommit.changes.deleted += deleted || 0;
      }
    }
    
    if (currentCommit) {
      commits.push(currentCommit);
    }
    
    return commits;
  } catch (error) {
    throw new Error(`Failed to get local file history for ${filePath}: ${error}`);
  }
}

// Batch GitHub operations to reduce API calls
export async function batchGetPRStatuses(repo: string, prNumbers: number[]): Promise<Map<number, PRStatus>> {
  if (prNumbers.length === 0) {
    return new Map();
  }
  
  // Check if we have enough rate limit for all requests
  const requiredRequests = prNumbers.length * 3; // 3 calls per PR
  const rateLimitCheck = await checkRateLimit(requiredRequests);
  
  if (!rateLimitCheck.allowed) {
    console.warn(`Insufficient rate limit for ${prNumbers.length} PRs. Limiting to avoid rate limit.`);
    const maxPRs = Math.floor(rateLimitCheck.remaining / 3);
    prNumbers = prNumbers.slice(0, maxPRs);
  }
  
  const results = new Map<number, PRStatus>();
  
  // Process in smaller batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < prNumbers.length; i += batchSize) {
    const batch = prNumbers.slice(i, i + batchSize);
    const batchPromises = batch.map(prNumber => 
      getPRStatus(repo, prNumber).catch(error => {
        console.error(`Failed to get PR #${prNumber}:`, error);
        return null;
      })
    );
    
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((result, index) => {
      if (result) {
        results.set(batch[index], result);
      }
    });
    
    // Small delay between batches to be respectful
    if (i + batchSize < prNumbers.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}