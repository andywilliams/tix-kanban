import * as cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAllTasks, updateTask, getTask } from './storage.js';
import { getPersona, createPersonaContext, updatePersonaMemoryAfterTask } from './persona-storage.js';
import { 
  getPipeline, 
  getTaskPipelineState, 
  updateTaskPipelineState 
} from './pipeline-storage.js';
import { Task, Persona, Comment } from '../client/types/index.js';
import { TaskPipelineState, TaskStageHistory } from '../client/types/pipeline.js';
import { initiateAutoReview, executeReviewCycle } from './auto-review.js';

const execAsync = promisify(exec);

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');
const WORKER_STATE_FILE = path.join(STORAGE_DIR, 'worker-state.json');

interface WorkerState {
  enabled: boolean;
  interval: string; // cron expression
  lastRun?: string;
  lastTaskId?: string;
  isRunning: boolean;
  workload: number; // number of active tasks
}

let workerState: WorkerState = {
  enabled: false,
  interval: '*/5 * * * *', // Default: every 5 minutes
  isRunning: false,
  workload: 0
};

let cronJob: cron.ScheduledTask | null = null;

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
    workerState = { ...workerState, ...JSON.parse(content) };
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

// Generate API reference for Claude sessions
// @ts-ignore TS6133
function generateAPIReference(): string {
  return `## Tix-Kanban API Reference

You have access to the tix-kanban API running at http://localhost:3001/api

⚡ **IMPORTANT:** You are running in agentic mode with file editing and command execution enabled!
- Use the Edit tool to modify files
- Use the exec tool to run git commands, tests, builds, etc.
- You can actually DO the work described in the task, not just describe it

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

// Spawn AI session for a task using OpenClaw
async function spawnAISession(task: Task, persona: Persona): Promise<{ output: string; success: boolean }> {
  try {
    console.log(`🤖 Spawning AI session for task: ${task.title}`);
    
    // Create context with memory injection and full task history
    let additionalContext = '';
    if (task.repo) additionalContext += `Repository: ${task.repo}\n`;
    if (task.comments?.length) additionalContext += `Comments: ${task.comments.length} existing comments\n`;
    if (task.links?.length) additionalContext += `Links: ${task.links.length} existing links\n`;
    
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
    
    // Create a temporary file with the prompt
    const tempPromptFile = path.join(os.tmpdir(), `tix-prompt-${task.id}.txt`);
    await fs.writeFile(tempPromptFile, prompt, 'utf8');
    
    // Use Claude CLI to run the task in agentic mode
    const { stdout, stderr } = await execAsync(
      `claude -p "$(cat \"${tempPromptFile}\")" --allowedTools Edit,exec,Read,Write --timeoutSeconds 300`,
      { timeout: 320000 } // 5.3 min timeout (slightly longer than Claude timeout)
    );
    
    // Clean up temp file
    await fs.unlink(tempPromptFile).catch(() => {});
    
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

// Process a single task
async function processTask(task: Task): Promise<void> {
  try {
    console.log(`📋 Processing task: ${task.title}`);
    
    // Move task to in-progress
    await updateTask(task.id, { status: 'in-progress' });
    
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
    
    // Spawn AI session with full task context
    const { output, success } = await spawnAISession(fullTask, persona);
    
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
    
    if (success) {
      // Check if task is part of a pipeline
      const pipelineState = await getTaskPipelineState(fullTask.id);
      if (pipelineState && fullTask.pipelineId) {
        await advanceTaskInPipeline(fullTask, pipelineState, updatedComments, output);
      } else {
        // No pipeline - try auto-review first, then fall back to manual review
        const reviewState = await initiateAutoReview(fullTask, persona.id);
        if (reviewState) {
          // Auto-review initiated - move to auto-review status
          await updateTask(fullTask.id, { 
            status: 'auto-review',
            comments: updatedComments
          });
          
          // Execute the first review cycle
          const reviewResult = await executeReviewCycle(fullTask.id);
          console.log(`🔍 Auto-review result for ${fullTask.title}: ${reviewResult}`);
        } else {
          // Auto-review disabled or failed - move directly to human review
          await updateTask(fullTask.id, { 
            status: 'review',
            comments: updatedComments
          });
        }
      }
    } else {
      // Task failed - back to backlog
      await updateTask(fullTask.id, { 
        status: 'backlog',
        comments: updatedComments
      });
    }
    
    console.log(`${success ? '✅' : '❌'} Task processed: ${fullTask.title}`);
  } catch (error) {
    console.error(`Failed to process task ${task.id}:`, error);
    
    // Move task back to backlog on error
    await updateTask(task.id, { status: 'backlog' });
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

// Main worker function
async function runWorker(): Promise<void> {
  if (workerState.isRunning) {
    console.log('⏭️  Worker already running, skipping this cycle');
    return;
  }
  
  try {
    workerState.isRunning = true;
    workerState.lastRun = new Date().toISOString();
    await saveWorkerState();
    
    console.log('🔄 Worker cycle starting...');
    
    // First, process any auto-review tasks
    await processAutoReviewTasks();
    
    // Get all tasks
    const tasks = await getAllTasks();
    const backlogTasks = tasks
      .filter(task => task.status === 'backlog' && task.persona)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Highest priority first
    
    workerState.workload = tasks.filter(task => 
      task.status === 'backlog' || task.status === 'in-progress' || task.status === 'auto-review'
    ).length;
    
    if (backlogTasks.length === 0) {
      console.log('📭 No backlog tasks with personas found');
      return;
    }
    
    // Adaptive interval based on workload
    if (workerState.workload >= 10) {
      workerState.interval = '*/2 * * * *'; // Every 2 minutes
    } else if (workerState.workload >= 5) {
      workerState.interval = '*/5 * * * *'; // Every 5 minutes
    } else {
      workerState.interval = '*/10 * * * *'; // Every 10 minutes
    }
    
    // Process the highest priority task
    const taskToProcess = backlogTasks[0];
    workerState.lastTaskId = taskToProcess.id;
    
    await processTask(taskToProcess);
    
    console.log(`✅ Worker cycle completed. Next task: ${backlogTasks.length > 1 ? backlogTasks[1].title : 'None'}`);
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
    
    if (cronJob) {
      cronJob.stop();
    }
    
    if (workerState.enabled) {
      cronJob = cron.schedule(workerState.interval, runWorker, {
        scheduled: false
      });
      cronJob.start();
      console.log(`🚀 Worker started with interval: ${workerState.interval}`);
    } else {
      console.log('💤 Worker is disabled');
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
  console.log('🛑 Worker stopped');
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

// Get worker status
export function getWorkerStatus(): WorkerState {
  return { ...workerState };
}