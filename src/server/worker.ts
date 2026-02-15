import * as cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAllTasks, updateTask } from './storage.js';
import { getPersona } from './persona-storage.js';
import { Task, Persona } from '../client/types/index.js';

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

// Spawn AI session for a task using OpenClaw
async function spawnAISession(task: Task, persona: Persona): Promise<string> {
  try {
    console.log(`🤖 Spawning AI session for task: ${task.title}`);
    
    const prompt = `${persona.prompt}\n\n## Task Details\nTitle: ${task.title}\nDescription: ${task.description}\nPriority: ${task.priority}\nTags: ${task.tags.join(', ')}\n\nPlease work on this task and provide your output.`;
    
    // Create a temporary file with the prompt
    const tempPromptFile = path.join(os.tmpdir(), `tix-prompt-${task.id}.txt`);
    await fs.writeFile(tempPromptFile, prompt, 'utf8');
    
    // Use OpenClaw CLI to run the session
    // Note: This assumes OpenClaw is available in PATH and configured
    const { stdout, stderr } = await execAsync(`openclaw run --file "${tempPromptFile}" --timeout 300`);
    
    // Clean up temp file
    await fs.unlink(tempPromptFile).catch(() => {});
    
    if (stderr) {
      console.error(`AI session stderr:`, stderr);
    }
    
    return stdout.trim();
  } catch (error) {
    console.error(`Failed to spawn AI session for task ${task.id}:`, error);
    throw error;
  }
}

// Process a single task
async function processTask(task: Task): Promise<void> {
  try {
    console.log(`📋 Processing task: ${task.title}`);
    
    // Move task to in-progress
    await updateTask(task.id, { status: 'in-progress' });
    
    // Load persona
    const persona = task.persona ? await getPersona(task.persona) : null;
    if (!persona) {
      console.log(`⚠️  No persona found for task ${task.id}, skipping`);
      return;
    }
    
    // Spawn AI session
    const output = await spawnAISession(task, persona);
    
    // For now, just add the output as a comment (we'd need to implement comments API)
    // Move task to review
    await updateTask(task.id, { 
      status: 'review',
      description: `${task.description}\n\n## AI Output\n${output}`
    });
    
    console.log(`✅ Task processed: ${task.title}`);
  } catch (error) {
    console.error(`Failed to process task ${task.id}:`, error);
    
    // Move task back to backlog on error
    await updateTask(task.id, { status: 'backlog' });
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
    
    // Get all tasks
    const tasks = await getAllTasks();
    const backlogTasks = tasks
      .filter(task => task.status === 'backlog' && task.persona)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0)); // Highest priority first
    
    workerState.workload = tasks.filter(task => 
      task.status === 'backlog' || task.status === 'in-progress'
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