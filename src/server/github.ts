import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const exec = promisify(execCallback);

const CONFIG_FILE = path.join(os.homedir(), '.tix-kanban', 'github-config.json');

export interface GitHubConfig {
  repos: string[]; // List of repo names like "owner/repo"
  defaultBranch: string; // Default branch name (usually "main" or "master")
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
  try {
    const { stdout } = await exec('gh auth status --show-token 2>&1');
    const usernameMatch = stdout.match(/Logged in to github\.com as ([^\s]+)/);
    return {
      authenticated: true,
      username: usernameMatch ? usernameMatch[1] : undefined,
    };
  } catch (error) {
    return { authenticated: false };
  }
}

// Create a new branch for a task
export async function createTaskBranch(repo: string, taskId: string, taskTitle: string): Promise<string> {
  const config = await getGitHubConfig();
  const branchName = `${config.branchPrefix}${taskId}-${taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  
  // Create branch using gh CLI
  await exec(`gh api repos/${repo}/git/refs -f ref=refs/heads/${branchName} -f sha=$(gh api repos/${repo}/git/refs/heads/${config.defaultBranch} --jq '.object.sha')`);
  
  return branchName;
}

// Create a PR from a task
export async function createTaskPR(
  repo: string,
  taskId: string,
  taskTitle: string,
  taskDescription: string,
  branchName?: string
): Promise<PRStatus> {
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

  const { stdout } = await exec(`gh pr create --repo ${repo} --title "${prTitle}" --body "${prBody}" --head ${branchName} --base ${config.defaultBranch} --draft`);
  
  // Extract PR number from output
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
  if (!urlMatch) {
    throw new Error('Failed to extract PR number from gh output');
  }
  
  const prNumber = parseInt(urlMatch[1], 10);
  return await getPRStatus(repo, prNumber);
}

// Get PR status and details
export async function getPRStatus(repo: string, prNumber: number): Promise<PRStatus> {
  const { stdout: prData } = await exec(`gh pr view ${prNumber} --repo ${repo} --json number,title,state,isDraft,url,createdAt,updatedAt,mergeable`);
  const pr = JSON.parse(prData);
  
  // Get check runs
  const { stdout: checksData } = await exec(`gh api repos/${repo}/pulls/${prNumber}/checks --jq '.check_runs[] | {conclusion, status}'`);
  const checks = checksData.trim() ? checksData.split('\n').map(line => JSON.parse(line)) : [];
  
  // Get reviews
  const { stdout: reviewsData } = await exec(`gh api repos/${repo}/pulls/${prNumber}/reviews --jq '.[] | select(.state != null) | {state, user: {login}}'`);
  const reviewsRaw = reviewsData.trim() ? reviewsData.split('\n').map(line => JSON.parse(line)) : [];
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
}

// Get all PRs for a repo (optionally filtered by state)
export async function getRepoPRs(repo: string, state: 'open' | 'closed' | 'merged' | 'all' = 'open'): Promise<PRStatus[]> {
  const { stdout } = await exec(`gh pr list --repo ${repo} --state ${state} --json number`);
  const prs = JSON.parse(stdout);
  
  const prStatuses: PRStatus[] = [];
  for (const pr of prs) {
    try {
      const status = await getPRStatus(repo, pr.number);
      prStatuses.push(status);
    } catch (error) {
      console.error(`Failed to get status for PR #${pr.number}:`, error);
    }
  }
  
  return prStatuses;
}

// Import GitHub issues as tasks
export async function getRepoIssues(repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
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
  for (const repo of config.repos) {
    try {
      const prs = await getRepoPRs(repo, 'all');
      const taskPRs = prs.filter(pr => pr.title.includes(`[${taskId}]`));
      linkedPRs.push(...taskPRs);
    } catch (error) {
      console.error(`Failed to check PRs for repo ${repo}:`, error);
    }
  }
  
  return {
    linkedPRs,
    suggestedRepos: config.repos,
  };
}