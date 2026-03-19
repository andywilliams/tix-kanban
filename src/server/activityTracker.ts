import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Task } from '../client/types/index.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const ACTIVITY_DIR = path.join(STORAGE_DIR, 'daily-activity');

interface PersonaActivity {
  personaId: string;
  personaName: string;
  tasks: {
    started: Array<{ taskId: string; title: string; timestamp: string; repo?: string }>;
    completed: Array<{ taskId: string; title: string; timestamp: string; repo?: string; pr?: string }>;
    failed: Array<{ taskId: string; title: string; timestamp: string; repo?: string; reason?: string }>;
  };
  prs: {
    created: Array<{ prNumber: number; prUrl: string; taskId: string; timestamp: string; repo: string }>;
    merged: Array<{ prNumber: number; prUrl: string; taskId: string; timestamp: string; repo: string }>;
  };
  reviews: {
    completed: Array<{ taskId: string; title: string; timestamp: string; outcome?: string }>;
  };
}

interface DailyActivity {
  date: string; // YYYY-MM-DD
  personas: Record<string, PersonaActivity>;
}

// Ensure activity directory exists
async function ensureActivityDirectory(): Promise<void> {
  try {
    await fs.mkdir(ACTIVITY_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create activity directory:', error);
    throw error;
  }
}

// Get path for today's activity file
function getTodayActivityPath(): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(ACTIVITY_DIR, `${today}.json`);
}

// Get path for a specific date's activity file
function getActivityPath(date: string): string {
  return path.join(ACTIVITY_DIR, `${date}.json`);
}

// Read daily activity (creates empty if doesn't exist)
async function readDailyActivity(date?: string): Promise<DailyActivity> {
  const activityPath = date ? getActivityPath(date) : getTodayActivityPath();
  const activityDate = date || new Date().toISOString().split('T')[0];
  
  try {
    const content = await fs.readFile(activityPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist yet, create empty structure
      return {
        date: activityDate,
        personas: {}
      };
    }
    console.error('Failed to read daily activity:', error);
    throw error;
  }
}

// Write daily activity (atomic - write to temp file then rename)
async function writeDailyActivity(activity: DailyActivity): Promise<void> {
  const tempPath = `${getActivityPath(activity.date)}.tmp.${Date.now()}`;
  try {
    await ensureActivityDirectory();
    const activityPath = getActivityPath(activity.date);
    const content = JSON.stringify(activity, null, 2);
    
    // Write to temp file first (atomic write pattern)
    await fs.writeFile(tempPath, content, 'utf8');
    
    // Atomic rename (overwrites existing file)
    await fs.rename(tempPath, activityPath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {}
    console.error('Failed to write daily activity:', error);
    throw error;
  }
}

// Ensure persona exists in today's activity
function ensurePersona(activity: DailyActivity, personaId: string, personaName: string): PersonaActivity {
  if (!activity.personas[personaId]) {
    activity.personas[personaId] = {
      personaId,
      personaName,
      tasks: {
        started: [],
        completed: [],
        failed: []
      },
      prs: {
        created: [],
        merged: []
      },
      reviews: {
        completed: []
      }
    };
  }
  return activity.personas[personaId];
}

// Track task started
export async function trackTaskStarted(
  personaId: string,
  personaName: string,
  task: Task
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked (avoid duplicates)
    const alreadyTracked = persona.tasks.started.some(t => t.taskId === task.id);
    if (alreadyTracked) return;
    
    persona.tasks.started.push({
      taskId: task.id,
      title: task.title,
      timestamp: new Date().toISOString(),
      repo: task.repo
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track task started:', error);
    // Non-fatal — don't block task processing
  }
}

// Track task completed
export async function trackTaskCompleted(
  personaId: string,
  personaName: string,
  task: Task,
  prUrl?: string
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked
    const alreadyTracked = persona.tasks.completed.some(t => t.taskId === task.id);
    if (alreadyTracked) return;
    
    persona.tasks.completed.push({
      taskId: task.id,
      title: task.title,
      timestamp: new Date().toISOString(),
      repo: task.repo,
      pr: prUrl
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track task completed:', error);
  }
}

// Track task failed
export async function trackTaskFailed(
  personaId: string,
  personaName: string,
  task: Task,
  reason?: string
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked
    const alreadyTracked = persona.tasks.failed.some(t => t.taskId === task.id);
    if (alreadyTracked) return;
    
    persona.tasks.failed.push({
      taskId: task.id,
      title: task.title,
      timestamp: new Date().toISOString(),
      repo: task.repo,
      reason
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track task failed:', error);
  }
}

// Track PR created
// TODO: Wire up where PRs are created (e.g., in pr-monitor.ts when a PR is opened)
export async function trackPRCreated(
  personaId: string,
  personaName: string,
  taskId: string,
  repo: string,
  prNumber: number,
  prUrl: string
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked
    const alreadyTracked = persona.prs.created.some(pr => pr.prUrl === prUrl);
    if (alreadyTracked) return;
    
    persona.prs.created.push({
      prNumber,
      prUrl,
      taskId,
      timestamp: new Date().toISOString(),
      repo
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track PR created:', error);
  }
}

// Track PR merged
export async function trackPRMerged(
  personaId: string,
  personaName: string,
  taskId: string,
  repo: string,
  prNumber: number,
  prUrl: string
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked
    const alreadyTracked = persona.prs.merged.some(pr => pr.prUrl === prUrl);
    if (alreadyTracked) return;
    
    persona.prs.merged.push({
      prNumber,
      prUrl,
      taskId,
      timestamp: new Date().toISOString(),
      repo
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track PR merged:', error);
  }
}

// Track review completed
// TODO: Wire up where reviews are completed (e.g., in pr-monitor.ts when a review is submitted)
export async function trackReviewCompleted(
  personaId: string,
  personaName: string,
  task: Task,
  outcome?: string
): Promise<void> {
  try {
    const activity = await readDailyActivity();
    const persona = ensurePersona(activity, personaId, personaName);
    
    // Check if already tracked
    const alreadyTracked = persona.reviews.completed.some(r => r.taskId === task.id);
    if (alreadyTracked) return;
    
    persona.reviews.completed.push({
      taskId: task.id,
      title: task.title,
      timestamp: new Date().toISOString(),
      outcome
    });
    
    await writeDailyActivity(activity);
  } catch (error) {
    console.error('Failed to track review completed:', error);
  }
}

// Export activity for a specific date
export async function getDailyActivity(date?: string): Promise<DailyActivity> {
  return await readDailyActivity(date);
}
