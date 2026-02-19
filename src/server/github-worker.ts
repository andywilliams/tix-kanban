/**
 * GitHub Background Worker
 * 
 * Runs GitHub API operations in a separate process to avoid blocking
 * the main Express server. Uses fork() for IPC communication.
 */

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let workerProcess: ChildProcess | null = null;
let pendingRequests = new Map<string, { resolve: Function, reject: Function }>();

interface WorkerMessage {
  id: string;
  type: 'result' | 'error';
  data?: any;
  error?: string;
}

interface WorkerRequest {
  id: string;
  action: string;
  params: any;
}

// Start the background worker process
export function startGitHubWorker(): void {
  if (workerProcess) {
    console.log('GitHub worker already running');
    return;
  }

  try {
    // Fork a child process running the worker script
    workerProcess = fork(path.join(__dirname, 'github-worker-process.js'), [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    workerProcess.on('message', (msg: WorkerMessage) => {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        if (msg.type === 'result') {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Unknown worker error'));
        }
        pendingRequests.delete(msg.id);
      }
    });

    workerProcess.on('error', (err) => {
      console.error('GitHub worker error:', err);
      workerProcess = null;
    });

    workerProcess.on('exit', (code) => {
      console.log(`GitHub worker exited with code ${code}`);
      workerProcess = null;
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Worker process exited'));
        pendingRequests.delete(id);
      }
    });

    console.log('GitHub background worker started');
  } catch (error) {
    console.error('Failed to start GitHub worker:', error);
  }
}

// Stop the worker process
export function stopGitHubWorker(): void {
  if (workerProcess) {
    workerProcess.kill();
    workerProcess = null;
    console.log('GitHub worker stopped');
  }
}

// Send a request to the worker and wait for response
function sendToWorker<T>(action: string, params: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!workerProcess) {
      // Fall back to direct execution if worker not running
      reject(new Error('Worker not running'));
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: WorkerRequest = { id, action, params };
    
    pendingRequests.set(id, { resolve, reject });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Worker request timeout'));
      }
    }, 60000);

    workerProcess.send(request);
  });
}

// Queue-based execution to prevent overwhelming GitHub API
const requestQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processQueue(): Promise<void> {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  while (requestQueue.length > 0) {
    const task = requestQueue.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        console.error('Queue task error:', error);
      }
      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  isProcessingQueue = false;
}

// Public API - these return immediately and process in background
export function queuePRStatusCheck(repo: string, prNumber: number): Promise<any> {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await sendToWorker('getPRStatus', { repo, prNumber });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    processQueue();
  });
}

export function queueAllPRStatusCheck(repos: string[]): Promise<Map<string, any[]>> {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await sendToWorker('getAllPRStatus', { repos });
        resolve(new Map(Object.entries(result)));
      } catch (error) {
        reject(error);
      }
    });
    processQueue();
  });
}

// Simpler approach: just use setImmediate to yield to event loop
export async function yieldingPRCheck<T>(fn: () => Promise<T>): Promise<T> {
  // Yield to event loop before heavy operation
  await new Promise(resolve => setImmediate(resolve));
  
  const result = await fn();
  
  // Yield after as well
  await new Promise(resolve => setImmediate(resolve));
  
  return result;
}

// Batch operations with yielding between each
export async function batchWithYield<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number = 3
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    
    // Yield to event loop between batches
    if (i + batchSize < items.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  return results;
}
