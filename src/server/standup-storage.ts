import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getUserSettings } from './user-settings.js';
import os from 'os';

interface LogEntry {
  timestamp: string;
  date: string;
  entry: string;
  author: string;
}

const LOG_DIR = path.join(os.homedir(), '.tix', 'logs');

/**
 * Read log entries from ~/.tix/logs for a date range
 */
async function getLogEntriesForRange(startDate: string, endDate: string): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `${dateStr}.json`);
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const dayEntries: LogEntry[] = JSON.parse(content);
      entries.push(...dayEntries);
    } catch {
      // No log file for this date, skip
    }
  }
  
  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, '..', '..', 'data', 'standups');

export interface CommitInfo {
  repo: string;
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface PRActivity {
  repo: string;
  number: number;
  title: string;
  action: 'opened' | 'merged' | 'reviewed' | 'closed';
  url: string;
  date: string;
}

export interface IssueActivity {
  repo: string;
  number: number;
  title: string;
  action: 'closed' | 'opened';
  url: string;
  date: string;
}

export interface StandupEntry {
  id: string;
  date: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  commits: CommitInfo[];
  prs: PRActivity[];
  issues: IssueActivity[];
  generatedAt: string;
}

/**
 * Initialize standup storage directory
 */
export async function initializeStandupStorage(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to initialize standup storage:', error);
  }
}

/**
 * Get configured repositories to scan
 */
async function getConfiguredRepos(): Promise<string[]> {
  const settings = await getUserSettings();
  const defaultRepos = [
    'em-boxes-events',
    'em-transactions-api', 
    'em-contracts',
    'tix',
    'tix-kanban',
    'dwlf-charting',
    'dwlf-indicators',
    'portfolio-frontend',
    'serverless-portfolio-tracker'
  ];

  const githubOrg = settings.githubOrg || 'andywilliams';
  return defaultRepos.map(repo => `${githubOrg}/${repo}`);
}

/**
 * Get git commits from the last N hours for a repository
 */
async function getRecentCommits(repoPath: string, hoursAgo: number = 24): Promise<CommitInfo[]> {
  try {
    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    const cmd = `git log --since="${since}" --pretty=format:"%H|%s|%an|%ai" --no-merges`;
    
    const output = execSync(cmd, { 
      cwd: repoPath, 
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();

    if (!output) return [];

    const repoName = path.basename(repoPath);
    return output.split('\n').map(line => {
      const [hash, message, author, date] = line.split('|');
      return {
        repo: repoName,
        hash: hash.substring(0, 8),
        message: message.trim(),
        author: author.trim(),
        date: new Date(date).toISOString()
      };
    });
  } catch (err) {
    console.warn(`Warning: Could not get commits from ${repoPath}: ${err}`);
    return [];
  }
}

/**
 * Get GitHub activity using gh CLI
 */
async function getGitHubActivity(userName: string, hoursAgo: number = 24): Promise<{ prs: PRActivity[], issues: IssueActivity[] }> {
  const prs: PRActivity[] = [];
  const issues: IssueActivity[] = [];
  
  try {
    // Check if gh CLI is available and authenticated
    execSync('gh auth status', { stdio: 'pipe' });
    
    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Get PRs created or updated by the user
    const prQuery = `author:${userName} updated:>=${since}`;
    const prResult = execSync(`gh search prs "${prQuery}" --json number,title,repository,state,updatedAt,url --limit 50`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const prData = JSON.parse(prResult);
    for (const pr of prData) {
      const action = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'opened';
      prs.push({
        repo: pr.repository.name,
        number: pr.number,
        title: pr.title,
        action,
        url: pr.url,
        date: pr.updatedAt
      });
    }

    // Get issues closed by the user
    const issueQuery = `assignee:${userName} closed:>=${since}`;
    const issueResult = execSync(`gh search issues "${issueQuery}" --json number,title,repository,state,closedAt,url --limit 50`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    const issueData = JSON.parse(issueResult);
    for (const issue of issueData) {
      if (issue.state === 'CLOSED' && issue.closedAt) {
        issues.push({
          repo: issue.repository.name,
          number: issue.number,
          title: issue.title,
          action: 'closed',
          url: issue.url,
          date: issue.closedAt
        });
      }
    }

  } catch (err) {
    console.warn(`Warning: Could not fetch GitHub activity: ${err}`);
  }

  return { prs, issues };
}

/**
 * Scan local repositories for git activity
 */
async function scanLocalRepos(hoursAgo: number): Promise<CommitInfo[]> {
  const allCommits: CommitInfo[] = [];
  const configuredRepos = await getConfiguredRepos();
  
  // Look for repos in common locations
  const searchPaths = [
    '/root/clawd/repos',
    path.join(process.env.HOME || '/root', 'repos'),
    path.join(process.env.HOME || '/root', 'code'),
    path.join(process.env.HOME || '/root', 'projects'),
    process.cwd()
  ];

  for (const repoName of configuredRepos) {
    const shortName = repoName.split('/').pop() || repoName;
    let found = false;

    for (const searchPath of searchPaths) {
      try {
        const repoPath = path.join(searchPath, shortName);
        await fs.access(path.join(repoPath, '.git'));
        const commits = await getRecentCommits(repoPath, hoursAgo);
        allCommits.push(...commits);
        found = true;
        break;
      } catch {
        // Repository not found in this path, continue searching
      }
    }

    if (!found) {
      console.warn(`Warning: Could not find local repo: ${shortName}`);
    }
  }

  return allCommits;
}

/**
 * Generate standup content from activity data
 */
async function generateStandup(commits: CommitInfo[], prs: PRActivity[], issues: IssueActivity[]): Promise<Omit<StandupEntry, 'id' | 'generatedAt'>> {
  const today = new Date().toISOString().split('T')[0];
  
  const yesterday: string[] = [];
  const todayItems: string[] = [];
  const blockers: string[] = [];

  // Process log entries first
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const logEntries = await getLogEntriesForRange(yesterdayDate, today);
  logEntries.forEach(entry => {
    yesterday.push(`📝 ${entry.entry}`);
  });

  // Process commits
  commits.forEach(commit => {
    yesterday.push(`${commit.repo}: ${commit.message} (${commit.hash})`);
  });

  // Process PR activity
  prs.forEach(pr => {
    const action = pr.action === 'opened' ? 'Opened' : pr.action === 'merged' ? 'Merged' : 'Closed';
    yesterday.push(`${action} PR #${pr.number} in ${pr.repo}: ${pr.title}`);
  });

  // Process issue activity
  issues.forEach(issue => {
    yesterday.push(`Closed issue #${issue.number} in ${issue.repo}: ${issue.title}`);
  });

  // Add default "today" items based on current work
  if (commits.length > 0 || prs.length > 0) {
    todayItems.push('Continue work on active development tasks');
    todayItems.push('Review any pending PRs and issues');
  }

  // Check for potential blockers
  if (prs.some(pr => pr.action === 'opened')) {
    blockers.push('Some PRs may be waiting for review');
  }

  if (yesterday.length === 0) {
    yesterday.push('No git or GitHub activity found in the last 24 hours');
  }

  if (todayItems.length === 0) {
    todayItems.push('Planning and prioritizing tasks for today');
  }

  if (blockers.length === 0) {
    blockers.push('None at this time');
  }

  return {
    date: today,
    yesterday,
    today: todayItems,
    blockers,
    commits,
    prs,
    issues
  };
}

/**
 * Generate a new standup entry
 */
export async function generateStandupEntry(hoursAgo: number = 24): Promise<StandupEntry> {
  const settings = await getUserSettings();
  const userName = settings.userName || 'unknown';
  
  // Collect activity data
  const commits = await scanLocalRepos(hoursAgo);
  const { prs, issues } = await getGitHubActivity(userName, hoursAgo);
  
  // Generate standup
  const standupData = await generateStandup(commits, prs, issues);
  
  const entry: StandupEntry = {
    id: `${standupData.date}-${Date.now()}`,
    ...standupData,
    generatedAt: new Date().toISOString()
  };

  return entry;
}

/**
 * Save a standup entry
 */
export async function saveStandupEntry(entry: StandupEntry): Promise<void> {
  const filename = `${entry.date}_${entry.id}.json`;
  const filepath = path.join(STORAGE_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Get all standup entries, sorted by date (newest first)
 */
export async function getAllStandupEntries(): Promise<StandupEntry[]> {
  try {
    const files = await fs.readdir(STORAGE_DIR);
    const entries: StandupEntry[] = [];
    
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const filepath = path.join(STORAGE_DIR, file);
        const content = await fs.readFile(filepath, 'utf-8');
        entries.push(JSON.parse(content));
      } catch (error) {
        console.warn(`Warning: Could not read standup file ${file}: ${error}`);
      }
    }
    
    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.warn('Warning: Could not read standup directory:', error);
    return [];
  }
}

/**
 * Get standup entries from the past N days
 */
export async function getRecentStandupEntries(days: number = 7): Promise<StandupEntry[]> {
  const allEntries = await getAllStandupEntries();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return allEntries.filter(entry => new Date(entry.date) >= cutoff);
}

/**
 * Delete a standup entry
 */
export async function deleteStandupEntry(id: string): Promise<boolean> {
  try {
    const files = await fs.readdir(STORAGE_DIR);
    const targetFile = files.find(f => f.includes(id));
    
    if (targetFile) {
      await fs.unlink(path.join(STORAGE_DIR, targetFile));
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error deleting standup entry:', error);
    return false;
  }
}