import * as cron from 'node-cron';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFile as execFileCallback, spawn } from 'child_process';
import { promisify } from 'util';
import { parsePRLinks, getPRState } from './pr-utils.js';
import { runSlxDigest } from './slx-service.js';
import { getAllTasks, updateTask, getTask, addTaskLink } from './storage.js';
import { getAllPersonas, getPersona, createPersonaContext, updatePersonaMemoryAfterTask, updatePersonaStats } from './persona-storage.js';
import { enforceProviderAccess } from './persona-yaml-loader.js';
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
import {
  generateStandupEntry,
  saveStandupEntry,
  getAllStandupEntries
} from './standup-storage.js';
import { createOrGetChannel, addMessage } from './chat-storage.js';
import { evaluateReminderRules } from './reminder-rules.js';
import { type TriggerCondition, initializeTriggerSystem, emitCIPassed } from './event-triggers.js';
import { evaluateFieldCondition } from './condition-utils.js';
import {
  PersonalReminder,
  getDueReminders,
  markReminderTriggered,
  cleanupOldReminders,
} from './personal-reminders.js';


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
  task: 12,
  research: 20,
  evaluation: 4,
};

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

type TriggerEventType = 'onPROpened' | 'onPRMerged' | 'onPRClosed' | 'onCIPassed' | 'onTestFailure' | 'onTaskStarted';

// ParsedPRLink imported from pr-utils

interface PRSnapshot {
  state: 'open' | 'closed' | 'merged' | null;
  ciState: 'SUCCESS' | 'FAILURE' | null;
}

interface WorkerTriggerTaskState {
  prs: Record<string, PRSnapshot>;
  lastStatus?: Task['status'];
}

interface WorkerTriggerState {
  tasks: Record<string, WorkerTriggerTaskState>;
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
};

let cronJob: cron.ScheduledTask | null = null;
let standupCronJob: cron.ScheduledTask | null = null;
let slxSyncCronJob: cron.ScheduledTask | null = null;
let reminderCheckCronJob: cron.ScheduledTask | null = null;

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

// Save worker state to file
async function saveWorkerState(): Promise<void> {
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
      ['pr', 'view', String(number), '--repo', repo, '--json', 'statusCheckRollup', '--jq', '.statusCheckRollup[] | select(.conclusion != null) | .conclusion'],
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

function buildTriggerInstruction(task: Task, eventType: TriggerEventType, details?: string): string {
  const eventDescriptionMap: Record<TriggerEventType, string> = {
    onPROpened: 'A pull request was just linked/opened for this task.',
    onPRMerged: 'A linked pull request was just merged for this task.',
    onPRClosed: 'A linked pull request was just closed for this task.',
    onCIPassed: 'CI checks just passed for a linked pull request on this task.',
    onTestFailure: 'CI checks failed for a linked pull request on this task.',
    onTaskStarted: 'This task just moved from backlog to in-progress.',

  };

  return [
    task.description,
    '',
    '## Trigger Event Context',
    eventDescriptionMap[eventType],
    ...(details ? [`Details: ${details}`] : []),
    '',
    'Take the action implied by your persona role for this trigger and summarize concrete outputs.',
  ].join('\n');
}

async function invokeTriggerPersona(
  task: Task,
  persona: Persona,
  eventType: TriggerEventType,
  details?: string
): Promise<void> {
  try {
    const requiredProviders = getRequiredProviders(task);
    for (const provider of requiredProviders) {
      enforceProviderAccess(persona, provider);
    }

    const triggeredTask: Task = {
      ...task,
      description: buildTriggerInstruction(task, eventType, details),
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

  const pendingInvocations = new Map<string, { task: Task; persona: Persona; eventType: TriggerEventType; details: string[] }>();

  const enqueueInvocation = (task: Task, persona: Persona, eventType: TriggerEventType, detail: string): void => {
    const key = `${task.id}|${persona.id}|${eventType}`;
    const existing = pendingInvocations.get(key);
    if (existing) {
      existing.details.push(detail);
      return;
    }
    pendingInvocations.set(key, { task, persona, eventType, details: [detail] });
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
        if (previous) {
          newSnapshots[pr.key] = previous;
        }
        continue;
      }
      const ciState = await getPRCIState(pr.repo, pr.number);
      // On transient CI fetch failure, preserve the last known ciState so the snapshot
      // still reflects the valid new PR state (e.g. open→merged) without losing CI history.
      const effectiveCiState = ciState ?? previous?.ciState ?? null;
      const current: PRSnapshot = { state, ciState: effectiveCiState };
      newSnapshots[pr.key] = current;

      if (!previous) {
        // First observation: only fire onPROpened (PR was just linked to this task)
        // Don't fire onPRMerged/onCIPassed — those would be spurious for pre-existing state
        if (state === 'open') {
          for (const persona of getTriggeredPersonas(personas, 'onPROpened', fullTask)) {
            enqueueInvocation(fullTask, persona, 'onPROpened', `${pr.repo}#${pr.number} (${pr.url || 'no-url'})`);
          }
        }
      } else {
        // Subsequent observations: fire on state transitions only
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
          // Note: emitCIPassed is intentionally NOT called here to avoid duplicate log entries.
          // The polling path above handles persona invocations directly. emitCIPassed is
          // reserved for external callers (e.g. CI webhooks) that bypass the polling loop.
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
    if (hasAutoReviewNote && prLinks.length > 0) {
      // Match isPRMerged semantics: any linked PR merged is sufficient to close the task
      const anyMerged = prLinks.some((pr) => newSnapshots[pr.key]?.state === 'merged');
      if (anyMerged) {
        console.log(`✅ Linked PR merged for stranded review task ${task.id} — marking done`);
        await updateTask(task.id, { status: 'done' });
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
  }

  if (pendingInvocations.size > 0) {
    console.log(`🔔 Processing ${pendingInvocations.size} persona trigger invocation(s)...`);
  }
  for (const invocation of pendingInvocations.values()) {
    await invokeTriggerPersona(
      invocation.task,
      invocation.persona,
      invocation.eventType,
      invocation.details.join('; ')
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

    const { prompt, tokenCount, memoryTruncated } = await createPersonaContext(
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
    const model = (task as any).model || persona?.model || undefined;

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

  const researchKeywords = ['research', 'analysis', 'report', 'study', 'investigation', 'knowledge', 'article', 'documentation', 'document', 'architecture'];
  const titleLower = task.title.toLowerCase();
  const descriptionLower = task.description.toLowerCase();
  const tags = task.tags || [];

  // Check if task is explicitly tagged as research
  if (tags.some(tag => researchKeywords.includes(tag.toLowerCase()))) {
    return true;
  }

  // Check if title or description contains research keywords
  return researchKeywords.some(keyword =>
    titleLower.includes(keyword) || descriptionLower.includes(keyword)
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
    
    const { prompt, tokenCount } = await createPersonaContext(
      persona.id,
      `Research Task: ${task.title}`,
      task.description,
      [...(task.tags || []), 'research'],
      additionalContext
    );
    
    console.log(`📊 Generated research prompt with ${tokenCount.toLocaleString()} tokens`);
    
    // Resolve model: task model > persona model > system default
    const researchModel = (task as any).model || persona?.model || undefined;

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

    // Notify via chat that work is starting
    await postTaskUpdate(fullTask, persona, `Starting work on this task. I'll update you when I'm done.`);

    // Check if this is a research task and handle differently
    let output: string;
    let success: boolean;
    let reportId: string | undefined;
    
    if (isResearchTask(fullTask, persona)) {
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
      // Research tasks go directly to done - no review needed
      if (isResearchTask(fullTask, persona)) {
        await updateTask(fullTask.id, {
          status: 'done',
          comments: updatedComments,
          agentActivity: clearedActivity,
        });
        console.log(`🔍 Research task completed: ${fullTask.title}`);

        await postTaskUpdate(fullTask, persona, `Research complete! The report has been saved. Moving this to done.`);

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
          await advanceTaskInPipeline(fullTask, pipelineState, updatedComments, output);
          await postTaskUpdate(fullTask, persona, `Work complete. Advancing to the next pipeline stage.`);
        } else {
          // No pipeline - try auto-review first, then fall back to manual review
          const reviewState = await initiateAutoReview(fullTask, persona.id);
          if (reviewState) {
            // Auto-review initiated - move to auto-review status
            await updateTask(fullTask.id, {
              status: 'auto-review',
              comments: updatedComments,
              agentActivity: clearedActivity,
            });

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

            await postTaskUpdate(fullTask, persona, `Work complete! I've moved this to review — ready for your eyes.`);
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
    }

    console.log(`${success ? '✅' : '❌'} Task processed: ${fullTask.title}`);
  } catch (error) {
    console.error(`Failed to process task ${task.id}:`, error);

    // Move task back to backlog on error and clear agent activity
    await updateTask(task.id, {
      status: 'backlog',
      agentActivity: undefined,
    });
  }
}

// Handle pipeline advancement after task completion
async function advanceTaskInPipeline(
  task: Task, 
  pipelineState: TaskPipelineState, 
  updatedComments: Comment[], 
  output: string
): Promise<void> {
  try {
    const pipeline = await getPipeline(pipelineState.pipelineId);
    if (!pipeline) {
      console.error(`Pipeline ${pipelineState.pipelineId} not found for task ${task.id}`);
      // Fall back to normal review
      await updateTask(task.id, { status: 'review', comments: updatedComments });
      return;
    }

    const currentStageIndex = pipeline.stages.findIndex(s => s.id === pipelineState.currentStageId);
    if (currentStageIndex === -1) {
      console.error(`Current stage ${pipelineState.currentStageId} not found in pipeline`);
      await updateTask(task.id, { status: 'review', comments: updatedComments });
      return;
    }

    const currentStage = pipeline.stages[currentStageIndex];
    
    // Record stage completion in history
    const stageHistory: TaskStageHistory = {
      stageId: currentStage.id,
      persona: currentStage.persona,
      startedAt: new Date(task.updatedAt), // Approximate start time
      completedAt: new Date(),
      result: 'success',
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

    // Check if there's a next stage
    const nextStageIndex = currentStageIndex + 1;
    if (nextStageIndex < pipeline.stages.length) {
      // Move to next stage
      const nextStage = pipeline.stages[nextStageIndex];
      
      console.log(`📋 Pipeline: ${task.title} → Stage ${nextStage.name} (${nextStage.persona})`);
      
      // Update pipeline state
      const updatedPipelineState: TaskPipelineState = {
        ...pipelineState,
        currentStageId: nextStage.id,
        stageAttempts: {
          ...updatedAttempts,
          [nextStage.id]: 0 // Reset attempts for new stage
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
        comments: updatedComments
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
        comments: updatedComments 
      });
    }
  } catch (error) {
    console.error(`Failed to advance task ${task.id} in pipeline:`, error);
    // Fall back to normal review
    await updateTask(task.id, { status: 'review', comments: updatedComments });
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
      .sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Highest priority first
    
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

    const model = (task as any).model || persona?.model || undefined;
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
          console.log(`🔍 Recovered stale task → auto-review: ${task.title}`);
        } else {
          await updateTask(task.id, {
            status: 'review',
            comments: updatedComments,
            agentActivity: undefined,
          });
          console.log(`✅ Recovered stale task → review: ${task.title}`);
        }
      } else {
        await updateTask(task.id, {
          status: 'backlog',
          comments: updatedComments,
          agentActivity: undefined,
        });
        console.log(`📥 Recovered stale task → backlog: ${task.title}`);
      }
    } catch (error) {
      console.error(`Failed to recover stale task ${task.id}:`, error);
      // Fail safe: move to backlog
      await updateTask(task.id, {
        status: 'backlog',
        agentActivity: undefined,
      });
    }
  }
}

// Main worker cycle (task queue + event-based triggers)
async function runWorkerCycle(): Promise<void> {
  console.log('🔄 Worker cycle starting...');

  // Ensure trigger system is initialized before processing
  await initializeTriggerSystem();

  // Clean up expired cache entries periodically
  try {
    await clearExpiredCache();
  } catch (error) {
    console.warn('Failed to clear expired cache:', error);
  }

  // First, process any auto-review tasks
  await processAutoReviewTasks();

  // Get all tasks
  let tasks = await getAllTasks();

  // Recover any tasks stuck at in-progress (e.g. from worker crash or server restart)
  await recoverStaleTasks(tasks);
  tasks = await getAllTasks();

  const backlogTasks = tasks
    .filter(task => task.status === 'backlog' && task.persona)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Highest priority first

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

  // Find the highest-priority task whose persona has the required provider access.
  // This prevents a provider-restricted task at the top of the queue from
  // blocking all other tasks via an infinite deny → backlog → retry loop.
  let taskToProcess: Task | undefined;
  const eligibleBacklogTasks: Task[] = [];
  for (const candidate of backlogTasks) {
    const candidatePersona = candidate.persona ? await getPersona(candidate.persona) : null;
    if (!candidatePersona) continue;

    const requiredProviders = getRequiredProviders(candidate);

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

    if (eligible) {
      eligibleBacklogTasks.push(candidate);
      if (!taskToProcess) {
        taskToProcess = candidate;
      }
    }
  }

  if (taskToProcess) {
    workerState.lastTaskId = taskToProcess.id;
    await processTask(taskToProcess);
  } else if (backlogTasks.length === 0) {
    console.log('📭 No backlog tasks with personas found');
  } else {
    console.log('📭 No eligible backlog tasks found (all blocked by provider restrictions)');
  }

  const refreshedTasks = await getAllTasks();
  await processEventBasedPersonaTriggers(refreshedTasks);

  if (taskToProcess) {
    const processedIndex = eligibleBacklogTasks.findIndex(t => t.id === taskToProcess.id);
    const nextTask = processedIndex >= 0 && processedIndex + 1 < eligibleBacklogTasks.length
      ? eligibleBacklogTasks[processedIndex + 1]
      : null;
    console.log(`✅ Worker cycle completed. Next task: ${nextTask ? nextTask.title : 'None'}`);
  } else {
    console.log('✅ Worker cycle completed.');
  }
}

async function runWorker(): Promise<void> {
  if (workerState.isRunning) {
    console.log('⏭️  Worker already running, skipping this cycle');
    return;
  }

  try {
    workerState.isRunning = true;
    workerState.lastRun = new Date().toISOString();
    await saveWorkerState();
    await runWorkerCycle();
  } catch (error) {
    console.error('❌ Worker cycle failed:', error);
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
