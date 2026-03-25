import * as cron from 'node-cron';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFile as execFileCallback, spawn } from 'child_process';
import { promisify } from 'util';
import { parsePRLinks, getPRState, getPRMergeableState } from './pr-utils.js';
import { getPRReviewThreads, getPRComments, ReviewThread } from './github.js';
import { runSlxDigest } from './slx-service.js';
import { getAllTasks, updateTask, getTask, addTaskLink } from './storage.js';
import { getAllPersonas, getPersona, createPersonaContext, updatePersonaMemoryAfterTask, updatePersonaStats } from './persona-storage.js';
import { enforceProviderAccess } from './persona-yaml-loader.js';
import { getOrCreateSession, addMessage as addSessionMessage } from '../services/sessionService.js';
import { BUILTIN_TRIGGER_DEFAULTS } from './persona-constants.js';
import { 
  getPipeline, 
  getTaskPipelineState, 
  updateTaskPipelineState 
} from './pipeline-storage.js';
import { Task, Persona, Comment } from '../client/types/index.js';
import { TaskPipelineState, TaskStageHistory } from '../client/types/pipeline.js';
import { initiateAutoReview, executeReviewCycle, deleteTaskReviewState } from './auto-review.js';
import { getUserSettings } from './user-settings.js';
import { saveReport } from './reports-storage.js';
import { clearExpiredCache } from './github-rate-limit.js';
import { processReviewTasksPRStatus, getPRMonitorStats } from './pr-monitor.js';
import {
  generateStandupEntry,
  saveStandupEntry,
  getAllStandupEntries
} from './standup-storage.js';
import { createOrGetChannel, addMessage, getMessages } from './chat-storage.js';
import { evaluateReminderRules } from './reminder-rules.js';
import { initializeTriggerSystem } from './event-triggers.js';
import { evaluateFieldCondition } from './condition-utils.js';
import {
  PersonalReminder,
  getDueReminders,
  markReminderTriggered,
  cleanupOldReminders,
} from './personal-reminders.js';
import {
  trackTaskStarted,
  trackTaskCompleted,
  trackTaskFailed,
  trackReviewCompleted
} from './activityTracker.js';


const execFile = promisify(execFileCallback);

// Sanitize user content to prevent prompt injection attacks
function sanitizeForPrompt(content: string): string {
  if (!content) return '';
  
  // Remove or escape content that could be prompt injection attempts
  return content
    // Remove null bytes and control characters that might terminate prompts
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Escape content that looks like instructions or system messages
    .replace(/^\s*(system|human|assistant|ai):/igm, '[USER_CONTENT] $&')
    // Escape markdown-like instructions that might confuse the model
    .replace(/^\s*```/gm, '[CODE_BLOCK]')
    // Limit length to prevent overwhelming the context
    .substring(0, 2000)
    // Indicate if content was truncated
    + (content.length > 2000 ? '\n[Content truncated for security]' : '');
}

// Post a proactive status update to the task's chat channel
async function postTaskUpdate(task: Task, persona: Persona, message: string): Promise<void> {
  try {
    const channelId = `task-${task.id}`;
    await createOrGetChannel(channelId, 'task', task.id, task.title);
    await addMessage(channelId, persona.name, 'persona', message);
  } catch (error) {
    // Non-fatal — don't let chat failures block task processing
    console.warn(`Failed to post task update for ${task.id}:`, error);
  }
}

// Execute Claude CLI with prompt via stdin to avoid TOCTOU and shell injection
const DEFAULT_MAX_TURNS: Record<'task' | 'research' | 'evaluation', number> = {
  task: 25,
  research: 30,
  evaluation: 4,
};

// Resolve model aliases to full model names so we don't depend on Claude CLI's
// built-in alias resolution (which may point to outdated versions)
const MODEL_ALIASES: Record<string, string> = {
  'opus': 'claude-opus-4-6',
  'sonnet': 'claude-sonnet-4-6',
  'haiku': 'claude-haiku-4-5-20250515',
  // Legacy full model names → latest versions
  'claude-opus-4-20250514': 'claude-opus-4-6',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-sonnet-4-5-20241022': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-opus-20240229': 'claude-opus-4-6',
};

function resolveModelAlias(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const lower = model.toLowerCase().trim();
  return MODEL_ALIASES[lower] || model;
}

function executeClaudeWithStdin(
  prompt: string,
  args: string[] = [],
  timeoutMs: number = 320000,
  cwd?: string,
  model?: string,
  operationType: 'task' | 'research' | 'evaluation' = 'task'
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const hasMaxTurnsArg = args.includes('--max-turns');
    const claudeArgs = ['-p', ...args];
    if (!hasMaxTurnsArg) {
      claudeArgs.push('--max-turns', String(DEFAULT_MAX_TURNS[operationType]));
    }
    if (model) {
      claudeArgs.push('--model', model);
    }
    const fullCommand = `claude ${claudeArgs.map(a => `'${a}'`).join(' ')}`;
    
    // Validate cwd exists, fall back to process.cwd() if not
    let resolvedCwd = cwd;
    if (cwd) {
      if (!existsSync(cwd)) {
        console.warn(`[worker] Workspace directory does not exist: ${cwd}, falling back to ${process.cwd()}`);
        resolvedCwd = undefined;
      }
    }
    
    console.log(`[worker] Running: ${fullCommand} (cwd: ${resolvedCwd || process.cwd()})`);
    const child = spawn(fullCommand, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: true,
      ...(resolvedCwd && { cwd: resolvedCwd })
    });
    
    let stdout = '';
    let stderr = '';
    
    // Set up timeout
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      clearTimeout(timeout);
      // Always log output for debugging (truncated)
      console.log(`[worker] Claude exited with code ${code}`);
      if (stderr) {
        console.error(`[worker] stderr: ${stderr.substring(0, 2000)}`);
      }
      console.log(`[worker] stdout (last 3000 chars): ${stdout.substring(Math.max(0, stdout.length - 3000))}`);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Claude process exited with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    
    // Send prompt via stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');
const WORKER_STATE_FILE = path.join(STORAGE_DIR, 'worker-state.json');
const WORKER_TRIGGER_STATE_FILE = path.join(STORAGE_DIR, 'worker-trigger-state.json');

type TriggerEventType = 'onPROpened' | 'onPRMerged' | 'onPRClosed' | 'onCIPassed' | 'onTestFailure' | 'onTaskStarted' | 'onCommentAdded';

// ParsedPRLink imported from pr-utils

interface PRSnapshot {
  state: 'open' | 'closed' | 'merged' | null;
  ciState: 'SUCCESS' | 'FAILURE' | null;
  seenThreadIds?: string[]; // Track which review threads we've seen
  lastThreadCheck?: string; // ISO timestamp of last thread check
  seenCommentIds?: string[]; // Track which plain PR comments we've seen
  lastCommentCheck?: string; // ISO timestamp of last plain comment check
  hasUnresolvedThreads?: boolean; // True if PR has any unresolved review threads
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | null; // PR mergeable state
  stale?: boolean; // True if snapshot was preserved from previous cycle due to API failure
}

interface WorkerTriggerTaskState {
  prs: Record<string, PRSnapshot>;
  lastStatus?: Task['status'];
  lastSeenTaskCommentId?: string; // Track last seen kanban task comment
}

interface WorkerTriggerState {
  tasks: Record<string, WorkerTriggerTaskState>;
}

interface ActiveSession {
  personaId: string;
  taskId: string;
  startedAt: Date;
}

interface WorkerState {
  enabled: boolean;
  interval: string; // cron expression
  lastRun?: string;
  lastTaskId?: string;
  isRunning: boolean;
  workload: number; // number of active tasks
  standupEnabled: boolean; // morning standup generation
  standupTime: string; // cron expression for standup time
  lastStandupRun?: string;
  slxSyncEnabled: boolean; // Slack sync via slx
  slxSyncInterval: string; // cron expression for slx sync frequency
  lastSlxSyncRun?: string;
  reminderCheckEnabled: boolean; // reminder rules engine
  reminderCheckInterval: string; // cron expression for reminder check frequency
  lastReminderCheckRun?: string;
  maxConcurrentPersonas: number; // max simultaneous persona sessions (default 1)
  allowDuplicatePersonas: boolean; // allow same persona type on multiple tasks (default false)
  activeSessions: ActiveSession[]; // currently running sessions
}

let workerState: WorkerState = {
  enabled: false,
  interval: '*/5 * * * *', // Default: every 5 minutes
  isRunning: false,
  workload: 0,
  standupEnabled: true, // Enable standup generation by default
  standupTime: '0 9 * * 1-5', // 9 AM Monday-Friday
  slxSyncEnabled: false, // Slack sync disabled by default
  slxSyncInterval: '0 */1 * * *', // Default: every 1 hour
  reminderCheckEnabled: true, // Enable personal reminders check by default
  reminderCheckInterval: '*/5 * * * *', // Default: every 5 minutes
  maxConcurrentPersonas: 1, // Default: sequential (1 at a time) for backward compatibility
  allowDuplicatePersonas: false, // Default: prevent same persona on multiple tasks
  activeSessions: [], // No active sessions initially
};

let cronJob: cron.ScheduledTask | null = null;
let standupCronJob: cron.ScheduledTask | null = null;
let slxSyncCronJob: cron.ScheduledTask | null = null;
let reminderCheckCronJob: cron.ScheduledTask | null = null;

// Write queue/mutex to serialize state persistence and prevent race conditions
let writeQueue: Promise<void> = Promise.resolve();

// Add a state save to the write queue (serializes all writes)
function enqueueStateSave(): Promise<void> {
  const currentQueue = writeQueue;
  writeQueue = (async () => {
    await currentQueue;
  })();
  return writeQueue;
}

// Ensure worker directories exist
async function ensureWorkerDirectories(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.mkdir(PERSONAS_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create worker directories:', error);
    throw error;
  }
}

// Load worker state from file
async function loadWorkerState(): Promise<void> {
  try {
    const content = await fs.readFile(WORKER_STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      workerState = { ...workerState, ...parsed };
    }
    // Always reset isRunning on startup — if we're loading, previous process is dead
    workerState.isRunning = false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load worker state:', error);
    }
  }
}

// Save worker state to file (serialized via write queue to prevent race conditions)
async function saveWorkerState(): Promise<void> {
  // Wait for any pending writes to complete first
  await enqueueStateSave();
  
  try {
    await ensureWorkerDirectories();
    const content = JSON.stringify(workerState, null, 2);
    await fs.writeFile(WORKER_STATE_FILE, content, 'utf8');
  } catch (error) {
    console.error('Failed to save worker state:', error);
  }
}

async function loadWorkerTriggerState(): Promise<WorkerTriggerState> {
  try {
    const content = await fs.readFile(WORKER_TRIGGER_STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.tasks && typeof parsed.tasks === 'object' && !Array.isArray(parsed.tasks)) {
      return parsed as WorkerTriggerState;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load worker trigger state:', error);
    }
  }
  return { tasks: {} };
}

async function saveWorkerTriggerState(state: WorkerTriggerState): Promise<void> {
  try {
    await ensureWorkerDirectories();
    await fs.writeFile(WORKER_TRIGGER_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save worker trigger state:', error);
  }
}

// Generate API reference for Claude sessions
// @ts-ignore TS6133
function generateAPIReference(): string {
  return `## Tix-Kanban API Reference

You have access to the tix-kanban API running at http://localhost:3001/api

⚡ **IMPORTANT:** You are running in agentic mode with file editing and command execution enabled!
- Use the Edit tool to modify files
- Use the exec tool to run git commands, tests, builds, etc.
- You can actually DO the work described in the task, not just describe it

🚨 **GITHUB RATE LIMIT AWARENESS:**
- **PREFER LOCAL GIT COMMANDS** over GitHub API wherever possible
- Use \`git log\`, \`git status\`, \`git branch\` instead of \`gh api\` calls
- Only use GitHub API for things that require it: creating PRs, checking CI status, reviews
- **Research tasks**: Read local files, use git history, avoid excessive \`gh\` commands
- The system has automatic rate limiting and caching, but minimize API usage anyway
- If you get rate limit errors, fall back to local alternatives

### Core Task Operations:
- GET /api/tasks - Get all tasks
- GET /api/tasks/:id - Get single task with full details
- PUT /api/tasks/:id - Update task (status, description, etc.)

### Task Status Values:
- "backlog" - Task is waiting to be picked up
- "in-progress" - Task is currently being worked on  
- "review" - Task is completed and needs review
- "done" - Task is fully completed

🚨 **CRITICAL RULE — Status Transitions:**
- **NEVER mark a task "done" yourself.** Tasks are moved to "done" automatically by the PR monitor when the linked PR is actually merged on GitHub.
- Your job is to move tasks to "review" when the work (PR) is ready. After that, leave the status alone.
- If a task is already in "review" and has an open (not merged) PR, do NOT touch the status — leave it in review.
- Only the PR monitor and the stranded-task cleanup code may set status to "done".

### Add Work Comments:
- POST /api/tasks/:id/comments
  Body: {"body": "your detailed work summary", "author": "claude-worker"}

### Add Links (PRs, docs, etc.):
- POST /api/tasks/:id/links  
  Body: {"url": "https://github.com/...", "title": "PR #123", "type": "pr"}
  Types: "pr", "attachment", "reference"

### Example curl commands:
\`\`\`bash
# Update task status
curl -X PUT http://localhost:3001/api/tasks/TASK_ID -H "Content-Type: application/json" -d '{"status": "review"}'

# Add work comment
curl -X POST http://localhost:3001/api/tasks/TASK_ID/comments -H "Content-Type: application/json" -d '{"body": "Implemented feature X with tests", "author": "claude-worker"}'

# Add PR link
curl -X POST http://localhost:3001/api/tasks/TASK_ID/links -H "Content-Type: application/json" -d '{"url": "https://github.com/owner/repo/pull/123", "title": "PR #123", "type": "pr"}'
\`\`\`

### Context & History:
You now receive the FULL task history, including:
- All previous comments from other personas and humans
- All linked PRs, documents, and references
- Task activity timeline

This lets you build on previous work instead of starting from scratch.

### Your Enhanced Workflow:
1. Task is already moved to "in-progress" when you start
2. Review previous comments and links to understand what's been done
3. Build on existing work rather than duplicating effort
4. **ACTUALLY DO THE WORK** - edit files, run commands, create branches, etc.
5. If code changes: create branch + PR, add PR link to task, leave as "in-progress"
6. If non-code work: complete the work, add detailed comment, move status to "review"
7. Always add a comment summarizing what you accomplished
8. Your final output should be a concise summary - the real work is done through tools

The task ID you're working on is: TASK_ID_PLACEHOLDER`;
}

// Extract branch info from linked PRs using gh CLI
async function getPRBranchInfo(links: Task['links']): Promise<Array<{url: string, branch: string, repo: string, number: number}>> {
  const prLinks = (links || []).filter(l => l.type === 'pr' || l.url?.includes('/pull/'));
  const results: Array<{url: string, branch: string, repo: string, number: number}> = [];

  for (const link of prLinks) {
    const match = link.url?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (match) {
      const repo = match[1];
      const number = parseInt(match[2]);
      try {
        const { execFileSync } = await import('child_process');
        const branch = execFileSync(
          'gh',
          ['pr', 'view', String(number), '--repo', repo, '--json', 'headRefName', '--jq', '.headRefName'],
          { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 }
        ).trim();
        if (branch) {
          results.push({ url: link.url!, branch, repo, number });
        }
      } catch {
        // PR might be closed/merged or gh not available
      }
    }
  }
  return results;
}

// parsePRLinks and getPRState are imported from pr-utils.ts

async function getPRCIState(repo: string, number: number): Promise<'SUCCESS' | 'FAILURE' | null> {
  try {
    // Emit each check's conclusion, or "PENDING" for checks still in progress.
    // Using select(.conclusion) would exclude pending checks, causing SUCCESS to
    // fire prematurely when only some checks have completed.
    const { stdout } = await execFile(
      'gh',
      ['pr', 'view', String(number), '--repo', repo, '--json', 'statusCheckRollup', '--jq', '(.statusCheckRollup // [])[] | select(.conclusion != null) | .conclusion'],
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );

    const conclusions = stdout
      .split('\n')
      .map((line) => line.trim().toUpperCase())
      .filter(Boolean);

    if (conclusions.length === 0) {
      return null;
    }

    // If any check is still running, CI hasn't fully completed yet.
    const hasPending = conclusions.some((value) => value === 'PENDING');
    if (hasPending) {
      return null;
    }

    const hasFailure = conclusions.some((value) => {
      return value === 'FAILURE' || value === 'TIMED_OUT' || value === 'CANCELLED' || value === 'ACTION_REQUIRED';
    });
    if (hasFailure) {
      return 'FAILURE';
    }

    // All checks concluded — every check must have passed.
    const allPassed = conclusions.every((value) => value === 'SUCCESS' || value === 'NEUTRAL' || value === 'SKIPPED');
    return allPassed ? 'SUCCESS' : null;
  } catch (error) {
    console.warn(`Failed to fetch CI state for ${repo}#${number}:`, error);
    return null;
  }
}

// Auto-link PRs to task after agent completes work
// Strategy 1: Parse PR URLs directly from comment text (catches any branch name)
// Strategy 2: Scan GitHub for PRs with branch matching feature/{taskId}-*
async function autoLinkPRToTask(taskId: string, repo: string): Promise<void> {
  if (!taskId || !repo) {
    return;
  }

  try {
    console.log(`🔗 Auto-linking PRs for task ${taskId} in repo ${repo}...`);

    // Fetch the current task to check existing links
    const task = await getTask(taskId);
    if (!task) {
      console.warn(`⚠️  Task ${taskId} not found for auto-linking`);
      return;
    }

    // Get existing PR links to avoid duplicates
    const existingPRUrls = new Set(
      (task.links || [])
        .filter(link => link.type === 'pr' || link.url?.includes('/pull/'))
        .map(link => link.url)
    );

    // Strategy 1: Extract PR URLs directly from comment text
    // Agents often write "PR created: https://github.com/.../pull/N" — parse that
    const prUrlPattern = /https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/g;
    const commentPRUrls: string[] = [];
    for (const comment of task.comments || []) {
      const matches = comment.body?.match(prUrlPattern) || [];
      for (const url of matches) {
        if (!existingPRUrls.has(url) && !commentPRUrls.includes(url)) {
          commentPRUrls.push(url);
        }
      }
    }

    for (const url of commentPRUrls) {
      const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      if (!match) continue;
      const prNumber = parseInt(match[2]);
      console.log(`🔗 Found PR #${prNumber} in comment text — linking to task ${taskId}`);
      await addTaskLink(taskId, {
        url,
        title: `PR #${prNumber}`,
        type: 'pr',
      }, 'worker-auto-link');
      existingPRUrls.add(url);
    }

    // Strategy 2: Scan GitHub for open PRs with branch matching feature/{taskId}-*
    const branchPattern = `feature/${taskId}-`;

    const { stdout } = await execFile(
      'gh',
      ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,headRefName,url', '--limit', '20'],
      { timeout: 15000 }
    );

    let prs: Array<{ number: number; headRefName: string; url: string }> = [];
    try {
      prs = JSON.parse(stdout);
    } catch (parseError) {
      console.warn(`⚠️  Failed to parse gh pr list output: ${stdout}`);
      return;
    }

    // Filter PRs whose branch matches our pattern
    const matchingPRs = prs.filter(pr => pr.headRefName.startsWith(branchPattern));

    if (matchingPRs.length === 0 && commentPRUrls.length === 0) {
      console.log(`🔗 No matching PRs found via comment scan or branch pattern ${branchPattern}`);
      return;
    }

    console.log(`🔗 Found ${matchingPRs.length} matching PR(s) via branch pattern`);

    // Link each matching PR that's not already linked
    for (const pr of matchingPRs) {
      if (existingPRUrls.has(pr.url)) {
        console.log(`🔗 PR #${pr.number} already linked to task ${taskId}`);
        continue;
      }

      console.log(`🔗 Linking PR #${pr.number} (${pr.headRefName}) to task ${taskId}`);

      await addTaskLink(taskId, {
        url: pr.url,
        title: `PR #${pr.number}: ${pr.headRefName}`,
        type: 'pr'
      }, 'worker-auto-link');

      existingPRUrls.add(pr.url);
    }
  } catch (error) {
    // Don't fail the task if auto-linking fails - it's a best-effort operation
    console.warn(`⚠️  Auto-link failed for task ${taskId}:`, error);
  }
}

function getPersonaTriggerValue(persona: Persona, eventType: TriggerEventType): boolean {
  const defaults = BUILTIN_TRIGGER_DEFAULTS[persona.id] || {};
  const effectiveTriggers = { ...defaults, ...(persona.triggers || {}) };
  const val = effectiveTriggers[eventType];
  if (val === null || val === undefined || val === false) return false;
  if (val === true) return true;
  // PersonaTriggerConfig object — require explicit enabled: true to activate
  if (typeof val === 'object') return (val as any).enabled === true;
  return Boolean(val);
}

function evaluateTriggerConditions(persona: Persona, task: Task): boolean {
  const conditions = persona.triggers?.conditions;
  if (!conditions || conditions.length === 0) return true;
  // Delegate to the shared evaluateCondition from event-triggers.ts — no event
  // context available in the polling path, so metadata.* fields will be undefined.
  return conditions.every((cond) => evaluateFieldCondition(cond as any, task));
}

function getTriggeredPersonas(personas: Persona[], eventType: TriggerEventType, task?: Task): Persona[] {
  return personas.filter((persona) =>
    getPersonaTriggerValue(persona, eventType) &&
    (!task || evaluateTriggerConditions(persona, task))
  );
}

function buildTriggerInstruction(task: Task, eventType: TriggerEventType, details?: string, metadata?: any): string {
  const eventDescriptionMap: Record<TriggerEventType, string> = {
    onPROpened: 'A pull request was just linked/opened for this task.',
    onPRMerged: 'A linked pull request was just merged for this task.',
    onPRClosed: 'A linked pull request was just closed for this task.',
    onCIPassed: 'CI checks just passed for a linked pull request on this task.',
    onTestFailure: 'CI checks failed for a linked pull request on this task.',
    onTaskStarted: 'This task just moved from backlog to in-progress.',
    onCommentAdded: 'A new comment was added (PR review thread, plain PR comment, or task comment).',
  };

  const baseInstruction = [
    task.description,
    '',
    '## Trigger Event Context',
    eventDescriptionMap[eventType],
    ...(details ? [`Details: ${details}`] : []),
  ];

  // Add special context for comments (PR review threads, plain PR comments, or kanban task comments)
  if (eventType === 'onCommentAdded' && metadata) {
    baseInstruction.push('');
    
    if (metadata.taskId && !metadata.prNumber) {
      // Kanban task comment
      baseInstruction.push('## Kanban Task Comment');
      baseInstruction.push(`**Author:** ${metadata.author}`);
      baseInstruction.push(`**Created:** ${metadata.createdAt}`);
      baseInstruction.push('');
      baseInstruction.push('**Comment:**');
      baseInstruction.push(sanitizeForPrompt(metadata.body));
      baseInstruction.push('');
      baseInstruction.push('## Action Guidance');
      baseInstruction.push('DECIDE on the right action:');
      baseInstruction.push('1. **Reply** - Answer questions or acknowledge feedback');
      baseInstruction.push('2. **Fix** - If the comment points out an issue that needs addressing');
      baseInstruction.push('3. **Clarify** - Ask for more details if unclear');
      baseInstruction.push('4. **No action** - If the comment is just informational');
      baseInstruction.push('');
      baseInstruction.push('Add your response as a task comment via the tix-kanban API.');
    } else if (metadata.commentId && !metadata.threadId) {
      // Plain PR comment (not a review thread)
      baseInstruction.push('## PR Comment (Plain)');
      baseInstruction.push(`**PR:** ${metadata.repo}#${metadata.prNumber} (${metadata.prUrl})`);
      baseInstruction.push(`**Author:** ${metadata.author}`);
      baseInstruction.push(`**Comment URL:** ${metadata.commentUrl}`);
      baseInstruction.push('');
      baseInstruction.push('**Comment:**');
      baseInstruction.push(sanitizeForPrompt(metadata.body));
      baseInstruction.push('');
      baseInstruction.push('## Action Guidance');
      baseInstruction.push('DECIDE on the right action:');
      baseInstruction.push('1. **Reply only** - If the comment is informational or you can answer without code changes');
      baseInstruction.push('2. **Acknowledge + fix** - If the issue is valid and should be fixed in this PR');
      baseInstruction.push('3. **Ask for clarification** - If the comment is unclear or you need more context');
      baseInstruction.push('4. **Defer to follow-up ticket** - If the suggestion is valid but out of scope for this PR');
      baseInstruction.push('');
      baseInstruction.push(`Reply using: \`gh api repos/${metadata.repo}/issues/${metadata.prNumber}/comments -f body="your reply"\``);
    } else {
      // Review thread comment (original implementation)
      const commentId = metadata.firstComment?.databaseId || metadata.commentId || '[comment_id]';
      baseInstruction.push('## Review Thread Comment');
      baseInstruction.push(`**PR:** ${metadata.repo}#${metadata.prNumber} (${metadata.prUrl})`);
      baseInstruction.push(`**Author:** ${metadata.firstComment?.author || metadata.author}`);
      if (metadata.firstComment?.path || metadata.path) {
        baseInstruction.push(`**File:** ${metadata.firstComment?.path || metadata.path}${metadata.firstComment?.line || metadata.line ? `:${metadata.firstComment?.line || metadata.line}` : ''}`);
      }
      baseInstruction.push('');
      baseInstruction.push('**Comment:**');
      baseInstruction.push(sanitizeForPrompt(metadata.firstComment?.body || metadata.body));
      
      if (metadata.allComments && metadata.allComments.length > 1) {
        baseInstruction.push('');
        baseInstruction.push('**Thread Context (previous comments):**');
        metadata.allComments.slice(1).forEach((comment: any, i: number) => {
          baseInstruction.push(`${i + 2}. ${comment.author} (${comment.createdAt}): ${sanitizeForPrompt(comment.body)}`);
        });
      }
      
      baseInstruction.push('');
      baseInstruction.push('## Action Guidance');
      baseInstruction.push('DECIDE on the right action:');
      baseInstruction.push('1. **Reply only** - If the comment is informational or you can answer without code changes');
      baseInstruction.push('2. **Acknowledge + fix** - If the issue is valid and should be fixed in this PR');
      baseInstruction.push('3. **Ask for clarification** - If the comment is unclear or you need more context');
      baseInstruction.push('4. **Defer to follow-up ticket** - If the suggestion is valid but out of scope for this PR');
      baseInstruction.push('');
      baseInstruction.push(`Reply on the GitHub review thread using: \`gh api repos/${metadata.repo}/pulls/comments/${commentId}/replies -f body="your reply"\``);
    }
  }

  baseInstruction.push('');
  baseInstruction.push('Take the action implied by your persona role for this trigger and summarize concrete outputs.');

  return baseInstruction.join('\n');
}

async function invokeTriggerPersona(
  task: Task,
  persona: Persona,
  eventType: TriggerEventType,
  details?: string,
  metadata?: any
): Promise<void> {
  try {
    const requiredProviders = getRequiredProviders(task);
    for (const provider of requiredProviders) {
      enforceProviderAccess(persona, provider);
    }

    const triggeredTask: Task = {
      ...task,
      description: buildTriggerInstruction(task, eventType, details, metadata),
    };
    const aiResult = await spawnAISession(triggeredTask, persona);

    const triggerComment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      taskId: task.id,
      body: `🔔 Trigger \`${eventType}\` (${persona.name})\n\n${aiResult.output || 'No output generated.'}`,
      author: `${persona.name} (AI Trigger)`,
      createdAt: new Date(),
    };

    const latestTask = await getTask(task.id);
    if (!latestTask) return;
    await updateTask(task.id, {
      comments: [...(latestTask.comments || []), triggerComment],
    });

    await updatePersonaMemoryAfterTask(
      persona.id,
      `${task.title} [trigger:${eventType}]`,
      task.description,
      aiResult.output,
      aiResult.success
    );
  } catch (error) {
    console.error(`Failed to invoke trigger persona ${persona.id} for task ${task.id}:`, error);
  }
}

async function processEventBasedPersonaTriggers(tasks: Task[]): Promise<void> {
  const triggerState = await loadWorkerTriggerState();
  const personas = await getAllPersonas();

  const pendingInvocations = new Map<string, { task: Task; persona: Persona; eventType: TriggerEventType; details: string[]; metadata?: any }>();

  const enqueueInvocation = (task: Task, persona: Persona, eventType: TriggerEventType, detail: string, metadata?: any): void => {
    // Include threadId or commentId in key for onCommentAdded to avoid overwriting multiple threads/comments
    const threadIdSuffix = eventType === 'onCommentAdded' && metadata?.threadId ? `|${metadata.threadId}` : '';
    const commentIdSuffix = eventType === 'onCommentAdded' && metadata?.commentId && !metadata.threadId ? `|${metadata.commentId}` : '';
    const key = `${task.id}|${persona.id}|${eventType}${threadIdSuffix}${commentIdSuffix}`;
    const existing = pendingInvocations.get(key);
    if (existing) {
      existing.details.push(detail);
      // Merge metadata if provided
      if (metadata) {
        existing.metadata = { ...existing.metadata, ...metadata };
      }
      return;
    }
    pendingInvocations.set(key, { task, persona, eventType, details: [detail], metadata });
  };

  // Trigger when a task moves from backlog to in-progress.
  for (const task of tasks) {
    const taskState = triggerState.tasks[task.id] || { prs: {} };
    if ((taskState.lastStatus === 'backlog' || taskState.lastStatus === undefined) && task.status === 'in-progress') {
      // Fire onTaskStarted for both the known backlog→in-progress transition and for tasks
      // first observed already in in-progress (no prior state). Both cases are semantically
      // "task started" — using a single key ensures all subscribed personas are invoked.
      for (const persona of getTriggeredPersonas(personas, 'onTaskStarted', task)) {
        enqueueInvocation(task, persona, 'onTaskStarted', `Task ${task.id} moved ${taskState.lastStatus ?? 'unknown'} -> in-progress`);
      }
    }
    taskState.lastStatus = task.status;
    triggerState.tasks[task.id] = taskState;
  }

  // Scan any task that could have linked PRs, not just review-status tasks
  const tasksWithPRs = tasks.filter((task) =>
    ['review', 'in-progress', 'auto-review'].includes(task.status as string) ||
    (task.links || []).some(l => l.type === 'pr' || l.url?.includes('/pull/'))
  );
  for (const task of tasksWithPRs) {
    const fullTask = await getTask(task.id);
    if (!fullTask) continue;

    const prLinks = parsePRLinks(fullTask.links);
    const taskState = triggerState.tasks[task.id] || { prs: {}, lastStatus: task.status };
    const newSnapshots: Record<string, PRSnapshot> = {};

    for (const pr of prLinks) {
      const previous = taskState.prs[pr.key];
      const state = await getPRState(pr.repo, pr.number);
      if (state === null) {
        // Preserve the last known snapshot on transient state lookup failures.
        // Mark as stale so auto-merge logic can skip to avoid false positives.
        if (previous) {
          newSnapshots[pr.key] = { ...previous, stale: true };
        }
        continue;
      }
      const ciState = await getPRCIState(pr.repo, pr.number);
      // On transient CI fetch failure, preserve the last known ciState so the snapshot
      // still reflects the valid new PR state (e.g. open→merged) without losing CI history.
      const effectiveCiState = ciState ?? previous?.ciState ?? null;
      
      // Migration case: previous exists but seenThreadIds field is missing (pre-change persisted state)
      // Treat same as first observation - populate from existing threads without triggering
      const isMigration = previous && previous.seenThreadIds === undefined;
      
      // Migration case for seenCommentIds: previous exists but seenCommentIds field is missing
      const isCommentMigration = previous && previous.seenCommentIds === undefined;
      
      // First observation: pre-populate seenThreadIds with existing threads so they 
      // don't fire spuriously on next poll (avoids the bug where empty seenThreadIds 
      // on first poll causes all existing threads to appear "new" on second poll)
      let seenThreadIds: string[] = [];
      let seenCommentIds: string[] = [];
      let unresolvedThreads: ReviewThread[] = [];
      if (!previous || isMigration || isCommentMigration) {
        const threads = await getPRReviewThreads(pr.repo, pr.number);
        unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);
        seenThreadIds = unresolvedThreads.map(t => t.id + ':' + t.comments.length);
        
        // Also pre-populate plain comments
        const plainComments = await getPRComments(pr.repo, pr.number);
        seenCommentIds = plainComments.map(c => c.id);
      } else {
        seenThreadIds = previous.seenThreadIds || [];
        seenCommentIds = previous.seenCommentIds || [];
        // For subsequent observations, recalculate unresolved threads for accurate snapshot
        const threads = await getPRReviewThreads(pr.repo, pr.number);
        unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);
      }
      
      const current: PRSnapshot = { 
        state, 
        ciState: effectiveCiState,
        seenThreadIds,
        lastThreadCheck: new Date().toISOString(),
        seenCommentIds,
        lastCommentCheck: new Date().toISOString(),
        hasUnresolvedThreads: unresolvedThreads.length > 0,
        mergeable: state === 'open' ? await getPRMergeableState(pr.repo, pr.number) : undefined,
      };
      newSnapshots[pr.key] = current;

      if (!previous || isMigration) {
        // First observation OR migration: only fire onPROpened (PR was just linked to this task)
        // Don't fire onPRMerged/onCIPassed — those would be spurious for pre-existing state
        if (state === 'open') {
          const threads = await getPRReviewThreads(pr.repo, pr.number);
          const unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);
          seenThreadIds = unresolvedThreads.map(t => t.id + ':' + t.comments.length);
          current.seenThreadIds = seenThreadIds;
          
          // Only fire onPROpened for genuinely new observations, not migrations
          if (!isMigration) {
            for (const persona of getTriggeredPersonas(personas, 'onPROpened', fullTask)) {
              enqueueInvocation(fullTask, persona, 'onPROpened', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
            }
          }
        }
      } else {
        // Subsequent observations: fire on state transitions and check for new threads
        if (state === 'open') {
          const threads = await getPRReviewThreads(pr.repo, pr.number);
          const unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);
          
          // Fire onCommentAdded only for NEW unresolved threads (not seen before).
          // Skip threads we've already processed to avoid duplicate invocations.
          // Use composite key (threadId:commentCount) to catch follow-up comments.
          for (const thread of unresolvedThreads) {
            const threadKey = thread.id + ':' + thread.comments.length;
            if (seenThreadIds.includes(threadKey)) {
              continue; // Already processed this thread at this comment count
            }
            
            const firstComment = thread.comments[0];
            if (firstComment) {
              // Mark thread as seen BEFORE enqueueing to prevent duplicates on crash
              seenThreadIds.push(threadKey);
              current.seenThreadIds = seenThreadIds;
              
              const metadata = {
                prUrl: pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`,
                prNumber: pr.number,
                repo: pr.repo,
                threadId: thread.id,
                firstComment: {
                  id: firstComment.id,
                  author: firstComment.author,
                  body: firstComment.body,
                  path: firstComment.path,
                  line: firstComment.line,
                  createdAt: firstComment.createdAt,
                },
                allComments: thread.comments.map(c => ({
                  id: c.id,
                  author: c.author,
                  body: c.body,
                  createdAt: c.createdAt,
                })),
              };
              
              for (const persona of getTriggeredPersonas(personas, 'onCommentAdded', fullTask)) {
                enqueueInvocation(fullTask, persona, 'onCommentAdded', `Unresolved review comment on ${pr.repo}#${pr.number} by ${firstComment.author}: ${firstComment.body.substring(0, 100)}...`, metadata);
              }
            }
          }

          // Also check for plain PR comments (not review threads)
          // During migration, use current.seenCommentIds (pre-populated) not previous (which is undefined)
          seenCommentIds = isCommentMigration ? current.seenCommentIds : (previous?.seenCommentIds || []);
          const plainComments = await getPRComments(pr.repo, pr.number);
          
          // Filter bot authors
          const BOT_AUTHORS = ['github-actions[bot]', 'cursor', 'jenna@dwlf.co.uk'];
          const humanComments = plainComments.filter(c => !BOT_AUTHORS.includes(c.author) && !c.author.includes('[bot]'));
          
          for (const comment of humanComments) {
            if (!seenCommentIds.includes(comment.id)) {
              // New plain comment detected
              const metadata = {
                prUrl: pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`,
                prNumber: pr.number,
                repo: pr.repo,
                commentId: comment.id,
                author: comment.author,
                body: comment.body,
                createdAt: comment.createdAt,
                commentUrl: comment.url,
              };
              
              for (const persona of getTriggeredPersonas(personas, 'onCommentAdded', fullTask)) {
                enqueueInvocation(fullTask, persona, 'onCommentAdded', `New PR comment on ${pr.repo}#${pr.number} by ${comment.author}: ${comment.body.substring(0, 100)}...`, metadata);
              }
              seenCommentIds.push(comment.id);
            }
          }
          current.seenCommentIds = seenCommentIds;
          current.lastCommentCheck = new Date().toISOString();
        }

        if (state === 'open' && previous.state !== 'open') {
          for (const persona of getTriggeredPersonas(personas, 'onPROpened', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onPROpened', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }

        if (state === 'merged' && previous.state !== 'merged') {
          for (const persona of getTriggeredPersonas(personas, 'onPRMerged', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onPRMerged', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }

        if (state === 'closed' && previous.state !== 'closed') {
          for (const persona of getTriggeredPersonas(personas, 'onPRClosed', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onPRClosed', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }

        if (ciState === 'SUCCESS' && previous.ciState !== 'SUCCESS') {
          for (const persona of getTriggeredPersonas(personas, 'onCIPassed', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onCIPassed', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }

        if (ciState === 'FAILURE' && previous.ciState !== 'FAILURE') {
          for (const persona of getTriggeredPersonas(personas, 'onTestFailure', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onTestFailure', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }
      }
    }

    // Merge new snapshots into existing map — preserve state for PRs not in current scan
    // (e.g. temporarily unlinked PRs) so they aren't treated as newly observed on re-link.
    taskState.prs = { ...taskState.prs, ...newSnapshots };
    taskState.lastStatus = fullTask.status;
    triggerState.tasks[task.id] = taskState;

    // If task is stranded in review (max cycles reached) and all PRs have now merged, close it
    const hasAutoReviewNote = fullTask.comments?.some(
      (c) => c.body?.includes('Keeping this task in review until at least one linked PR is merged')
    );
    let taskMarkedDoneByStrandedHandler = false;
    if (hasAutoReviewNote && prLinks.length > 0) {
      // Match isPRMerged semantics: any linked PR merged is sufficient to close the task
      const anyMerged = prLinks.some((pr) => newSnapshots[pr.key]?.state === 'merged');
      if (anyMerged) {
        console.log(`✅ Linked PR merged for stranded review task ${task.id} — marking done`);
        await updateTask(task.id, { status: 'done' });
        taskMarkedDoneByStrandedHandler = true;
        // Update persona stats if we know which persona worked this task
        const workerId = fullTask.persona;
        if (workerId) {
          const completionTimeMs = Date.now() - new Date(fullTask.createdAt).getTime();
          await updatePersonaStats(workerId, completionTimeMs / 60000, true).catch(() => {});
        }
        // Clean up review state to avoid re-processing
        await deleteTaskReviewState(task.id).catch(() => {});
      }
    }

    // Clean PR detection — two-cycle auto-merge
    // Only process tasks in review or verified status with linked PRs
    // Skip if human has explicitly held for manual merge
    // Skip if task was already marked done by stranded-review handler
    if (!taskMarkedDoneByStrandedHandler && ['review', 'verified'].includes(fullTask.status as string) && prLinks.length > 0 && !fullTask.holdForMerge) {
      const linkedPR = prLinks[0]; // Use first linked PR for auto-merge decision
      const prSnapshot = newSnapshots[linkedPR.key];
      
      // PR is clean if: open, no unresolved threads, mergeable (not conflicting), and snapshot is fresh (not stale)
      const isClean = prSnapshot && !prSnapshot.stale && prSnapshot.state === 'open' && prSnapshot.hasUnresolvedThreads === false && prSnapshot.mergeable === 'MERGEABLE';
      
      if (isClean) {
        // Check CI — passing or null (no required checks)
        const ciPassing = prSnapshot.ciState === 'SUCCESS' || prSnapshot.ciState === null;
        
        if (ciPassing) {
          const taskComments = fullTask.comments || [];
          const verifiedComment = taskComments.find((c: any) => c.body?.includes('✅ PR verified clean'));
          
          if (!verifiedComment) {
            // First clean observation — post verified comment, move to verified
            const verifiedCommentBody = '✅ PR verified clean — CI passing, no conflicts, all threads resolved. Will auto-merge next cycle if still clean.';
            console.log(`🔔 PR ${linkedPR.repo}#${linkedPR.number} verified clean for task ${fullTask.id} — moving to verified`);
            
            const newComment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              taskId: fullTask.id,
              body: verifiedCommentBody,
              author: 'Worker (system)',
              createdAt: new Date(),
            };
            
            await updateTask(fullTask.id, { 
              status: 'verified',
              comments: [...taskComments, newComment]
            });
            
            // Update trigger state to reflect new status
            taskState.lastStatus = 'verified';
          } else {
            // Already verified — check if still clean and no new human comments
            const verifiedAt = new Date(verifiedComment.createdAt);
            
            // Filter for human comments (exclude bots and system)
            const humanTaskComments = taskComments.filter((c: any) => {
              const botPatterns = ['jenna@dwlf.co.uk', 'System', 'Worker (system)', 'AI Trigger', 'AI Reviewer', 'PR Monitor', '(system)', '[bot]'];
              return !botPatterns.some(pattern => c.author?.includes(pattern));
            });
            
            const humanCommentAfterVerified = humanTaskComments.some((c: any) => 
              new Date(c.createdAt) > verifiedAt
            );
            
            if (!humanCommentAfterVerified) {
              // Safe to merge — attempt auto-merge
              console.log(`🔔 Attempting auto-merge for PR ${linkedPR.repo}#${linkedPR.number} (task ${fullTask.id})`);
              
              try {
                const mergeResult = await execFile(
                  'gh',
                  ['pr', 'merge', String(linkedPR.number), '--repo', linkedPR.repo, '--squash', '--delete-branch', '--admin'],
                  { timeout: 30000 }
                );
                
                // Verify merge actually succeeded
                const confirmState = await getPRState(linkedPR.repo, linkedPR.number);
                if (confirmState === 'merged') {
                  console.log(`✅ Auto-merged PR ${linkedPR.repo}#${linkedPR.number} for task ${fullTask.id}`);
                  
                  const mergedComment: Comment = {
                    id: Math.random().toString(36).substr(2, 9),
                    taskId: fullTask.id,
                    body: `✅ PR #${linkedPR.number} auto-merged after two clean cycles — done`,
                    author: 'Worker (system)',
                    createdAt: new Date(),
                  };
                  
                  const finalComments = [...taskComments, mergedComment];
                  await updateTask(fullTask.id, { 
                    status: 'done',
                    comments: finalComments
                  });
                  
                  // Update persona stats if we know which persona worked this task
                  const workerId = fullTask.persona;
                  if (workerId) {
                    const completionTimeMs = Date.now() - new Date(fullTask.createdAt).getTime();
                    await updatePersonaStats(workerId, completionTimeMs / 60000, true).catch(() => {});
                  }
                } else {
                  console.warn(`⚠️ Auto-merge attempted but PR state is ${confirmState} for ${linkedPR.repo}#${linkedPR.number}`);
                }
              } catch (mergeError) {
                console.warn(`⚠️ Auto-merge failed for ${linkedPR.repo}#${linkedPR.number}:`, mergeError);
              }
            } else {
              // Human commented after verified — don't auto-merge
              console.log(`ℹ️ PR ${linkedPR.repo}#${linkedPR.number} clean but human commented after verified — skipping auto-merge for task ${fullTask.id}`);
            }
          }
        }
      }
    }
  }

  // Check for new kanban task comments (MUST be before invocation processing)
  for (const task of tasks) {
    if (!task.comments || task.comments.length === 0) continue;
    
    const taskState = triggerState.tasks[task.id] || { prs: {}, lastStatus: task.status };
    const lastSeenId = taskState.lastSeenTaskCommentId;
    
    // Filter bot/AI/system comments to prevent trigger loops
    const BOT_AUTHOR_PATTERNS = [
      'jenna@dwlf.co.uk', 'System', 'Worker (system)',
      'AI Trigger', 'AI Reviewer', 'PR Monitor', '(system)',
    ];
    const humanComments = task.comments.filter(c => !BOT_AUTHOR_PATTERNS.some(bot => c.author.includes(bot)));
    
    if (humanComments.length === 0) continue;
    
    // Sort comments by creation time (oldest first)
    const sortedComments = [...humanComments].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    // First observation guard: if lastSeenId is undefined, pre-populate with latest comment
    // without firing notification (avoids spurious onCommentAdded for old comments)
    if (lastSeenId === undefined) {
      const latestComment = sortedComments[sortedComments.length - 1];
      taskState.lastSeenTaskCommentId = latestComment.id;
      triggerState.tasks[task.id] = taskState;
      continue;
    }
    
    // Actually find and process all comments after the last seen one
    // Handle case where lastSeenId was deleted (not found in comments)
    const lastSeenExists = sortedComments.some(c => c.id === lastSeenId);
    let foundLastSeen = !lastSeenId || !lastSeenExists; // if no lastSeenId or it was deleted, process all
    let lastProcessedCommentId = lastSeenId;
    
    for (const comment of sortedComments) {
      // Skip until we've passed the lastSeenId
      if (!foundLastSeen) {
        if (comment.id === lastSeenId) {
          foundLastSeen = true;
        }
        continue;
      }
      
      const metadata = {
        taskId: task.id,
        commentId: comment.id,
        author: comment.author,
        body: comment.body,
        createdAt: comment.createdAt,
      };
      
      for (const persona of getTriggeredPersonas(personas, 'onCommentAdded', task)) {
        enqueueInvocation(task, persona, 'onCommentAdded', `New task comment by ${comment.author}: ${comment.body.substring(0, 100)}...`, metadata);
      }
      
      lastProcessedCommentId = comment.id;
    }
    
    // Update the last seen ID to the latest processed comment
    if (lastProcessedCommentId !== lastSeenId) {
      taskState.lastSeenTaskCommentId = lastProcessedCommentId;
    }
    
    triggerState.tasks[task.id] = taskState;
  }

  if (pendingInvocations.size > 0) {
    console.log(`🔔 Processing ${pendingInvocations.size} persona trigger invocation(s)...`);
  }
  for (const invocation of pendingInvocations.values()) {
    await invokeTriggerPersona(
      invocation.task,
      invocation.persona,
      invocation.eventType,
      invocation.details.join('; '),
      invocation.metadata
    );
  }

  const existingTaskIds = new Set(tasks.map((task) => task.id));
  for (const taskId of Object.keys(triggerState.tasks)) {
    if (!existingTaskIds.has(taskId)) {
      delete triggerState.tasks[taskId];
    }
  }

  await saveWorkerTriggerState(triggerState);
}

// Spawn AI session for a task using OpenClaw
async function spawnAISession(task: Task, persona: Persona): Promise<{ output: string; success: boolean }> {
  try {
    console.log(`🤖 Spawning AI session for task: ${task.title}`);
    
    // Create context with memory injection and full task history
    let additionalContext = '';
    if (task.repo) additionalContext += `Repository: ${task.repo}\n`;
    
    if (task.comments?.length) {
      additionalContext += `\n## Previous Comments (${task.comments.length})\n`;
      task.comments.forEach((comment, index) => {
        // Sanitize comment body to prevent prompt injection
        const sanitizedBody = sanitizeForPrompt(comment.body);
        additionalContext += `Comment ${index + 1}: ${sanitizedBody}\n`;
      });
    }
    
    if (task.links?.length) {
      additionalContext += `\n## Previous Links (${task.links.length})\n`;
      task.links.forEach((link, index) => {
        // Sanitize link content to prevent prompt injection
        const sanitizedTitle = sanitizeForPrompt(link.title);
        const sanitizedUrl = sanitizeForPrompt(link.url);
        additionalContext += `Link ${index + 1}: ${sanitizedTitle} - ${sanitizedUrl}\n`;
      });
    }

    // Fetch branch info for linked PRs
    const prBranches = await getPRBranchInfo(task.links);
    // Check if this is a code review task (even without PR links)
    if (isCodeReviewTask(task, persona)) {
      additionalContext += `\n## 📋 CODE REVIEW TASK - USE LGTM TOOL\n`;
      additionalContext += `This is a code review task. You should use the lgtm tool to perform a thorough review.\n\n`;

      if (prBranches.length > 0) {
        // We have specific PRs to review
        for (const pr of prBranches) {
          additionalContext += `- **PR #${pr.number}** (${pr.repo})\n`;
          additionalContext += `  Review command: \`lgtm review ${pr.number} --full-context --usage-context --dry-run\`\n`;
          additionalContext += `  Repository: ${pr.repo}\n`;
        }
      } else {
        // No PR links yet, provide general instructions
        additionalContext += `No specific PR was provided. To use lgtm, you need:\n`;
        additionalContext += `1. Navigate to the repository directory\n`;
        additionalContext += `2. Run: \`lgtm review <PR_NUMBER> --full-context --usage-context --dry-run\`\n`;
        additionalContext += `3. Replace <PR_NUMBER> with the actual pull request number\n\n`;
        additionalContext += `If a PR number is mentioned in the task description or comments, use that.\n`;
        additionalContext += `Otherwise, ask for clarification about which PR to review.\n`;
      }

      additionalContext += `\nPerform a thorough code review using lgtm, analyze the output, and provide actionable feedback.\n`;
      additionalContext += `Focus on: security issues, bugs, code quality, test coverage, and best practices.\n`;
    } else if (prBranches.length > 0) {
      // Not a code review task, but has linked PRs - work on existing branches
      additionalContext += `\n## ⚠️ EXISTING PR(S) — WORK ON THESE BRANCHES\n`;
      additionalContext += `This task already has linked PR(s). You MUST work on the existing branch(es) rather than creating new ones.\n\n`;
      for (const pr of prBranches) {
        additionalContext += `- **PR #${pr.number}** (${pr.repo}): branch \`${pr.branch}\`\n`;
        additionalContext += `  Checkout: \`git fetch origin && git checkout ${pr.branch} && git pull origin ${pr.branch}\`\n`;
      }
    }

    const { prompt, tokenCount, memoryTruncated, sessionId } = await createPersonaContext(
      persona.id,
      task.title,
      task.description,
      task.tags,
      additionalContext || undefined
    );
    
    if (memoryTruncated) {
      console.log(`⚠️  Memory truncated for persona ${persona.id} due to token limits`);
    }
    
    console.log(`📊 Generated prompt with ${tokenCount.toLocaleString()} estimated tokens`);
    console.log(`📋 Task context includes: ${task.comments?.length || 0} comments, ${task.links?.length || 0} links`);
    
    // Add task context to session as a user message
    // Wrap in try-catch to allow task execution even if logging fails
    const taskContextMessage = `## Task: ${task.title}\n\n${task.description}\n\nTags: ${task.tags.join(', ')}\n\n${additionalContext}`;
    try {
      await addSessionMessage(sessionId, 'user', taskContextMessage, {
        taskId: task.id,
        taskTitle: task.title,
      });
    } catch (compactionError) {
      console.error(`Failed to add user message (compaction error) for task ${task.id}:`, compactionError);
      // Continue with task execution - session logging is non-essential
    }
    
    // Determine working directory for Claude CLI
    let cwd: string | undefined;
    try {
      const settings = await getUserSettings();
      if (task.repo) {
        // 1. Check per-repo path mapping first
        if (settings.repoPaths?.[task.repo]) {
          cwd = settings.repoPaths[task.repo];
        } else if (settings.workspaceDir) {
          // 2. Fall back to workspaceDir/repoName
          const repoName = task.repo.split('/').pop();
          if (repoName) {
            cwd = path.join(settings.workspaceDir, repoName);
          } else {
            cwd = settings.workspaceDir;
          }
        }
      } else if (settings.workspaceDir) {
        cwd = settings.workspaceDir;
      }
      if (cwd) {
        console.log(`🗂️  Using workspace directory: ${cwd}`);
      }
    } catch (error) {
      console.error('Failed to load workspace directory setting:', error);
    }

    // Resolve model: task model > persona model > system default
    const model = resolveModelAlias((task as any).model || persona?.model || undefined);

    // Use Claude CLI with prompt via stdin (secure approach - no temp files, no shell injection)
    const { stdout, stderr } = await executeClaudeWithStdin(
      prompt, 
      ['--dangerously-skip-permissions', '--allowedTools', 'Edit,exec,Read,Write'],
      (task as any).timeoutMs || (persona.id.toLowerCase().includes('tech-writer') ? 900000 : 320000), // task override > persona default
      cwd,
      model,
      'task'
    );
    
    if (stderr) {
      console.error(`AI session stderr:`, stderr);
    }
    
    const output = stdout.trim();
    const success = !stderr && output.length > 0;
    
    // Track token usage (estimate: ~4 chars per token)
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(output.length / 4);
    
    // Record token usage for monthly budget tracking
    const { recordTokenUsage } = await import('./collaboration-budget.js');
    const monthlyTokenLimit = persona.budgetCap?.monthlyTokens || 0;
    try {
      await recordTokenUsage(persona.id, inputTokens, outputTokens, monthlyTokenLimit);
    } catch (budgetError) {
      console.error(`Failed to record token usage for ${persona.id}:`, budgetError);
    }
    
    // Add AI output to session as an assistant message
    // Wrap in try-catch to preserve successful output even if compaction fails
    try {
      await addSessionMessage(sessionId, 'assistant', output, {
        taskId: task.id,
        success,
      });
    } catch (compactionError) {
      console.error(`Failed to add message (compaction error) for task ${task.id}:`, compactionError);
      // Preserve the successful output - compaction can be retried later
    }
    
    return { output, success };
  } catch (error) {
    console.error(`Failed to spawn AI session for task ${task.id}:`, error);
    return { output: `Error: ${error}`, success: false };
  }
}

// Check if task is a research task based on tags, keywords, or persona
function isResearchTask(task: Task, persona?: Persona): boolean {
  // Tech-writer persona always gets research treatment (longer timeout, report output)
  if (persona && persona.id.toLowerCase().includes('tech-writer')) {
    return true;
  }

  // Keywords that should only match against title (too common in regular dev tasks)
  const titleOnlyKeywords = ['document', 'documentation', 'architecture', 'analysis', 'report'];
  // Keywords that are explicit research indicators (can check description too)
  const explicitResearchKeywords = ['research', 'investigate', 'explore', 'rfc', 'adr', 'study', 'investigation', 'knowledge', 'article'];
  
  const titleLower = task.title.toLowerCase();
  const descriptionLower = task.description.toLowerCase();
  const tags = task.tags || [];

  // Check if task is explicitly tagged as research
  const allKeywords = [...titleOnlyKeywords, ...explicitResearchKeywords];
  if (tags.some(tag => allKeywords.includes(tag.toLowerCase()))) {
    return true;
  }

  // Check title for all keywords (both broad and explicit)
  const titleMatch = allKeywords.some(keyword => titleLower.includes(keyword));
  if (titleMatch) return true;

  // Check description only for explicit research indicators
  return explicitResearchKeywords.some(keyword =>
    descriptionLower.includes(keyword)
  );
}

// Check if task is a code review task that should use lgtm
function isCodeReviewTask(task: Task, persona?: Persona): boolean {
  // QA-Engineer and Code-Reviewer personas can perform code reviews
  if (persona && (persona.id.toLowerCase().includes('qa-engineer') || persona.id.toLowerCase().includes('code-reviewer'))) {
    // Check if task has PR links or review keywords
    const hasLinkedPR = task.links?.some(link =>
      link.type === 'pr' || link.url?.includes('/pull/')
    ) || false;

    const reviewKeywords = ['review', 'code review', 'pr review', 'pull request review', 'lgtm'];
    const lgtmKeywords = ['lgtm', 'use lgtm', 'lgtm tool', 'lgtm review'];
    const titleLower = task.title.toLowerCase();
    const descriptionLower = task.description.toLowerCase();
    const tags = task.tags || [];

    // Check if task is explicitly tagged for review
    if (tags.some(tag => reviewKeywords.includes(tag.toLowerCase()))) {
      return true;
    }

    // Check if task explicitly requests lgtm (regardless of PR links)
    const hasLgtmRequest = lgtmKeywords.some(keyword =>
      titleLower.includes(keyword) || descriptionLower.includes(keyword)
    );

    if (hasLgtmRequest) {
      return true;
    }

    // Check if title or description contains review keywords and has PR
    const hasReviewKeyword = reviewKeywords.some(keyword =>
      titleLower.includes(keyword) || descriptionLower.includes(keyword)
    );

    return hasLinkedPR && hasReviewKeyword;
  }

  return false;
}

export function getRequiredProviders(task: Task): string[] {
  const requiredProviders: string[] = [];
  if (task.repo) {
    requiredProviders.push('github');
  }
  return requiredProviders;
}

async function handleProviderDenial(task: Task, provider: string, reason: string): Promise<void> {
  const latestTask = await getTask(task.id);
  const currentTask = latestTask ?? task;

  const denialComment: Comment = {
    id: Math.random().toString(36).substr(2, 9),
    taskId: currentTask.id,
    body: `⚠️ **Provider access denied**: ${reason}\n\nThis task requires the persona to have access to the \`${provider}\` provider. Assign a persona with the required provider access to unblock this task.`,
    author: 'Worker (system)',
    createdAt: new Date(),
  };

  await updateTask(currentTask.id, {
    status: 'review',
    agentActivity: undefined,
    comments: [...(currentTask.comments || []), denialComment],
  });
}

// Handle research tasks by generating reports instead of code
async function processResearchTask(task: Task, persona: Persona): Promise<{ success: boolean; reportId?: string }> {
  try {
    console.log(`🔍 Processing research task: ${task.title}`);
    
    // Create research-specific prompt context
    let additionalContext = 'This is a RESEARCH task. Your goal is to produce a comprehensive markdown report that can be saved and referenced later.\n\n';
    
    if (task.comments?.length) {
      additionalContext += `## Previous Comments (${task.comments.length})\n`;
      task.comments.forEach((comment, index) => {
        const sanitizedBody = sanitizeForPrompt(comment.body);
        additionalContext += `Comment ${index + 1}: ${sanitizedBody}\n`;
      });
    }
    
    additionalContext += `\n## Research Task Instructions
- Produce a well-structured markdown report
- Include a brief summary/executive summary at the top
- Use proper headings and organization
- Include relevant links, references, or data sources
- End with conclusions or recommendations if applicable
- The report should be complete and self-contained
`;
    
    const { prompt, tokenCount, sessionId } = await createPersonaContext(
      persona.id,
      `Research Task: ${task.title}`,
      task.description,
      [...(task.tags || []), 'research'],
      additionalContext
    );
    
    console.log(`📊 Generated research prompt with ${tokenCount.toLocaleString()} tokens`);
    
    // Resolve model: task model > persona model > system default
    const researchModel = resolveModelAlias((task as any).model || persona?.model || undefined);

    // Execute research with Claude CLI
    const { stdout, stderr } = await executeClaudeWithStdin(
      prompt,
      ['--dangerously-skip-permissions', '--allowedTools', 'web_search,web_fetch,Read'],
      (task as any).timeoutMs || 600000, // task override > 10 min default for research
      undefined, // No specific working directory needed for research
      researchModel,
      'research'
    );
    
    if (stderr) {
      console.error(`Research task stderr:`, stderr);
    }
    
    const reportContent = stdout.trim();
    if (!reportContent || reportContent.length < 100) {
      console.error(`Research task produced insufficient output: ${reportContent.length} chars`);
      return { success: false };
    }
    
    // Track token usage for research (estimate: ~4 chars per token)
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(reportContent.length / 4);
    
    // Record token usage for monthly budget tracking
    const { recordTokenUsage } = await import('./collaboration-budget.js');
    const monthlyTokenLimit = persona.budgetCap?.monthlyTokens || 0;
    try {
      await recordTokenUsage(persona.id, inputTokens, outputTokens, monthlyTokenLimit);
    } catch (budgetError) {
      console.error(`Failed to record token usage for ${persona.id}:`, budgetError);
    }
    
    // Log research task to persona session
    try {
      const researchTaskMessage = `## Research Task: ${task.title}\n\n${task.description}\n\nTags: ${[...(task.tags || []), 'research'].join(', ')}\n\n${additionalContext}`;
      await addSessionMessage(sessionId, 'user', researchTaskMessage, {
        taskId: task.id,
        taskTitle: task.title,
      });
      await addSessionMessage(sessionId, 'assistant', reportContent, {
        taskId: task.id,
        taskTitle: task.title,
        type: 'research-report',
      });
    } catch (logError) {
      console.error(`Failed to log research to session for task ${task.id}:`, logError);
      // Continue - session logging is non-essential
    }
    
    // Generate title and summary from the task
    const reportTitle = task.title.startsWith('Research:') ? task.title : `Research: ${task.title}`;
    const reportSummary = `Research report generated for task: ${task.title}`;
    
    // Save report to filesystem
    const report = await saveReport(reportTitle, reportContent, {
      summary: reportSummary,
      tags: [...(task.tags || []), 'research', 'ai-generated'],
      taskId: task.id,
      slug: task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    });
    
    console.log(`📄 Research report saved: ${report.filename}`);
    return { success: true, reportId: report.id };
    
  } catch (error) {
    console.error(`Failed to process research task ${task.id}:`, error);
    return { success: false };
  }
}

// Run lgtm automated review and parse JSON output
async function runLgtmAutoReview(task: Task): Promise<{ success: boolean; output: string; shouldAdvance: boolean }> {
  // Helper to format lgtm result
  function formatLgtmResult(lgtmResult: any): { success: boolean; output: string; shouldAdvance: boolean } {
    const commentsPosted = lgtmResult.commentsPosted || 0;
    const duplicatesSkipped = lgtmResult.duplicatesSkipped || 0;
    const comments = lgtmResult.comments || [];

    if (commentsPosted === 0 && lgtmResult.success) {
      // No issues - ADVANCE
      return {
        success: true,
        output: `✅ **lgtm Review: PASSED**\n\nNo issues found. PR is ready for the next stage.${duplicatesSkipped > 0 ? `\n\n(${duplicatesSkipped} duplicate comments skipped)` : ''}`,
        shouldAdvance: true
      };
    } else if (commentsPosted > 0 && lgtmResult.success) {
      // Issues found - BOUNCE
      let issuesList = '';
      for (const comment of comments) {
        issuesList += `\n- **${comment.path}:${comment.line}** ${comment.severity ? `(${comment.severity})` : ''}\n  ${comment.body}\n`;
      }

      return {
        success: true,
        output: `⚠️ **lgtm Review: ISSUES FOUND**\n\nFound ${commentsPosted} issue(s) that need attention:${issuesList}\n\n${duplicatesSkipped > 0 ? `(${duplicatesSkipped} duplicate comments skipped)\n\n` : ''}Please address these issues and push an update.`,
        shouldAdvance: false
      };
    } else {
      // lgtm reported failure
      return {
        success: false,
        output: `⚠️ **lgtm Review: ERROR**\n\nlgtm review failed:\n\`\`\`\n${lgtmResult.error || 'Unknown error'}\n\`\`\`\n\nThis task needs manual review.`,
        shouldAdvance: false
      };
    }
  }

  try {
    // Extract PR information from task links
    const prLinks = parsePRLinks(task.links);
    if (prLinks.length === 0) {
      return {
        success: false,
        output: '⚠️ **lgtm Review: ERROR**\n\nNo linked PR found. Please link a PR to this task before running lgtm review.',
        shouldAdvance: false
      };
    }

    // Use the first PR link
    const pr = prLinks[0];
    
    // Determine workspace directory
    let cwd: string | undefined;
    try {
      const settings = await getUserSettings();
      if (task.repo) {
        if (settings.repoPaths?.[task.repo]) {
          cwd = settings.repoPaths[task.repo];
        } else if (settings.workspaceDir) {
          const repoName = task.repo.split('/').pop();
          if (repoName) {
            cwd = path.join(settings.workspaceDir, repoName);
          }
        }
      } else if (settings.workspaceDir) {
        // Fallback: try to infer repo from PR link
        const repoName = pr.repo.split('/').pop();
        if (repoName) {
          cwd = path.join(settings.workspaceDir, repoName);
        }
      }
    } catch (error) {
      console.warn('Failed to load workspace directory setting:', error);
    }

    if (!cwd) {
      return {
        success: false,
        output: '⚠️ **lgtm Review: ERROR**\n\nCould not determine repository workspace directory. Please configure workspaceDir in settings.',
        shouldAdvance: false
      };
    }

    console.log(`🔍 Running lgtm auto review for ${pr.repo}#${pr.number} in ${cwd}`);

    // Get lgtm binary path from environment or use default
    const lgtmBinary = process.env.LGTM_BINARY_PATH || 'lgtm';

    // Run lgtm with --auto --batch flags
    const { stdout, stderr } = await execFile(
      lgtmBinary,
      ['review', String(pr.number), '--auto', '--batch', '--full-context', '--usage-context', '--repo', pr.repo],
      { cwd, timeout: 300000, maxBuffer: 10 * 1024 * 1024 } // 5 min timeout, 10MB buffer
    );

    // Parse JSON output
    let lgtmResult: any;
    try {
      lgtmResult = JSON.parse(stdout);
    } catch (parseError) {
      return {
        success: false,
        output: `⚠️ **lgtm Review: ERROR**\n\nFailed to parse lgtm output as JSON:\n\`\`\`\n${stdout.substring(0, 500)}\n\`\`\`\n\nStderr:\n\`\`\`\n${stderr}\n\`\`\``,
        shouldAdvance: false
      };
    }

    // Check result and format output
    return formatLgtmResult(lgtmResult);
  } catch (error: any) {
    console.error('lgtm auto review failed:', error);

    // Handle non-zero exit code: lgtm may have written valid JSON to stdout even on failure
    if (error?.stdout) {
      const stdout = error.stdout.toString();
      try {
        const lgtmResult = JSON.parse(stdout);
        return formatLgtmResult(lgtmResult);
      } catch (parseError) {
        // stdout wasn't valid JSON, fall through to error handling
        console.error('Failed to parse lgtm stdout as JSON:', parseError);
      }
    }

    // Default error handling
    return {
      success: false,
      output: `⚠️ **lgtm Review: ERROR**\n\nFailed to run lgtm: ${error instanceof Error ? error.message : String(error)}`,
      shouldAdvance: false
    };
  }
}

// Check if this is an lgtm-reviewer persona task
function isLgtmReviewerTask(persona?: Persona): boolean {
  return persona?.id === 'lgtm-reviewer';
}

// Process a single task
async function processTask(task: Task): Promise<void> {
  try {
    console.log(`📋 Processing task: ${task.title}`);

    // Fetch the full task with all history (comments, links)
    const fullTask = await getTask(task.id);
    if (!fullTask) {
      console.error(`❌ Could not fetch full task ${task.id}`);
      return;
    }

    // Load persona
    const persona = fullTask.persona ? await getPersona(fullTask.persona) : null;
    if (!persona) {
      console.log(`⚠️  No persona found for task ${fullTask.id}, skipping`);
      return;
    }

    // Check if persona is paused due to budget exceeded
    const { isPersonaPaused } = await import('./collaboration-budget.js');
    const paused = await isPersonaPaused(persona.id);
    if (paused) {
      console.warn(`⚠️ Persona ${persona.name} is paused due to monthly budget exceeded, skipping task`);
      // Check if we already posted a budget-exceeded message recently to avoid spam
      const channelId = `task-${fullTask.id}`;
      const recentMessages = await getMessages(channelId, 5);
      const recentBudgetWarning = recentMessages.some(
        msg => msg.authorType === 'persona' && msg.content.includes('exceeded my monthly token budget')
      );
      if (!recentBudgetWarning) {
        // Post notification to task channel only if not recently posted
        await postTaskUpdate(fullTask, persona, `⚠️ I've exceeded my monthly token budget and am paused until next month. This task will be skipped for now.`);
      }
      return;
    }

    // Enforce provider access restrictions before proceeding
    // Determine required providers based on task properties
    const requiredProviders = getRequiredProviders(fullTask);
    // Add more provider detection here as needed.
    
    for (const provider of requiredProviders) {
      try {
        enforceProviderAccess(persona, provider);
      } catch (accessError) {
        // Persona is not allowed to access this provider.
        // Move to review so it does not get retried indefinitely.
        const denialMessage = accessError instanceof Error ? accessError.message : String(accessError);
        console.warn(`🚫 Provider access denied for task "${fullTask.title}": ${denialMessage}`);

        await handleProviderDenial(fullTask, provider, denialMessage);
        return;
      }
    }

    // Add session tracking
    addActiveSession(persona.id, fullTask.id);
    await saveWorkerState();

    // Move task to in-progress only after provider access checks pass
    await updateTask(task.id, { status: 'in-progress' });

    // Mark agent as actively working on this task
    await updateTask(task.id, {
      agentActivity: {
        personaId: persona.id,
        personaName: persona.name,
        personaEmoji: persona.emoji,
        status: 'working',
        startedAt: new Date(),
      }
    });

    // Track activity: task started
    await trackTaskStarted(persona.id, persona.name, fullTask);

    // Notify via chat that work is starting
    await postTaskUpdate(fullTask, persona, `Starting work on this task. I'll update you when I'm done.`);

    // Check task type and handle accordingly
    let output: string;
    let success: boolean;
    let reportId: string | undefined;
    let shouldAdvance: boolean = true; // For lgtm-reviewer: controls pipeline advancement
    
    if (isLgtmReviewerTask(persona)) {
      // Handle as lgtm automated review
      const lgtmResult = await runLgtmAutoReview(fullTask);
      success = lgtmResult.success;
      output = lgtmResult.output;
      shouldAdvance = lgtmResult.shouldAdvance;
      console.log(`🔍 lgtm review result: success=${success}, shouldAdvance=${shouldAdvance}`);
      // Track review completion for daily summaries (only when review actually completed, not errored)
      if (success) {
        const outcome = shouldAdvance ? 'approved' : 'changes-requested';
        await trackReviewCompleted(persona.id, persona.name, fullTask, outcome);
      }
    } else if (isResearchTask(fullTask, persona)) {
      // Handle as research task - generate report
      const researchResult = await processResearchTask(fullTask, persona);
      success = researchResult.success;
      reportId = researchResult.reportId;
      output = success 
        ? `✅ Research completed successfully. Report saved as: ${reportId}`
        : `❌ Research task failed. Please check the task details and try again.`;
    } else {
      // Handle as regular development task
      const aiResult = await spawnAISession(fullTask, persona);
      output = aiResult.output;
      success = aiResult.success;
    }
    
    // Update persona memory with learnings from this task
    await updatePersonaMemoryAfterTask(
      persona.id,
      fullTask.title,
      fullTask.description,
      output,
      success
    );
    
    // Add AI output as a comment to preserve work history
    const existingComments = fullTask.comments || [];
    const aiComment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      taskId: fullTask.id,
      body: output,
      author: `${persona.name} (AI)`,
      createdAt: new Date(),
    };
    const updatedComments = [...existingComments, aiComment];
    
    // If this was a research task and succeeded, add link to the report
    if (success && reportId && isResearchTask(fullTask, persona)) {
      try {
        await addTaskLink(fullTask.id, {
          url: `/reports/${reportId}`, // Local URL to the report
          title: `📄 Research Report: ${fullTask.title}`,
          type: 'attachment'
        });
        console.log(`🔗 Added report link to task ${fullTask.id}`);
      } catch (error) {
        console.error(`Failed to add report link to task ${fullTask.id}:`, error);
      }
    }
    
    // Clear agent activity - work is done
    const clearedActivity = { personaId: persona.id, personaName: persona.name, personaEmoji: persona.emoji, status: 'idle' as const, startedAt: new Date() };

    if (success) {
      // lgtm-reviewer tasks must go through pipeline logic (respects shouldAdvance)
      // Do NOT let research-task logic bypass pipeline bounce-back
      if (!isLgtmReviewerTask(persona) && isResearchTask(fullTask, persona)) {
        await updateTask(fullTask.id, {
          status: 'done',
          comments: updatedComments,
          agentActivity: clearedActivity,
        });
        console.log(`🔍 Research task completed: ${fullTask.title}`);

        await postTaskUpdate(fullTask, persona, `Research complete! The report has been saved. Moving this to done.`);

        // Track activity: task completed
        await trackTaskCompleted(persona.id, persona.name, fullTask);

        // Update persona stats
        const completionTimeMs = Date.now() - new Date(fullTask.createdAt).getTime();
        const completionTimeMinutes = completionTimeMs / (1000 * 60);
        await updatePersonaStats(persona.id, completionTimeMinutes, true);
        console.log(`📊 Updated stats for persona ${persona.name}`);
      } else {
        // Regular development tasks follow the normal review flow
        // Check if task is part of a pipeline
        const pipelineState = await getTaskPipelineState(fullTask.id);
        if (pipelineState && fullTask.pipelineId) {
          await advanceTaskInPipeline(fullTask, pipelineState, updatedComments, output, shouldAdvance, clearedActivity);
          if (shouldAdvance) {
            await postTaskUpdate(fullTask, persona, `Work complete. Advancing to the next pipeline stage.`);
          } else {
            await postTaskUpdate(fullTask, persona, `Issues found. Bouncing back to the previous stage for fixes.`);
          }
        } else {
          // No pipeline - check if lgtm-reviewer found issues (shouldAdvance: false)
          if (!shouldAdvance) {
            // lgtm found issues but no pipeline exists to handle the bounce-back
            // Log warning and bounce back to backlog with comment
            console.warn(`⚠️  Task "${fullTask.title}" has lgtm review feedback (shouldAdvance: false) but no pipeline. Bouncing to backlog.`);
            
            const lgtmComment: Comment = {
              id: Math.random().toString(36).substr(2, 9),
              taskId: fullTask.id,
              body: `🔄 **Returned for fixes**: lgtm review found issues that need addressing. No pipeline configured - returned to backlog.`,
              author: 'System',
              createdAt: new Date(),
            };
            
            await updateTask(fullTask.id, {
              status: 'backlog',
              comments: [...updatedComments, lgtmComment],
              agentActivity: clearedActivity,
            });

            await postTaskUpdate(fullTask, persona, `lgtm review found some issues. Since there's no pipeline configured, I've moved this back to the backlog for you to address.`);
            
            return;
          }
          
          // No pipeline - try auto-review first, then fall back to manual review
          const reviewState = await initiateAutoReview(fullTask, persona.id);
          if (reviewState) {
            // Auto-review initiated - move to auto-review status
            await updateTask(fullTask.id, {
              status: 'auto-review',
              comments: updatedComments,
              agentActivity: clearedActivity,
            });

            // Keep in-memory state in sync for auto-link check
            fullTask.status = 'auto-review';

            await postTaskUpdate(fullTask, persona, `I've finished my work and it's now being auto-reviewed.`);

            // Execute the first review cycle
            const reviewResult = await executeReviewCycle(fullTask.id);
            console.log(`🔍 Auto-review result for ${fullTask.title}: ${reviewResult}`);
          } else {
            // Auto-review disabled or failed - move directly to human review
            await updateTask(fullTask.id, {
              status: 'review',
              comments: updatedComments,
              agentActivity: clearedActivity,
            });

            // Keep in-memory state in sync for auto-link check
            fullTask.status = 'review';

            await postTaskUpdate(fullTask, persona, `Work complete! I've moved this to review — ready for your eyes.`);

            // Track activity: dev task completed (moved to review)
            await trackTaskCompleted(persona.id, persona.name, fullTask);
          }
        }
      }
    } else {
      // Task failed - back to backlog
      await updateTask(fullTask.id, {
        status: 'backlog',
        comments: updatedComments,
        agentActivity: clearedActivity,
      });

      await postTaskUpdate(fullTask, persona, `I ran into some issues with this task and wasn't able to complete it. Moving it back to the backlog — I'll have another go next cycle.`);

      // Track activity: task failed
      await trackTaskFailed(persona.id, persona.name, fullTask, 'AI worker unable to complete task');
    }

    // Auto-link PRs for successful tasks that have a repo configured.
    // Re-fetch the task to get the status the agent set (fullTask reflects pre-run status).
    if (success && fullTask.repo) {
      const updatedTask = await getTask(fullTask.id);
      const postRunStatus = updatedTask?.status ?? fullTask.status;
      if (['review', 'done', 'auto-review', 'in-progress'].includes(postRunStatus)) {
        await autoLinkPRToTask(fullTask.id, fullTask.repo);
      }
    }

    console.log(`${success ? '✅' : '❌'} Task processed: ${fullTask.title}`);
  } catch (error) {
    console.error(`Failed to process task ${task.id}:`, error);

    // Move task back to backlog on error and clear agent activity
    await updateTask(task.id, {
      status: 'backlog',
      agentActivity: undefined,
    });
  } finally {
    // Always remove session on completion (success, failure, or error)
    removeActiveSession(task.id);
    await saveWorkerState();
  }
}

// Handle pipeline advancement after task completion
async function advanceTaskInPipeline(
  task: Task, 
  pipelineState: TaskPipelineState, 
  updatedComments: Comment[], 
  output: string,
  shouldAdvance: boolean = true,
  clearedActivity?: { personaId: string; personaName: string; personaEmoji: string; status: 'idle'; startedAt: Date }
): Promise<void> {
  try {
    const pipeline = await getPipeline(pipelineState.pipelineId);
    if (!pipeline) {
      console.error(`Pipeline ${pipelineState.pipelineId} not found for task ${task.id}`);
      // Fall back to normal review
      await updateTask(task.id, { status: 'review', comments: updatedComments, agentActivity: clearedActivity });
      return;
    }

    const currentStageIndex = pipeline.stages.findIndex(s => s.id === pipelineState.currentStageId);
    if (currentStageIndex === -1) {
      console.error(`Current stage ${pipelineState.currentStageId} not found in pipeline`);
      await updateTask(task.id, { status: 'review', comments: updatedComments, agentActivity: clearedActivity });
      return;
    }

    const currentStage = pipeline.stages[currentStageIndex];
    
    // Record stage completion in history
    const stageHistory: TaskStageHistory = {
      stageId: currentStage.id,
      persona: currentStage.persona,
      startedAt: new Date(task.updatedAt), // Approximate start time
      completedAt: new Date(),
      result: shouldAdvance ? 'success' : 'rejected',
      feedback: output,
      attempt: (pipelineState.stageAttempts[currentStage.id] || 0) + 1,
      outputs: [
        { type: 'comment', content: output, metadata: { author: currentStage.persona } }
      ]
    };
    
    // Update stage history and attempts
    const updatedHistory = [...pipelineState.stageHistory, stageHistory];
    const updatedAttempts = {
      ...pipelineState.stageAttempts,
      [currentStage.id]: (pipelineState.stageAttempts[currentStage.id] || 0) + 1
    };

    // Check if we should bounce back (lgtm-reviewer found issues)
    if (!shouldAdvance) {
      // Check maxRetryAttempts before bouncing
      const currentAttempts = updatedAttempts[currentStage.id] || 0;
      const maxAttempts = currentStage.maxRetryAttempts ?? 3;
      
      if (currentAttempts > maxAttempts) {
        // Max retry attempts reached - mark as stuck and don't bounce
        console.warn(`⚠️  Task "${task.title}" stuck at ${currentStage.name} after ${currentAttempts} attempts (max: ${maxAttempts}). Not bouncing.`);
        
        const stuckPipelineState: TaskPipelineState = {
          ...pipelineState,
          currentStageId: currentStage.id,
          isStuck: true,
          stageAttempts: updatedAttempts,
          stageHistory: updatedHistory,
          updatedAt: new Date()
        };
        
        await updateTaskPipelineState(stuckPipelineState);
        
        // Leave task in review state with warning comment
        const stuckComment: Comment = {
          id: Math.random().toString(36).substr(2, 9),
          taskId: task.id,
          body: `⚠️ **Pipeline Stuck**: Task reached max retry attempts (${maxAttempts}) at ${currentStage.name} stage. Manual intervention required.`,
          author: 'System',
          createdAt: new Date(),
        };
        await updateTask(task.id, {
          status: 'review',
          comments: [...updatedComments, stuckComment],
          agentActivity: clearedActivity
        });
        
        return;
      }
      
      // Find the previous stage (typically the developer stage)
      const previousStageIndex = currentStageIndex - 1;
      if (previousStageIndex >= 0) {
        const previousStage = pipeline.stages[previousStageIndex];
        
        console.log(`🔄 Pipeline: ${task.title} bouncing back to ${previousStage.name} (${previousStage.persona})`);
        
        // Update pipeline state to go back to previous stage
        const bouncedPipelineState: TaskPipelineState = {
          ...pipelineState,
          currentStageId: previousStage.id,
          stageAttempts: updatedAttempts,
          stageHistory: updatedHistory,
          updatedAt: new Date()
        };
        
        await updateTaskPipelineState(bouncedPipelineState);
        
        // Move task back to backlog for the previous stage persona
        await updateTask(task.id, {
          status: 'backlog',
          persona: previousStage.persona,
          assignee: previousStage.persona,
          comments: updatedComments,
          agentActivity: clearedActivity
        });
        
        return;
      } else {
        // No previous stage - just move to backlog with current persona
        // Still persist the updated attempts and history
        const bouncedPipelineState: TaskPipelineState = {
          ...pipelineState,
          stageAttempts: updatedAttempts,
          stageHistory: updatedHistory,
          updatedAt: new Date()
        };
        
        console.log(`🔄 Pipeline: ${task.title} has no previous stage, moving to backlog`);
        await updateTaskPipelineState(bouncedPipelineState);
        await updateTask(task.id, {
          status: 'backlog',
          comments: updatedComments,
          agentActivity: clearedActivity
        });
        return;
      }
    }

    // Normal advancement: check if there's a next stage
    const nextStageIndex = currentStageIndex + 1;
    if (nextStageIndex < pipeline.stages.length) {
      // Move to next stage
      const nextStage = pipeline.stages[nextStageIndex];
      
      console.log(`📋 Pipeline: ${task.title} → Stage ${nextStage.name} (${nextStage.persona})`);
      
      // Update pipeline state
      // Preserve the attempt count for the stage we're leaving (in case of future bounce-back)
      // Only initialize nextStage.id if it doesn't exist yet
      const updatedPipelineState: TaskPipelineState = {
        ...pipelineState,
        currentStageId: nextStage.id,
        stageAttempts: {
          ...updatedAttempts,
          [nextStage.id]: updatedAttempts[nextStage.id] !== undefined 
            ? updatedAttempts[nextStage.id] 
            : 0 // Only initialize to 0 if never visited before
        },
        stageHistory: updatedHistory,
        updatedAt: new Date()
      };
      
      await updateTaskPipelineState(updatedPipelineState);
      
      // Update task to assign to next stage persona
      await updateTask(task.id, {
        status: currentStage.autoAdvance ? 'backlog' : 'review', // Auto-advance or wait for review
        persona: nextStage.persona,
        assignee: nextStage.persona,
        comments: updatedComments,
        agentActivity: clearedActivity
      });
      
      if (currentStage.autoAdvance) {
        console.log(`⚡ Auto-advancing task ${task.title} to ${nextStage.name}`);
      } else {
        console.log(`⏸️  Task ${task.title} waiting for review before ${nextStage.name}`);
      }
    } else {
      // Pipeline complete - move to final review
      console.log(`🏁 Pipeline complete for task: ${task.title}`);
      
      const completedPipelineState: TaskPipelineState = {
        ...pipelineState,
        stageAttempts: updatedAttempts,
        stageHistory: updatedHistory,
        updatedAt: new Date()
      };
      
      await updateTaskPipelineState(completedPipelineState);
      await updateTask(task.id, { 
        status: 'review', 
        comments: updatedComments,
        agentActivity: clearedActivity
      });
    }
  } catch (error) {
    console.error(`Failed to advance task ${task.id} in pipeline:`, error);
    // Fall back to normal review
    await updateTask(task.id, { status: 'review', comments: updatedComments, agentActivity: clearedActivity });
  }
}

// Generate morning standup automatically
async function generateMorningStandup(): Promise<void> {
  try {
    console.log('🌅 Generating morning standup...');
    
    // Check if we already generated a standup today
    const today = new Date().toISOString().split('T')[0];
    const existingStandups = await getAllStandupEntries();
    const todayStandup = existingStandups.find(entry => entry.date === today);
    
    if (todayStandup) {
      console.log('📋 Standup already generated for today, skipping');
      return;
    }
    
    // Generate standup from last 24 hours of activity
    const standupEntry = await generateStandupEntry(24);
    
    // Save the generated standup
    await saveStandupEntry(standupEntry);
    
    // Update last run time
    workerState.lastStandupRun = new Date().toISOString();
    await saveWorkerState();
    
    console.log(`✅ Morning standup generated for ${standupEntry.date}`);
    console.log(`📊 Summary: ${standupEntry.yesterday.length} yesterday items, ${standupEntry.today.length} today items, ${standupEntry.blockers.length} blockers`);
    
    // Log key metrics for visibility
    if (standupEntry.commits.length > 0) {
      console.log(`💻 ${standupEntry.commits.length} commits from ${[...new Set(standupEntry.commits.map(c => c.repo))].join(', ')}`);
    }
    if (standupEntry.prs.length > 0) {
      console.log(`🔀 ${standupEntry.prs.length} PR activities`);
    }
    if (standupEntry.issues.length > 0) {
      console.log(`🐛 ${standupEntry.issues.length} issues closed`);
    }
    
  } catch (error) {
    console.error('❌ Failed to generate morning standup:', error);
  }
}

// Process auto-review tasks
async function processAutoReviewTasks(): Promise<void> {
  try {
    const tasks = await getAllTasks();
    const autoReviewTasks = tasks
      .filter(task => task.status === 'auto-review')
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)); // Highest priority first
    
    for (const task of autoReviewTasks) {
      console.log(`🔍 Processing auto-review for task: ${task.title}`);
      const reviewResult = await executeReviewCycle(task.id);
      console.log(`🔍 Auto-review result for ${task.title}: ${reviewResult}`);
      
      // Avoid processing too many at once to prevent overwhelming the system
      if (autoReviewTasks.indexOf(task) >= 2) {
        console.log('⏸️ Auto-review: Processing 3 tasks per cycle, stopping here');
        break;
      }
    }
  } catch (error) {
    console.error('❌ Auto-review processing failed:', error);
  }
}

// Default threshold for considering a working task as stale (10 minutes)
const STALE_TASK_THRESHOLD_MS = 10 * 60 * 1000;

// Session tracking functions
function addActiveSession(personaId: string, taskId: string): void {
  workerState.activeSessions.push({
    personaId,
    taskId,
    startedAt: new Date(),
  });
  console.log(`📝 Added active session: ${personaId} -> ${taskId} (total: ${workerState.activeSessions.length})`);
}

function removeActiveSession(taskId: string): void {
  const before = workerState.activeSessions.length;
  workerState.activeSessions = workerState.activeSessions.filter(s => s.taskId !== taskId);
  const removed = before - workerState.activeSessions.length;
  if (removed > 0) {
    console.log(`🗑️  Removed active session for task ${taskId} (total: ${workerState.activeSessions.length})`);
  }
}

function isPersonaActive(personaId: string): boolean {
  return workerState.activeSessions.some(s => s.personaId === personaId);
}

function getAvailableSlots(): number {
  return Math.max(0, workerState.maxConcurrentPersonas - workerState.activeSessions.length);
}

async function pruneStaleActiveSessions(tasks: Task[]): Promise<void> {
  const now = Date.now();
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const staleToRemove: string[] = [];

  for (const session of workerState.activeSessions) {
    const task = taskMap.get(session.taskId);
    if (!task) {
      // Task no longer exists — remove session
      staleToRemove.push(session.taskId);
      continue;
    }

    // Check if task is no longer in-progress
    if (task.status !== 'in-progress') {
      staleToRemove.push(session.taskId);
      continue;
    }

    // Check if session has exceeded timeout
    const taskTimeout = (task as any).timeoutMs || STALE_TASK_THRESHOLD_MS;
    const elapsed = now - new Date(session.startedAt).getTime();
    const timeoutThreshold = Math.max(taskTimeout * 2, STALE_TASK_THRESHOLD_MS);
    
    if (elapsed > timeoutThreshold) {
      console.log(`⏱️  Session for task ${session.taskId} is stale (${Math.floor(elapsed / 60000)}min > ${Math.floor(timeoutThreshold / 60000)}min threshold)`);
      staleToRemove.push(session.taskId);
    }
  }

  if (staleToRemove.length > 0) {
    console.log(`🧹 Pruning ${staleToRemove.length} stale session(s)...`);
    for (const taskId of staleToRemove) {
      removeActiveSession(taskId);
    }
    await saveWorkerState();
  }
}

// Evaluate whether a stale in-progress task is ready for review
async function evaluateStaleTask(task: Task, persona: Persona): Promise<'review' | 'backlog'> {
  try {
    const aiComments = (task.comments || []).filter(c => c.author.includes('(AI)'));
    if (aiComments.length === 0) {
      // No work was done, send back to backlog
      return 'backlog';
    }

    const lastComment = aiComments[aiComments.length - 1];
    const evaluationPrompt = `You are evaluating whether a task has been completed based on prior work output.

## Task
Title: ${sanitizeForPrompt(task.title)}
Description: ${sanitizeForPrompt(task.description)}
Tags: ${(task.tags || []).join(', ')}

## Last Work Output
${sanitizeForPrompt(lastComment.body)}

Based on the work output above, does it appear that meaningful work was completed on this task?
Consider: Was code written? Were changes committed or a PR created? Was the deliverable produced?

Reply with ONLY one word: REVIEW (if work appears complete and ready for review) or BACKLOG (if work appears incomplete and needs to be retried).`;

    const model = resolveModelAlias((task as any).model || persona?.model || undefined);
    const { stdout } = await executeClaudeWithStdin(
      evaluationPrompt,
      ['--dangerously-skip-permissions'],
      30000, // 30s timeout for quick evaluation
      undefined,
      model,
      'evaluation'
    );

    const response = stdout.trim().toUpperCase();
    if (response.includes('REVIEW')) {
      return 'review';
    }
    return 'backlog';
  } catch (error) {
    console.error(`Failed to evaluate stale task ${task.id}:`, error);
    // Default to backlog on error so the task gets retried
    return 'backlog';
  }
}

// Recover tasks stuck at in-progress that are no longer being actively worked on
async function recoverStaleTasks(tasks: Task[]): Promise<void> {
  const now = Date.now();

  const staleTasks = tasks.filter(task => {
    if (task.status !== 'in-progress') return false;

    // No agent activity at all — orphaned task
    if (!task.agentActivity) return true;

    // Agent finished (idle) but task wasn't moved — transition was lost
    if (task.agentActivity.status === 'idle') return true;

    // Agent marked as working but startedAt is older than threshold — worker crashed
    if (task.agentActivity.status === 'working') {
      const startedAt = new Date(task.agentActivity.startedAt).getTime();
      const taskTimeout = (task as any).timeoutMs || STALE_TASK_THRESHOLD_MS;
      // Use 2x the task timeout as the stale threshold to avoid false positives
      return (now - startedAt) > Math.max(taskTimeout * 2, STALE_TASK_THRESHOLD_MS);
    }

    return false;
  });

  if (staleTasks.length === 0) return;

  console.log(`🔍 Found ${staleTasks.length} stale in-progress task(s), recovering...`);

  for (const task of staleTasks) {
    try {
      const fullTask = await getTask(task.id);
      if (!fullTask) continue;

      const persona = fullTask.persona ? await getPersona(fullTask.persona) : null;
      if (!persona) {
        // No persona — just move back to backlog
        await updateTask(task.id, {
          status: 'backlog',
          agentActivity: undefined,
        });
        // Clean up any phantom active session
        removeActiveSession(task.id);
        await saveWorkerState();
        console.log(`📥 Recovered stale task (no persona) → backlog: ${task.title}`);
        continue;
      }

      // Evaluate whether work was done and if it's ready for review
      const decision = await evaluateStaleTask(fullTask, persona);

      const activityComment: Comment = {
        id: Math.random().toString(36).substr(2, 9),
        taskId: task.id,
        body: decision === 'review'
          ? `⚡ Task was recovered from a stale in-progress state. Prior work appears complete — moved to review.`
          : `⚡ Task was recovered from a stale in-progress state. Work appears incomplete — returned to backlog for retry.`,
        author: 'System',
        createdAt: new Date(),
      };
      const updatedComments = [...(fullTask.comments || []), activityComment];

      if (decision === 'review') {
        // Work looks done — try auto-review flow first
        const reviewState = await initiateAutoReview(fullTask, persona.id);
        if (reviewState) {
          await updateTask(task.id, {
            status: 'auto-review',
            comments: updatedComments,
            agentActivity: undefined,
          });
          await executeReviewCycle(task.id);
          // Clean up any phantom active session
          removeActiveSession(task.id);
          await saveWorkerState();
          console.log(`🔍 Recovered stale task → auto-review: ${task.title}`);
        } else {
          await updateTask(task.id, {
            status: 'review',
            comments: updatedComments,
            agentActivity: undefined,
          });
          // Clean up any phantom active session
          removeActiveSession(task.id);
          await saveWorkerState();
          console.log(`✅ Recovered stale task → review: ${task.title}`);
        }
      } else {
        await updateTask(task.id, {
          status: 'backlog',
          comments: updatedComments,
          agentActivity: undefined,
        });
        // Clean up any phantom active session
        removeActiveSession(task.id);
        await saveWorkerState();
        console.log(`📥 Recovered stale task → backlog: ${task.title}`);
      }
    } catch (error) {
      console.error(`Failed to recover stale task ${task.id}:`, error);
      // Fail safe: move to backlog
      await updateTask(task.id, {
        status: 'backlog',
        agentActivity: undefined,
      });
      // Clean up any phantom active session
      removeActiveSession(task.id);
      await saveWorkerState();
    }
  }
}

// Main worker cycle (task queue + event-based triggers)
async function runWorkerCycle(): Promise<void> {
  console.log('🔄 Worker cycle starting...');

  // Clean up expired cache entries periodically
  try {
    await clearExpiredCache();
  } catch (error) {
    console.warn('Failed to clear expired cache:', error);
  }

  // First, process any auto-review tasks
  await processAutoReviewTasks();

  // Then, monitor PRs for review tasks (detect merged PRs, new comments, CI failures, conflicts)
  await processReviewTasksPRStatus();

  // Get all tasks
  let tasks = await getAllTasks();

  // Prune stale active sessions (completed, timeout, or orphaned tasks)
  await pruneStaleActiveSessions(tasks);

  // Recover any tasks stuck at in-progress (e.g. from worker crash or server restart)
  await recoverStaleTasks(tasks);
  tasks = await getAllTasks();

  // Calculate workload and available slots
  const availableSlots = getAvailableSlots();
  console.log(`📊 Concurrent slots: ${workerState.activeSessions.length}/${workerState.maxConcurrentPersonas} used, ${availableSlots} available`);

  workerState.workload = tasks.filter(task =>
    task.status === 'backlog' || task.status === 'in-progress' || task.status === 'auto-review'
  ).length;

  // Adaptive interval based on workload
  if (workerState.workload >= 10) {
    workerState.interval = '*/2 * * * *'; // Every 2 minutes
  } else if (workerState.workload >= 5) {
    workerState.interval = '*/5 * * * *'; // Every 5 minutes
  } else {
    workerState.interval = '*/10 * * * *'; // Every 10 minutes
  }

  // If no available slots, skip task processing this cycle
  if (availableSlots <= 0) {
    console.log(`⏸️  No available slots (${workerState.maxConcurrentPersonas} max reached). Waiting for running sessions to complete.`);
    const refreshedTasks = await getAllTasks();
    await processEventBasedPersonaTriggers(refreshedTasks);
    console.log('✅ Worker cycle completed (no slots available).');
    return;
  }

  // Categorize and sort tasks by priority
  const backlogTasks = tasks
    .filter(task => task.status === 'backlog' && task.persona)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Build set of repos that already have an active task (in-progress, review, auto-review, verified)
  // to enforce the one-ticket-per-repo rule and reduce merge conflicts
  const activeRepos = new Set(
    tasks
      .filter(t => ['in-progress', 'review', 'auto-review', 'verified'].includes(t.status as string) && t.repo)
      .map(t => t.repo as string)
  );

  // Find eligible tasks (provider access + persona availability)
  const eligibleBacklogTasks: Task[] = [];
  const personasInCurrentBatch: Set<string> = new Set();
  const reposInCurrentBatch: Set<string> = new Set();
  for (const candidate of backlogTasks) {
    const candidatePersona = candidate.persona ? await getPersona(candidate.persona) : null;
    if (!candidatePersona) continue;

    // Check if persona is paused due to budget exceeded - filter out BEFORE selection
    const { isPersonaPaused } = await import('./collaboration-budget.js');
    const isPaused = await isPersonaPaused(candidatePersona.id);
    if (isPaused) {
      console.log(`⏸️ Skipping task "${candidate.title}" — persona "${candidatePersona.name}" is paused due to budget`);
      continue;
    }

    const requiredProviders = getRequiredProviders(candidate);

    // Check provider access
    let eligible = true;
    for (const provider of requiredProviders) {
      try {
        enforceProviderAccess(candidatePersona, provider);
      } catch (accessError) {
        const denialMessage = accessError instanceof Error ? accessError.message : String(accessError);
        console.warn(
          `🚫 Provider access denied for backlog task "${candidate.title}" — persona "${candidatePersona.name}" lacks ${provider} access: ${denialMessage}`
        );

        if (candidate.status !== "review") {
          await handleProviderDenial(candidate, provider, denialMessage);
        }
        eligible = false;
        break;
      }
    }

    if (!eligible) continue;

    // Enforce one-ticket-per-repo rule: skip if this repo already has an active task
    // (in-progress, review, auto-review, or verified) to reduce merge conflicts
    if (candidate.repo && (activeRepos.has(candidate.repo) || reposInCurrentBatch.has(candidate.repo))) {
      console.log(`⏭️  Skipping task "${candidate.title}" — repo ${candidate.repo} already has an active task`);
      continue;
    }

    // Check if persona is already active (unless duplicates allowed)
    // Also check batch-local set to prevent same persona being scheduled multiple times in single cycle
    if (!workerState.allowDuplicatePersonas && (isPersonaActive(candidatePersona.id) || personasInCurrentBatch.has(candidatePersona.id))) {
      console.log(`⏭️  Skipping task "${candidate.title}" — persona ${candidatePersona.name} already active on another task`);
      continue;
    }

    if (candidate.repo) reposInCurrentBatch.add(candidate.repo);
    personasInCurrentBatch.add(candidatePersona.id);
    eligibleBacklogTasks.push(candidate);
  }

  // Select tasks to process concurrently (up to available slots)
  const tasksToProcess = eligibleBacklogTasks.slice(0, availableSlots);

  if (tasksToProcess.length === 0) {
    if (backlogTasks.length === 0) {
      console.log('📭 No backlog tasks with personas found');
    } else {
      console.log('📭 No eligible backlog tasks found (all blocked by provider restrictions or active personas)');
    }
    const refreshedTasks = await getAllTasks();
    await processEventBasedPersonaTriggers(refreshedTasks);
    console.log('✅ Worker cycle completed (no eligible tasks).');
    return;
  }

  // Process tasks concurrently
  console.log(`🚀 Processing ${tasksToProcess.length} task(s) concurrently...`);
  const processingPromises = tasksToProcess.map(task => {
    workerState.lastTaskId = task.id; // Track last processed (overwrites for each, but that's fine)
    return processTask(task).catch(error => {
      console.error(`❌ Failed to process task ${task.id}:`, error);
    });
  });

  await Promise.all(processingPromises);

  const refreshedTasks = await getAllTasks();
  await processEventBasedPersonaTriggers(refreshedTasks);

  console.log(`✅ Worker cycle completed. Processed ${tasksToProcess.length} task(s).`);
}

export async function runWorker(): Promise<{ skipped: boolean; error?: string }> {
  if (workerState.isRunning) {
    console.log('⏭️  Worker already running, skipping this cycle');
    return { skipped: true };
  }

  try {
    workerState.isRunning = true;
    workerState.lastRun = new Date().toISOString();
    await saveWorkerState();
    await runWorkerCycle();
    return { skipped: false };
  } catch (error) {
    console.error('❌ Worker cycle failed:', error);
    return { skipped: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    workerState.isRunning = false;
    await saveWorkerState();
  }
}

// Start the worker
export async function startWorker(): Promise<void> {
  try {
    await ensureWorkerDirectories();
    await loadWorkerState();
    await initializeTriggerSystem();
    
    // Stop existing cron jobs if running
    if (cronJob) {
      cronJob.stop();
    }
    if (standupCronJob) {
      standupCronJob.stop();
    }
    
    // Start main worker if enabled
    if (workerState.enabled) {
      cronJob = cron.schedule(workerState.interval, runWorker, {
        scheduled: false
      });
      cronJob.start();
      console.log(`🚀 Worker started with interval: ${workerState.interval}`);
    } else {
      console.log('💤 Worker is disabled');
    }
    
    // Start standup cron job if enabled
    if (workerState.standupEnabled) {
      standupCronJob = cron.schedule(workerState.standupTime, generateMorningStandup, {
        scheduled: false
      });
      standupCronJob.start();
      console.log(`🌅 Standup scheduler started: ${workerState.standupTime} (${cron.validate(workerState.standupTime) ? 'valid' : 'INVALID'} cron expression)`);
    } else {
      console.log('💤 Standup scheduler is disabled');
    }

    // Start slx sync cron job if enabled
    if (slxSyncCronJob) {
      slxSyncCronJob.stop();
    }
    if (workerState.slxSyncEnabled) {
      slxSyncCronJob = cron.schedule(workerState.slxSyncInterval, runSlxSync, {
        scheduled: false
      });
      slxSyncCronJob.start();
      console.log(`📨 slx sync scheduler started: ${workerState.slxSyncInterval} (${cron.validate(workerState.slxSyncInterval) ? 'valid' : 'INVALID'} cron expression)`);
    } else {
      console.log('💤 slx sync scheduler is disabled');
    }

    // Start reminder check cron job if enabled
    if (reminderCheckCronJob) {
      reminderCheckCronJob.stop();
    }
    if (workerState.reminderCheckEnabled) {
      reminderCheckCronJob = cron.schedule(workerState.reminderCheckInterval, runReminderCheck, {
        scheduled: false
      });
      reminderCheckCronJob.start();
      console.log(`🔔 Reminder check scheduler started: ${workerState.reminderCheckInterval} (${cron.validate(workerState.reminderCheckInterval) ? 'valid' : 'INVALID'} cron expression)`);
      
      // Run immediate check on startup to catch any missed reminders from downtime
      console.log('🔔 Running immediate reminder check on startup...');
      await runReminderCheck();
    } else {
      console.log('💤 Reminder check scheduler is disabled');
    }
  } catch (error) {
    console.error('Failed to start worker:', error);
    throw error;
  }
}

// Stop the worker
export function stopWorker(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  if (standupCronJob) {
    standupCronJob.stop();
    standupCronJob = null;
  }
  if (slxSyncCronJob) {
    slxSyncCronJob.stop();
    slxSyncCronJob = null;
  }
  if (reminderCheckCronJob) {
    reminderCheckCronJob.stop();
    reminderCheckCronJob = null;
  }
  console.log('🛑 Worker, standup, slx sync, and reminder check schedulers stopped');
}

// Enable/disable worker
export async function toggleWorker(enabled: boolean): Promise<void> {
  workerState.enabled = enabled;
  await saveWorkerState();
  
  if (enabled) {
    await startWorker();
  } else {
    stopWorker();
  }
}

// Update worker interval
export async function updateWorkerInterval(interval: string): Promise<void> {
  workerState.interval = interval;
  await saveWorkerState();
  
  if (workerState.enabled) {
    await startWorker(); // Restart with new interval
  }
}

// Enable/disable standup scheduler
export async function toggleStandupScheduler(enabled: boolean): Promise<void> {
  workerState.standupEnabled = enabled;
  await saveWorkerState();
  
  if (enabled) {
    if (standupCronJob) {
      standupCronJob.stop();
    }
    standupCronJob = cron.schedule(workerState.standupTime, generateMorningStandup, {
      scheduled: false
    });
    standupCronJob.start();
    console.log(`🌅 Standup scheduler enabled: ${workerState.standupTime}`);
  } else {
    if (standupCronJob) {
      standupCronJob.stop();
      standupCronJob = null;
    }
    console.log('💤 Standup scheduler disabled');
  }
}

// Update standup time
export async function updateStandupTime(cronExpression: string): Promise<void> {
  if (!cron.validate(cronExpression)) {
    throw new Error('Invalid cron expression');
  }
  
  workerState.standupTime = cronExpression;
  await saveWorkerState();
  
  if (workerState.standupEnabled) {
    // Restart with new schedule
    await toggleStandupScheduler(false);
    await toggleStandupScheduler(true);
  }
}

// Manually trigger standup generation (for testing)
export async function triggerStandupGeneration(): Promise<void> {
  await generateMorningStandup();
}

// Run slx sync
async function runSlxSync(): Promise<void> {
  try {
    console.log('📨 Running slx sync...');

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('slx', ['sync'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: true,
      });

      let out = '';
      let err = '';

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('slx sync timed out after 5 minutes'));
      }, 300000);

      child.stdout.on('data', (data) => { out += data.toString(); });
      child.stderr.on('data', (data) => { err += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout: out.trim(), stderr: err.trim() });
        } else {
          reject(new Error(`slx sync exited with code ${code}: ${err}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    if (stderr) {
      console.warn(`slx sync stderr: ${stderr}`);
    }

    workerState.lastSlxSyncRun = new Date().toISOString();
    await saveWorkerState();

    console.log(`✅ slx sync completed`);
    if (stdout) {
      console.log(`📨 slx output: ${stdout.substring(0, 500)}`);
    }

    // Run digest after successful sync
    try {
      console.log('📝 Running slx digest...');
      await runSlxDigest();
      console.log('✅ slx digest completed');
    } catch (digestError) {
      console.error('❌ slx digest failed:', digestError);
    }
  } catch (error) {
    console.error('❌ slx sync failed:', error);
  }
}

// Send notification for a triggered reminder
async function sendReminderNotification(reminder: PersonalReminder): Promise<void> {
  const targetName = reminder.target.startsWith('human:') 
    ? reminder.target.replace('human:', '') 
    : reminder.target;
  
  const notification = `🔔 REMINDER for ${targetName}: ${reminder.message}`;
  console.log(notification);
}

// Run reminder check
async function runReminderCheck(): Promise<void> {
  try {
    console.log('🔔 Running reminder check...');

    // Check for due reminders (triggerTime <= now and status is 'pending')
    const dueReminders = await getDueReminders();
    
    if (dueReminders.length > 0) {
      console.log(`📬 Found ${dueReminders.length} due reminder(s)`);
      
      // Mark each as triggered and send notification
      for (const reminder of dueReminders) {
        await markReminderTriggered(reminder.id);
        await sendReminderNotification(reminder);
        console.log(`   ✅ Triggered: ${reminder.id} - "${reminder.message.substring(0, 50)}..."`);
      }
    }
    
    // Clean up old reminders (cleanupAfter <= now and status is 'triggered' or 'completed')
    const cleanedCount = await cleanupOldReminders();
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old reminder(s)`);
    }

    // Also run the existing reminder rules evaluation
    await evaluateReminderRules(false);

    // Update last run time
    workerState.lastReminderCheckRun = new Date().toISOString();
    await saveWorkerState();

    console.log('✅ Reminder check completed');
  } catch (error) {
    console.error('❌ Reminder check failed:', error);
  }
}

// Enable/disable slx sync scheduler
export async function toggleSlxSyncScheduler(enabled: boolean): Promise<void> {
  workerState.slxSyncEnabled = enabled;
  await saveWorkerState();

  if (enabled) {
    if (slxSyncCronJob) {
      slxSyncCronJob.stop();
    }
    slxSyncCronJob = cron.schedule(workerState.slxSyncInterval, runSlxSync, {
      scheduled: false
    });
    slxSyncCronJob.start();
    console.log(`📨 slx sync scheduler enabled: ${workerState.slxSyncInterval}`);
  } else {
    if (slxSyncCronJob) {
      slxSyncCronJob.stop();
      slxSyncCronJob = null;
    }
    console.log('💤 slx sync scheduler disabled');
  }
}

// Enable/disable reminder check scheduler
export async function toggleReminderCheckScheduler(enabled: boolean): Promise<void> {
  workerState.reminderCheckEnabled = enabled;
  await saveWorkerState();

  if (enabled) {
    if (reminderCheckCronJob) {
      reminderCheckCronJob.stop();
    }
    reminderCheckCronJob = cron.schedule(workerState.reminderCheckInterval, runReminderCheck, {
      scheduled: false
    });
    reminderCheckCronJob.start();
    console.log(`🔔 Reminder check scheduler enabled: ${workerState.reminderCheckInterval}`);
  } else {
    if (reminderCheckCronJob) {
      reminderCheckCronJob.stop();
      reminderCheckCronJob = null;
    }
    console.log('💤 Reminder check scheduler disabled');
  }
}

// Update slx sync interval
export async function updateSlxSyncInterval(cronExpression: string): Promise<void> {
  if (!cron.validate(cronExpression)) {
    throw new Error('Invalid cron expression');
  }

  workerState.slxSyncInterval = cronExpression;
  await saveWorkerState();

  if (workerState.slxSyncEnabled) {
    // Restart with new schedule
    await toggleSlxSyncScheduler(false);
    await toggleSlxSyncScheduler(true);
  }
}

// Manually trigger slx sync
export async function triggerSlxSync(): Promise<void> {
  await runSlxSync();
}

// Update reminder check interval
export async function updateReminderCheckInterval(cronExpression: string): Promise<void> {
  if (!cron.validate(cronExpression)) {
    throw new Error('Invalid cron expression');
  }

  workerState.reminderCheckInterval = cronExpression;
  await saveWorkerState();

  if (workerState.reminderCheckEnabled) {
    // Restart with new schedule
    await toggleReminderCheckScheduler(false);
    await toggleReminderCheckScheduler(true);
  }
}

// Manually trigger reminder check
export async function triggerReminderCheck(): Promise<void> {
  await runReminderCheck();
}

// Get worker status
export function getWorkerStatus(): WorkerState {
  return { ...workerState };
}

// Update max concurrent personas
export async function updateMaxConcurrentPersonas(max: number): Promise<void> {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('maxConcurrentPersonas must be a positive integer');
  }
  workerState.maxConcurrentPersonas = max;
  await saveWorkerState();
  console.log(`⚙️  Updated maxConcurrentPersonas to ${max}`);
}

// Toggle allow duplicate personas
export async function toggleAllowDuplicatePersonas(allow: boolean): Promise<void> {
  workerState.allowDuplicatePersonas = allow;
  await saveWorkerState();
  console.log(`⚙️  ${allow ? 'Enabled' : 'Disabled'} allowDuplicatePersonas`);
}

// Get full worker status including PR monitor stats
export async function getFullWorkerStatus(): Promise<{ worker: WorkerState; prMonitor: { lastRunAt: string | null; tasksChecked: number; actionsTaken: number } }> {
  const prMonitorStats = await getPRMonitorStats();
  return {
    worker: { ...workerState },
    prMonitor: prMonitorStats,
  };
}
