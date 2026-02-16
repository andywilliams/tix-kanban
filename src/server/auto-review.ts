import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Task, Comment } from '../client/types/index.js';
import { getPersona } from './persona-storage.js';
import { updateTask, getTask } from './storage.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const AUTO_REVIEW_CONFIG_FILE = path.join(STORAGE_DIR, 'auto-review-config.json');

export interface AutoReviewConfig {
  enabled: boolean;
  defaultReviewerPersona: string;
  maxReviewCycles: number;
  taskTypeReviewers: Record<string, string>; // task tags -> reviewer persona
  escalationOnMaxCycles: 'human-review' | 'auto-approve'; 
}

export interface TaskReviewState {
  taskId: string;
  currentReviewCycle: number;
  reviewerId: string;
  workerId: string;
  reviewHistory: ReviewAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewAttempt {
  cycle: number;
  reviewerId: string;
  decision: 'approve' | 'reject';
  feedback: string;
  timestamp: Date;
  confidenceScore?: number; // 0-1, how confident the reviewer is
}

// Default configuration
const DEFAULT_CONFIG: AutoReviewConfig = {
  enabled: true,
  defaultReviewerPersona: 'qa-engineer',
  maxReviewCycles: 3,
  taskTypeReviewers: {
    'bug': 'qa-engineer',
    'security': 'security-reviewer', 
    'documentation': 'tech-writer',
    'frontend': 'ui-reviewer',
    'backend': 'code-reviewer'
  },
  escalationOnMaxCycles: 'human-review'
};

// Load auto-review configuration
async function loadAutoReviewConfig(): Promise<AutoReviewConfig> {
  try {
    const content = await fs.readFile(AUTO_REVIEW_CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Create default config file
      await saveAutoReviewConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    console.error('Failed to load auto-review config:', error);
    return DEFAULT_CONFIG;
  }
}

// Save auto-review configuration
async function saveAutoReviewConfig(config: AutoReviewConfig): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(AUTO_REVIEW_CONFIG_FILE, content, 'utf8');
  } catch (error) {
    console.error('Failed to save auto-review config:', error);
  }
}

// Get review state file path
function getReviewStateFilePath(taskId: string): string {
  return path.join(STORAGE_DIR, 'review-states', `${taskId}.json`);
}

// Load task review state
async function loadTaskReviewState(taskId: string): Promise<TaskReviewState | null> {
  try {
    const filePath = getReviewStateFilePath(taskId);
    const content = await fs.readFile(filePath, 'utf8');
    const state = JSON.parse(content);
    
    // Convert date strings back to Date objects
    state.createdAt = new Date(state.createdAt);
    state.updatedAt = new Date(state.updatedAt);
    state.reviewHistory = state.reviewHistory.map((attempt: any) => ({
      ...attempt,
      timestamp: new Date(attempt.timestamp)
    }));
    
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to load review state for task ${taskId}:`, error);
    }
    return null;
  }
}

// Save task review state
async function saveTaskReviewState(state: TaskReviewState): Promise<void> {
  try {
    const reviewStatesDir = path.join(STORAGE_DIR, 'review-states');
    await fs.mkdir(reviewStatesDir, { recursive: true });
    
    const filePath = getReviewStateFilePath(state.taskId);
    const content = JSON.stringify({
      ...state,
      updatedAt: new Date()
    }, null, 2);
    await fs.writeFile(filePath, content, 'utf8');
  } catch (error) {
    console.error(`Failed to save review state for task ${state.taskId}:`, error);
  }
}

// Delete task review state
async function deleteTaskReviewState(taskId: string): Promise<void> {
  try {
    const filePath = getReviewStateFilePath(taskId);
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to delete review state for task ${taskId}:`, error);
    }
  }
}

// Determine the best reviewer for a task
function selectReviewer(task: Task, config: AutoReviewConfig): string {
  // Check task-type specific reviewers first
  for (const tag of task.tags || []) {
    if (config.taskTypeReviewers[tag]) {
      return config.taskTypeReviewers[tag];
    }
  }
  
  // Fall back to default reviewer
  return config.defaultReviewerPersona;
}

// Spawn AI review session
async function spawnReviewSession(
  task: Task, 
  reviewerPersonaId: string, 
  reviewState: TaskReviewState
): Promise<{ decision: 'approve' | 'reject'; feedback: string; confidence: number }> {
  try {
    console.log(`🔍 Spawning review session for task: ${task.title} (reviewer: ${reviewerPersonaId})`);
    
    const reviewer = await getPersona(reviewerPersonaId);
    if (!reviewer) {
      throw new Error(`Reviewer persona ${reviewerPersonaId} not found`);
    }
    
    // Create specialized review prompt
    const reviewPrompt = await createReviewContext(task, reviewer.id, reviewState);
    
    // Create temporary file with the review prompt
    const tempPromptFile = path.join(os.tmpdir(), `tix-review-${task.id}.txt`);
    await fs.writeFile(tempPromptFile, reviewPrompt, 'utf8');
    
    // Use Claude CLI to run the review session
    const { stdout, stderr } = await execAsync(
      `cat "${tempPromptFile}" | claude --print`,
      { timeout: 180000 } // 3 min timeout
    );
    
    // Clean up temp file
    await fs.unlink(tempPromptFile).catch(() => {});
    
    if (stderr) {
      console.error(`Review session stderr:`, stderr);
    }
    
    const output = stdout.trim();
    
    // Parse the review output to extract decision, feedback, and confidence
    const parsed = parseReviewOutput(output);
    
    return parsed;
  } catch (error) {
    console.error(`Failed to spawn review session for task ${task.id}:`, error);
    return {
      decision: 'reject',
      feedback: `Review session failed: ${error}`,
      confidence: 0
    };
  }
}

// Create specialized review context for the AI reviewer
async function createReviewContext(
  task: Task, 
  _reviewerPersonaId: string, 
  reviewState: TaskReviewState
): Promise<string> {
  const reviewCycle = reviewState.currentReviewCycle;
  const previousReviews = reviewState.reviewHistory
    .map(attempt => `Cycle ${attempt.cycle}: ${attempt.decision.toUpperCase()} - ${attempt.feedback}`)
    .join('\n');
    
  return `## AUTO-REVIEW QUALITY GATE

You are conducting cycle ${reviewCycle} of quality review for the completed task.

## TASK DETAILS
**Title:** ${task.title}
**Description:** ${task.description}
**Tags:** ${task.tags?.join(', ') || 'None'}
**Repository:** ${task.repo || 'Not specified'}

## TASK HISTORY
**Comments (${task.comments?.length || 0}):**
${task.comments?.map(c => `- ${c.author}: ${c.body}`).join('\n') || 'No comments'}

**Links (${task.links?.length || 0}):**
${task.links?.map(l => `- ${l.type}: ${l.title} (${l.url})`).join('\n') || 'No links'}

## PREVIOUS REVIEW CYCLES
${previousReviews || 'No previous reviews'}

## YOUR ROLE AS REVIEWER
Your job is to evaluate if the work completed meets quality standards for ${reviewCycle === 1 ? 'first review' : `review cycle ${reviewCycle}`}.

## REVIEW CRITERIA
Evaluate these aspects:
1. **Completeness** - Does the work address all requirements in the task?
2. **Quality** - Is the work well-executed and following best practices?
3. **Documentation** - Are changes properly documented/commented?
4. **Testing** - Are appropriate tests included (if applicable)?
5. **Security** - Are there any obvious security concerns?
6. **Readiness** - Is this ready for human review or deployment?

## DECISION FORMATS
You must output your decision in this exact format:

**For APPROVAL:**
DECISION: APPROVE
CONFIDENCE: 0.85
FEEDBACK: [Your detailed feedback explaining why this work meets quality standards]

**For REJECTION:**
DECISION: REJECT  
CONFIDENCE: 0.90
FEEDBACK: [Specific issues that need to be addressed before approval]

## GUIDELINES
- Be thorough but fair
- If work is 80%+ complete with minor issues, consider approval with notes
- Only reject if there are significant quality, security, or completeness issues
- Provide constructive, actionable feedback
- Confidence should be 0.0-1.0 (higher = more confident in your decision)
- Focus on what matters most for this specific task type and context

## CONTEXT
- This is cycle ${reviewCycle} of max ${3} review cycles
- Worker completed this task and it needs quality validation before human review
- Your feedback will guide either approval → human review OR rejection → back to worker`;
}

// Parse AI reviewer output to extract decision, feedback, and confidence
function parseReviewOutput(output: string): { decision: 'approve' | 'reject'; feedback: string; confidence: number } {
  try {
    // Look for the decision format in the output
    const decisionMatch = output.match(/DECISION:\s*(APPROVE|REJECT)/i);
    const confidenceMatch = output.match(/CONFIDENCE:\s*([\d.]+)/);
    const feedbackMatch = output.match(/FEEDBACK:\s*([\s\S]*?)$/m);
    
    if (!decisionMatch) {
      console.warn('Could not parse review decision from output:', output);
      return {
        decision: 'reject',
        feedback: 'Review output was malformed - could not parse decision',
        confidence: 0.1
      };
    }
    
    const decision = decisionMatch[1].toLowerCase() as 'approve' | 'reject';
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
    const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'No feedback provided';
    
    return { decision, confidence, feedback };
  } catch (error) {
    console.error('Failed to parse review output:', error);
    return {
      decision: 'reject',
      feedback: `Failed to parse review output: ${error}`,
      confidence: 0
    };
  }
}

// Initialize auto-review for a task that just completed work
export async function initiateAutoReview(
  task: Task, 
  workerPersonaId: string
): Promise<TaskReviewState | null> {
  try {
    const config = await loadAutoReviewConfig();
    
    if (!config.enabled) {
      console.log('Auto-review is disabled, skipping');
      return null;
    }
    
    const reviewerId = selectReviewer(task, config);
    
    // Create initial review state
    const reviewState: TaskReviewState = {
      taskId: task.id,
      currentReviewCycle: 1,
      reviewerId,
      workerId: workerPersonaId,
      reviewHistory: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await saveTaskReviewState(reviewState);
    
    console.log(`🔍 Initiated auto-review for task ${task.title} (reviewer: ${reviewerId})`);
    return reviewState;
  } catch (error) {
    console.error(`Failed to initiate auto-review for task ${task.id}:`, error);
    return null;
  }
}

// Execute a review cycle
export async function executeReviewCycle(taskId: string): Promise<'approved' | 'rejected' | 'escalated'> {
  try {
    const config = await loadAutoReviewConfig();
    const task = await getTask(taskId);
    const reviewState = await loadTaskReviewState(taskId);
    
    if (!task || !reviewState) {
      console.error(`Missing task or review state for ${taskId}`);
      return 'escalated';
    }
    
    // Check if we've exceeded max cycles
    if (reviewState.currentReviewCycle > config.maxReviewCycles) {
      console.log(`⚠️ Max review cycles exceeded for task ${task.title}, escalating`);
      await handleMaxCyclesReached(task, reviewState, config);
      return 'escalated';
    }
    
    // Execute the review
    const reviewResult = await spawnReviewSession(task, reviewState.reviewerId, reviewState);
    
    // Record this review attempt
    const reviewAttempt: ReviewAttempt = {
      cycle: reviewState.currentReviewCycle,
      reviewerId: reviewState.reviewerId,
      decision: reviewResult.decision,
      feedback: reviewResult.feedback,
      timestamp: new Date(),
      confidenceScore: reviewResult.confidence
    };
    
    // Update review state
    const updatedReviewState: TaskReviewState = {
      ...reviewState,
      currentReviewCycle: reviewState.currentReviewCycle + 1,
      reviewHistory: [...reviewState.reviewHistory, reviewAttempt],
      updatedAt: new Date()
    };
    
    await saveTaskReviewState(updatedReviewState);
    
    // Add review comment to task
    const reviewComment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      taskId: task.id,
      body: `**AUTO-REVIEW CYCLE ${reviewAttempt.cycle}** (${reviewResult.decision.toUpperCase()})\n\n${reviewResult.feedback}\n\n*Confidence: ${Math.round(reviewResult.confidence * 100)}% | Reviewer: ${reviewState.reviewerId}*`,
      author: `${reviewState.reviewerId} (AI Reviewer)`,
      createdAt: new Date(),
    };
    
    const updatedComments = [...(task.comments || []), reviewComment];
    
    if (reviewResult.decision === 'approve') {
      // Approved - move to human review
      await updateTask(taskId, { 
        status: 'review',
        comments: updatedComments 
      });
      
      // Clean up review state
      await deleteTaskReviewState(taskId);
      
      console.log(`✅ Auto-review approved task: ${task.title}`);
      return 'approved';
    } else {
      // Rejected - send back to worker for more work
      await updateTask(taskId, { 
        status: 'backlog',
        assignee: reviewState.workerId,
        persona: reviewState.workerId,
        comments: updatedComments
      });
      
      console.log(`❌ Auto-review rejected task: ${task.title} (cycle ${reviewAttempt.cycle})`);
      return 'rejected';
    }
  } catch (error) {
    console.error(`Failed to execute review cycle for task ${taskId}:`, error);
    return 'escalated';
  }
}

// Handle case where max review cycles is reached
async function handleMaxCyclesReached(
  task: Task, 
  reviewState: TaskReviewState, 
  config: AutoReviewConfig
): Promise<void> {
  const escalationComment: Comment = {
    id: Math.random().toString(36).substr(2, 9),
    taskId: task.id,
    body: `**AUTO-REVIEW ESCALATION**\n\nReached maximum review cycles (${config.maxReviewCycles}). This task requires human intervention.\n\n**Review Summary:**\n${reviewState.reviewHistory.map(attempt => 
      `- Cycle ${attempt.cycle}: ${attempt.decision.toUpperCase()} (${Math.round((attempt.confidenceScore || 0) * 100)}%)`
    ).join('\n')}\n\n*Escalation policy: ${config.escalationOnMaxCycles}*`,
    author: 'Auto-Review System',
    createdAt: new Date(),
  };
  
  const updatedComments = [...(task.comments || []), escalationComment];
  
  if (config.escalationOnMaxCycles === 'human-review') {
    await updateTask(task.id, { 
      status: 'review',
      comments: updatedComments 
    });
  } else {
    // Auto-approve
    await updateTask(task.id, { 
      status: 'done',
      comments: updatedComments 
    });
  }
  
  // Clean up review state
  await deleteTaskReviewState(task.id);
}

// Public API for configuration management
export async function getAutoReviewConfig(): Promise<AutoReviewConfig> {
  return await loadAutoReviewConfig();
}

export async function updateAutoReviewConfig(updates: Partial<AutoReviewConfig>): Promise<AutoReviewConfig> {
  const currentConfig = await loadAutoReviewConfig();
  const newConfig = { ...currentConfig, ...updates };
  await saveAutoReviewConfig(newConfig);
  return newConfig;
}

// Get review state for a task (for debugging/monitoring)
export async function getTaskReviewState(taskId: string): Promise<TaskReviewState | null> {
  return await loadTaskReviewState(taskId);
}