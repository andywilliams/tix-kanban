import * as cron from 'node-cron';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { getAllTasks, updateTask, getTask, addTaskLink } from './storage.js';
import { getPersona, createPersonaContext, updatePersonaMemoryAfterTask } from './persona-storage.js';
import { 
  getPipeline, 
  getTaskPipelineState, 
  updateTaskPipelineState 
} from './pipeline-storage.js';
import { Task, Persona, Comment } from '../client/types/index.js';
import { TaskPipelineState, TaskStageHistory } from '../client/types/pipeline.js';
import { initiateAutoReview, executeReviewCycle } from './auto-review.js';
import { getUserSettings } from './user-settings.js';
import { saveReport } from './reports-storage.js';
import { clearExpiredCache } from './github-rate-limit.js';
import { 
  generateStandupEntry, 
  saveStandupEntry, 
  getAllStandupEntries 
} from './standup-storage.js';

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

// Execute Claude CLI with prompt via stdin to avoid TOCTOU and shell injection
function executeClaudeWithStdin(prompt: string, args: string[] = [], timeoutMs: number = 320000, cwd?: string, model?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const claudeArgs = ['-p', ...args];
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
}

let workerState: WorkerState = {
  enabled: false,
  interval: '*/5 * * * *', // Default: every 5 minutes
  isRunning: false,
  workload: 0,
  standupEnabled: true, // Enable standup generation by default
  standupTime: '0 9 * * 1-5', // 9 AM Monday-Friday
};

let cronJob: cron.ScheduledTask | null = null;
let standupCronJob: cron.ScheduledTask | null = null;

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
        const { execSync } = await import('child_process');
        const branch = execSync(
          `gh pr view ${number} --repo ${repo} --json headRefName --jq .headRefName`,
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
    if (prBranches.length > 0) {
      additionalContext += `\n## ⚠️ EXISTING PR(S) — WORK ON THESE BRANCHES\n`;
      additionalContext += `This task already has linked PR(s). You MUST work on the existing branch(es) rather than creating new ones.\n\n`;
      for (const pr of prBranches) {
        additionalContext += `- **PR #${pr.number}** (${pr.repo}): branch \`${pr.branch}\`\n`;
        additionalContext += `  Checkout: \`git fetch origin && git checkout ${pr.branch} && git pull origin ${pr.branch}\`\n`;
      }
      additionalContext += `\nDo NOT create a new branch. Commit and push to the existing branch(es) above.\n`;
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
      model
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
      researchModel
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
    
    if (success) {
      // Research tasks go directly to done - no review needed
      if (isResearchTask(fullTask, persona)) {
        await updateTask(fullTask.id, { 
          status: 'done',
          comments: updatedComments
        });
        console.log(`🔍 Research task completed: ${fullTask.title}`);
      } else {
        // Regular development tasks follow the normal review flow
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
    
    // Clean up expired cache entries periodically
    try {
      await clearExpiredCache();
    } catch (error) {
      console.warn('Failed to clear expired cache:', error);
    }
    
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
  console.log('🛑 Worker and standup scheduler stopped');
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

// Get worker status
export function getWorkerStatus(): WorkerState {
  return { ...workerState };
}