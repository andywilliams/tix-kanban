import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { Task } from '../client/types/index.js';
import { parsePRLinks } from './pr-utils.js';
import { updateTask, getTask, getAllTasks } from './storage.js';
import { trackPRMerged, trackPRCreated } from './activityTracker.js';
import { getPersona } from './persona-storage.js';

const execFile = promisify(execFileCallback);

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PR_MONITOR_STATE_FILE = path.join(STORAGE_DIR, 'pr-monitor-state.json');

export interface PRReviewThread {
  id: string;
  createdAt: string;
  isResolved: boolean;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
  }>;
}

export interface PRCheckStatus {
  name: string;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | 'SKIPPED';
  conclusion: string | null;
}

export interface PRMonitorSnapshot {
  repo: string;
  number: number;
  state: 'open' | 'closed' | 'merged' | null;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null;
  ciState: 'SUCCESS' | 'FAILURE' | 'PENDING' | null;
  lastCheckedAt: string;
  lastReviewThreadTimestamp: string | null; // Track newest review thread we've seen
  hasUnresolvedThreads: boolean;
}

export interface PRMonitorState {
  tasks: Record<string, Record<string, PRMonitorSnapshot>>; // taskId -> prKey -> snapshot
}

/**
 * Load PR monitor state from disk
 */
async function loadPRMonitorState(): Promise<PRMonitorState> {
  try {
    const content = await fs.readFile(PR_MONITOR_STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.tasks) {
      return parsed as PRMonitorState;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load PR monitor state:', error);
    }
  }
  return { tasks: {} };
}

/**
 * Save PR monitor state to disk
 */
async function savePRMonitorState(state: PRMonitorState): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.writeFile(PR_MONITOR_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save PR monitor state:', error);
  }
}

/**
 * Fetch PR details via GraphQL to get review threads, mergeable state, and CI status
 */
async function fetchPRDetails(repo: string, number: number): Promise<{
  state: 'open' | 'closed' | 'merged' | null;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null;
  reviewThreads: PRReviewThread[];
  checks: PRCheckStatus[];
} | null> {
  try {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            state
            mergeable
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 10) {
                  nodes {
                    author {
                      login
                    }
                    body
                    createdAt
                  }
                }
              }
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first: 100) {
                      nodes {
                        ... on CheckRun {
                          name
                          status
                          conclusion
                        }
                        ... on StatusContext {
                          context
                          state
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const [owner, repoName] = repo.split('/');

    const { stdout } = await execFile(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `repo=${repoName}`, '-F', `number=${number}`],
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
    );

    const response = JSON.parse(stdout);
    const pr = response.data?.repository?.pullRequest;

    if (!pr) {
      return null;
    }

    // Parse state
    const state = pr.state?.toLowerCase() as 'open' | 'closed' | 'merged' | null;

    // Parse mergeable state
    const mergeable = pr.mergeable as 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null;

    // Parse review threads
    const reviewThreads: PRReviewThread[] = (pr.reviewThreads?.nodes || []).map((thread: any) => ({
      id: thread.id,
      createdAt: thread.comments?.nodes?.[0]?.createdAt || new Date().toISOString(),
      isResolved: thread.isResolved,
      comments: (thread.comments?.nodes || []).map((comment: any) => ({
        author: comment.author?.login || 'unknown',
        body: comment.body || '',
        createdAt: comment.createdAt,
      })),
    }));

    // Parse CI checks
    const checksData = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
    const checks: PRCheckStatus[] = checksData.map((check: any) => {
      if (check.name) {
        // CheckRun
        return {
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
        };
      } else if (check.context) {
        // StatusContext
        return {
          name: check.context,
          status: check.state,
          conclusion: check.state,
        };
      }
      return null;
    }).filter(Boolean);

    return { state, mergeable, reviewThreads, checks };
  } catch (error) {
    console.warn(`Failed to fetch PR details for ${repo}#${number}:`, error);
    return null;
  }
}

/**
 * Determine overall CI state from individual checks
 */
function determineCIState(checks: PRCheckStatus[]): 'SUCCESS' | 'FAILURE' | 'PENDING' | null {
  if (checks.length === 0) return null;

  const hasFailure = checks.some(c =>
    c.conclusion === 'FAILURE' ||
    c.conclusion === 'TIMED_OUT' ||
    c.conclusion === 'CANCELLED' ||
    c.conclusion === 'ACTION_REQUIRED' ||
    c.conclusion === 'STARTUP_FAILURE' ||
    c.status === 'FAILURE' ||
    (c.status as string) === 'ERROR'
  );

  if (hasFailure) return 'FAILURE';

  const hasPending = checks.some(c =>
    c.status === 'PENDING' ||
    (c.status as string) === 'IN_PROGRESS' ||
    (c.status as string) === 'QUEUED' ||
    !c.conclusion
  );

  if (hasPending) return 'PENDING';

  const allSuccess = checks.every(c =>
    c.conclusion === 'SUCCESS' ||
    c.conclusion === 'NEUTRAL' ||
    c.conclusion === 'SKIPPED' ||
    c.status === 'SUCCESS'
  );

  return allSuccess ? 'SUCCESS' : null;
}

/**
 * Check if there are new unresolved review threads since last check
 */
function hasNewUnresolvedThreads(
  threads: PRReviewThread[],
  lastCheckedTimestamp: string | null
): { hasNew: boolean; latestTimestamp: string | null; unresolvedCount: number } {
  const unresolved = threads.filter(t => !t.isResolved);
  const unresolvedCount = unresolved.length;

  if (unresolvedCount === 0) {
    return { hasNew: false, latestTimestamp: null, unresolvedCount: 0 };
  }

  // Find the most recent unresolved thread
  const latestThread = unresolved.reduce((latest, thread) => {
    if (!latest || new Date(thread.createdAt) > new Date(latest.createdAt)) {
      return thread;
    }
    return latest;
  }, unresolved[0]);

  const latestTimestamp = latestThread.createdAt;

  // Check if any unresolved threads are newer than last checked timestamp
  const hasNew = !lastCheckedTimestamp || new Date(latestTimestamp) > new Date(lastCheckedTimestamp);

  return { hasNew, latestTimestamp, unresolvedCount };
}

/**
 * Process all review tasks to monitor their PRs
 */
export async function processReviewTasksPRStatus(): Promise<void> {
  try {
    console.log('🔍 Monitoring PRs for review tasks...');

    const state = await loadPRMonitorState();
    const tasks = await getAllTasks();

    // Get only tasks in review or verified status that have PR links
    const reviewTasks = tasks.filter(
      t => (t.status === 'review' || t.status === 'verified') && (t.links || []).some(l => l.type === 'pr' || l.url?.includes('/pull/'))
    );

    if (reviewTasks.length === 0) {
      console.log('📭 No review tasks with PRs to monitor');
      return;
    }

    console.log(`📊 Found ${reviewTasks.length} task(s) with PRs to monitor`);

    for (const task of reviewTasks) {
      const fullTask = await getTask(task.id);
      if (!fullTask) continue;

      const prLinks = parsePRLinks(fullTask.links);
      if (prLinks.length === 0) continue;

      // Initialize task state if not exists
      if (!state.tasks[task.id]) {
        state.tasks[task.id] = {};
      }

      for (const pr of prLinks) {
        const prKey = pr.key;
        const previousSnapshot = state.tasks[task.id][prKey];

        // Fetch current PR details
        const details = await fetchPRDetails(pr.repo, pr.number);
        if (!details) {
          console.warn(`⚠️ Could not fetch PR details for ${prKey}`);
          continue;
        }

        const ciState = determineCIState(details.checks);
        const { hasNew: hasNewThreads, latestTimestamp, unresolvedCount } = hasNewUnresolvedThreads(
          details.reviewThreads,
          previousSnapshot?.lastReviewThreadTimestamp || null
        );

        // Create new snapshot
        const currentSnapshot: PRMonitorSnapshot = {
          repo: pr.repo,
          number: pr.number,
          state: details.state,
          mergeable: details.mergeable,
          ciState,
          lastCheckedAt: new Date().toISOString(),
          lastReviewThreadTimestamp: latestTimestamp,
          hasUnresolvedThreads: unresolvedCount > 0,
        };

        // Take action based on PR state changes BEFORE storing snapshot
        // (Bug 3 fix: process transitions first, then store snapshot after)
        await handlePRStateChanges(fullTask, pr, previousSnapshot, currentSnapshot, hasNewThreads, unresolvedCount);

        // Bug 1 fix: re-fetch entire task (not just comments) to get latest status
        // before processing next PR
        const updatedTask = await getTask(task.id);
        if (!updatedTask) continue;
        
        // Update fullTask with fresh data for next iteration
        Object.assign(fullTask, updatedTask);

        // Store snapshot AFTER handlePRStateChanges runs
        // (Bug 3 fix: this ensures subsequent transitions aren't missed)
        state.tasks[task.id][prKey] = currentSnapshot;
      }
    }

    // Clean up state for deleted tasks
    const existingTaskIds = new Set(tasks.map(t => t.id));
    for (const taskId of Object.keys(state.tasks)) {
      if (!existingTaskIds.has(taskId)) {
        delete state.tasks[taskId];
      }
    }

    await savePRMonitorState(state);
    console.log('✅ PR monitoring complete');
  } catch (error) {
    console.error('❌ PR monitoring failed:', error);
  }
}

/**
 * Handle PR state changes and take appropriate actions
 */
async function handlePRStateChanges(
  task: Task,
  pr: { repo: string; number: number; key: string },
  previous: PRMonitorSnapshot | undefined,
  current: PRMonitorSnapshot,
  hasNewThreads: boolean,
  unresolvedCount: number
): Promise<void> {
  const prRef = `${pr.repo}#${pr.number}`;

  // On first observation (no previous snapshot), check current state and take immediate action
  // if the PR is already in a terminal/actionable state
  if (!previous) {
    console.log(`📝 First observation for ${prRef}: state=${current.state}, ciState=${current.ciState}, mergeable=${current.mergeable}, hasThreads=${current.hasUnresolvedThreads}`);

    // 1. PR already merged → move to done
    if (current.state === 'merged' && (task.status === 'review' || task.status === 'verified')) {
      console.log(`✅ PR already merged for task ${task.id}: ${prRef}`);
      await updateTask(task.id, {
        status: 'done',
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `✅ **PR already merged**: ${prRef}\n\nThis task is now complete.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
      return;
    }

    // 2. CI already failing → notify
    if (current.ciState === 'FAILURE' && (task.status === 'review' || task.status === 'verified')) {
      console.log(`❌ CI already failed for task ${task.id}: ${prRef}`);
      await updateTask(task.id, {
        ...(task.status === 'verified' ? { status: 'review' } : {}),
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `❌ **CI checks already failed** on ${prRef}\n\nPlease review the failed checks and fix any issues.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
      return;
    }

    // 3. Already has merge conflicts → notify
    if (current.mergeable === 'CONFLICTING' && (task.status === 'review' || task.status === 'verified')) {
      console.log(`⚠️ Merge conflicts already detected for task ${task.id}: ${prRef}`);
      await updateTask(task.id, {
        ...(task.status === 'verified' ? { status: 'review' } : {}),
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `⚠️ **Merge conflicts already detected** on ${prRef}\n\nPlease rebase or merge the target branch to resolve conflicts.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
      // TODO: Integrate with persona system to spawn developer for rebase
      return;
    }

    // 4. Already has review threads → notify
    if (current.hasUnresolvedThreads && unresolvedCount > 0 && (task.status === 'review' || task.status === 'verified')) {
      console.log(`💬 Review threads already present for task ${task.id}: ${prRef} (${unresolvedCount} unresolved)`);
      await updateTask(task.id, {
        ...(task.status === 'verified' ? { status: 'review' } : {}),
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `💬 **Review comments already present** on ${prRef}\n\n${unresolvedCount} unresolved thread(s) found. Please address the feedback.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
      // Keep in review status - human or persona needs to address comments
      return;
    }

    // 5. First observation: PR is already clean → notify ready to merge
    if (
      current.state === 'open' &&
      current.ciState === 'SUCCESS' &&
      !current.hasUnresolvedThreads &&
      current.mergeable === 'MERGEABLE' &&
      (task.status === 'review' || task.status === 'verified')
    ) {
      console.log(`✅ PR is clean and ready for task ${task.id} (first observation): ${prRef}`);
      await updateTask(task.id, {
        status: 'verified',
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `✅ **PR is ready to merge**: ${prRef}\n\n- ✅ CI checks passed\n- ✅ No unresolved review threads\n- ✅ No merge conflicts\n\nThis task is verified and ready for merge.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
      return;
    }

    // Track PR creation if it's open (first time we see it)
    if (current.state === 'open') {
      const persona = await getPersona(task.persona);
      const personaName = persona?.name || task.persona;
      const prUrl = `https://github.com/${current.repo}/pull/${current.number}`;
      await trackPRCreated(task.persona, personaName, task.id, current.repo, current.number, prUrl);
    }

    // No actionable state found, just record initial state
    console.log(`📝 Initial state recorded for ${prRef}: state=${current.state}, ciState=${current.ciState}, mergeable=${current.mergeable}`);
    return;
  }

  // 1. PR merged → move to done (only if in review/verified status)
  // Bug 2 fix: Don't move auto-review/in-progress tasks to done here -
  // let the auto-review system handle cleanup (deleteTaskReviewState, updatePersonaStats)
  if (current.state === 'merged' && previous.state !== 'merged') {
    // Only move to done if task is in review status
    // Tasks in auto-review or in-progress should be handled by their respective systems
    if (task.status === 'review' || task.status === 'verified') {
      console.log(`✅ PR merged for task ${task.id}: ${prRef}`);
      await updateTask(task.id, {
        status: 'done',
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `✅ **PR merged**: ${prRef}\n\nThis task is now complete.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });

      // Track PR merged activity
      if (task.persona) {
        const [repo] = prRef.split('#');
        const prNumber = parseInt(prRef.split('#')[1] || '0', 10);
        const prUrl = `https://github.com/${current.repo}/pull/${current.number}`;
        
        // Get persona name dynamically using getPersona lookup
        const persona = await getPersona(task.persona);
        const personaName = persona?.name || task.persona;
        
        await trackPRMerged(task.persona, personaName, task.id, current.repo, current.number, prUrl);
      }
    } else {
      console.log(`ℹ️ PR merged for task ${task.id}: ${prRef}, but task is in "${task.status}" status - skipping auto-move to done`);
    }
    return;
  }

  // 2. New unresolved review threads → spawn developer to address
  if (hasNewThreads && (task.status === 'review' || task.status === 'verified')) {
    console.log(`💬 New review comments for task ${task.id}: ${prRef} (${unresolvedCount} unresolved)`);
    // TODO: Integrate with persona system to spawn developer
    await updateTask(task.id, {
      ...(task.status === 'verified' ? { status: 'review' } : {}),
      comments: [
        ...(task.comments || []),
        {
          id: Math.random().toString(36).substr(2, 9),
          taskId: task.id,
          body: `💬 **New review comments detected** on ${prRef}\n\n${unresolvedCount} unresolved thread(s) found. Please address the feedback.`,
          author: 'PR Monitor (system)',
          createdAt: new Date(),
        },
      ],
    });
    // Keep in review status - human or persona needs to address comments
    return;
  }

  // 3. CI failure → notify and keep in review
  if ((task.status === 'review' || task.status === 'verified') && current.ciState === 'FAILURE' && previous.ciState !== 'FAILURE') {
    console.log(`❌ CI failed for task ${task.id}: ${prRef}`);
    await updateTask(task.id, {
      ...(task.status === 'verified' ? { status: 'review' } : {}),
      comments: [
        ...(task.comments || []),
        {
          id: Math.random().toString(36).substr(2, 9),
          taskId: task.id,
          body: `❌ **CI checks failed** on ${prRef}\n\nPlease review the failed checks and fix any issues.`,
          author: 'PR Monitor (system)',
          createdAt: new Date(),
        },
      ],
    });
    return;
  }

  // 4. Merge conflicts → spawn developer to rebase
  if ((task.status === 'review' || task.status === 'verified') && current.mergeable === 'CONFLICTING' && previous.mergeable !== 'CONFLICTING') {
    console.log(`⚠️ Merge conflicts detected for task ${task.id}: ${prRef}`);
    await updateTask(task.id, {
      ...(task.status === 'verified' ? { status: 'review' } : {}),
      comments: [
        ...(task.comments || []),
        {
          id: Math.random().toString(36).substr(2, 9),
          taskId: task.id,
          body: `⚠️ **Merge conflicts detected** on ${prRef}\n\nPlease rebase or merge the target branch to resolve conflicts.`,
          author: 'PR Monitor (system)',
          createdAt: new Date(),
        },
      ],
    });
    // TODO: Integrate with persona system to spawn developer for rebase
    return;
  }

  // 5. PR clean (CI green, no unresolved threads, mergeable) → add ready-to-merge comment
  if (
    task.status === 'review' &&
    current.state === 'open' &&
    current.ciState === 'SUCCESS' &&
    !current.hasUnresolvedThreads &&
    current.mergeable === 'MERGEABLE'
  ) {
    // Only add comment if this is a transition (not already clean)
    const wasClean =
      previous.ciState === 'SUCCESS' &&
      !previous.hasUnresolvedThreads &&
      previous.mergeable === 'MERGEABLE';

    if (!wasClean) {
      console.log(`✅ PR is clean and ready for task ${task.id}: ${prRef}`);
      // Keep in review but add a comment indicating it's ready to merge
      await updateTask(task.id, {
        status: 'verified',
        comments: [
          ...(task.comments || []),
          {
            id: Math.random().toString(36).substr(2, 9),
            taskId: task.id,
            body: `✅ **PR is ready to merge**: ${prRef}\n\n- ✅ CI checks passed\n- ✅ No unresolved review threads\n- ✅ No merge conflicts\n\nThis task is verified and ready for merge.`,
            author: 'PR Monitor (system)',
            createdAt: new Date(),
          },
        ],
      });
    }
  }
}
