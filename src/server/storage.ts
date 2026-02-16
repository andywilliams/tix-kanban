import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Task } from '../client/types/index.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const TASKS_DIR = path.join(STORAGE_DIR, 'tasks');
const SUMMARY_FILE = path.join(STORAGE_DIR, '_summary.json');

interface TaskSummary {
  id: string;
  title: string;
  status: Task['status'];
  priority: number;
  persona?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// Ensure storage directories exist
async function ensureStorageDirectories(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    await fs.mkdir(TASKS_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create storage directories:', error);
    throw error;
  }
}

// Read task from individual file
async function readTask(taskId: string): Promise<Task | null> {
  try {
    const taskPath = path.join(TASKS_DIR, `${taskId}.json`);
    const content = await fs.readFile(taskPath, 'utf8');
    const task = JSON.parse(content);
    
    // Convert date strings back to Date objects
    task.createdAt = new Date(task.createdAt);
    task.updatedAt = new Date(task.updatedAt);
    if (task.dueDate) {
      task.dueDate = new Date(task.dueDate);
    }
    
    return task;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File doesn't exist
    }
    // Log but don't throw on corrupt files — skip gracefully
    console.warn(`⚠️ Skipping corrupt task file ${taskId}:`, (error as Error).message);
    return null;
  }
}

// Write task to individual file
async function writeTask(task: Task): Promise<void> {
  try {
    await ensureStorageDirectories();
    const taskPath = path.join(TASKS_DIR, `${task.id}.json`);
    const content = JSON.stringify(task, null, 2);
    await fs.writeFile(taskPath, content, 'utf8');
  } catch (error) {
    console.error(`Failed to write task ${task.id}:`, error);
    throw error;
  }
}

// Delete task file
async function deleteTask(taskId: string): Promise<boolean> {
  try {
    const taskPath = path.join(TASKS_DIR, `${taskId}.json`);
    await fs.unlink(taskPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File doesn't exist
    }
    console.error(`Failed to delete task ${taskId}:`, error);
    throw error;
  }
}

// Read summary file for fast loading
async function readSummary(): Promise<TaskSummary[]> {
  try {
    const content = await fs.readFile(SUMMARY_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // File doesn't exist yet
    }
    console.error('Failed to read summary:', error);
    throw error;
  }
}

// Update summary file
async function updateSummary(tasks: Task[]): Promise<void> {
  try {
    await ensureStorageDirectories();
    const summary: TaskSummary[] = tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      persona: task.persona,
      tags: task.tags,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : String(task.createdAt),
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt),
    }));
    
    const content = JSON.stringify(summary, null, 2);
    await fs.writeFile(SUMMARY_FILE, content, 'utf8');
  } catch (error) {
    console.error('Failed to update summary:', error);
    // Non-fatal — tasks are stored individually, summary is just a cache
  }
}

// Get all tasks (uses summary for listing, loads full tasks as needed)
export async function getAllTasks(): Promise<Task[]> {
  try {
    // Try summary first for speed
    const summary = await readSummary();
    if (summary.length > 0) {
      const tasks: Task[] = [];
      for (const taskSummary of summary) {
        const task = await readTask(taskSummary.id);
        if (task) {
          tasks.push(task);
        }
      }
      return tasks;
    }
    
    // Fallback: scan tasks directory directly
    await ensureStorageDirectories();
    const files = await fs.readdir(TASKS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const tasks: Task[] = [];
    for (const file of jsonFiles) {
      const taskId = file.replace('.json', '');
      const task = await readTask(taskId);
      if (task) {
        tasks.push(task);
      }
    }
    
    // Rebuild summary if we found tasks
    if (tasks.length > 0) {
      console.log(`🔧 Rebuilt summary from ${tasks.length} task files`);
      await updateSummary(tasks);
    }
    
    return tasks;
  } catch (error) {
    console.error('Failed to get all tasks:', error);
    return [];
  }
}

// Get single task by ID
export async function getTask(taskId: string): Promise<Task | null> {
  return await readTask(taskId);
}

// Create new task
export async function createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
  const task: Task = {
    ...taskData,
    id: Math.random().toString(36).substr(2, 9),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await writeTask(task);
  
  // Append to summary directly (don't re-read via getAllTasks which has stale summary)
  const currentSummary = await readSummary();
  currentSummary.push({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    persona: task.persona,
    tags: task.tags,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : String(task.createdAt),
    updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt),
  });
  const content = JSON.stringify(currentSummary, null, 2);
  await fs.writeFile(SUMMARY_FILE, content, 'utf8');
  
  return task;
}

// Update existing task
export async function updateTask(taskId: string, updates: Partial<Task>): Promise<Task | null> {
  const existingTask = await readTask(taskId);
  if (!existingTask) {
    return null;
  }
  
  const updatedTask: Task = {
    ...existingTask,
    ...updates,
    id: taskId, // Ensure ID doesn't change
    updatedAt: new Date(),
  };
  
  await writeTask(updatedTask);
  
  // Update summary
  const allTasks = await getAllTasks();
  await updateSummary(allTasks);
  
  return updatedTask;
}

// Delete task
export async function removeTask(taskId: string): Promise<boolean> {
  const success = await deleteTask(taskId);
  
  if (success) {
    // Update summary
    const allTasks = await getAllTasks();
    await updateSummary(allTasks);
  }
  
  return success;
}

// Initialize storage with mock data if empty
export async function initializeStorage(): Promise<void> {
  try {
    const tasks = await getAllTasks();
    if (tasks.length === 0) {
      console.log('📁 No tasks found — board is empty');
    } else {
      console.log(`📁 Storage loaded with ${tasks.length} tasks`);
    }
  } catch (error) {
    console.error('Failed to initialize storage:', error);
    throw error;
  }
}