import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getAllTasks, 
  getTask, 
  createTask, 
  updateTask, 
  removeTask, 
  initializeStorage 
} from './storage.js';
import { Task } from '../client/types/index.js';
import { 
  startWorker,
  toggleWorker,
  updateWorkerInterval,
  getWorkerStatus,
  getAllPersonas,
  initializePersonas
} from './worker.js';
import {
  getGitHubConfig,
  saveGitHubConfig,
  testGitHubAuth,
  createTaskPR,
  getPRStatus,
  getRepoPRs,
  getRepoIssues,
  syncTaskWithPR,
  getTaskGitHubData,
  GitHubConfig
} from './github.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Serve static files from the client build
const clientBuildPath = path.join(__dirname, '..', '..', 'dist', 'client');
app.use(express.static(clientBuildPath));

// API middleware
app.use('/api', express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Task API routes

// GET /api/tasks - Get all tasks
app.get('/api/tasks', async (_req, res) => {
  try {
    const tasks = await getAllTasks();
    res.json({ tasks });
  } catch (error) {
    console.error('GET /api/tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id - Get single task
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ task });
  } catch (error) {
    console.error(`GET /api/tasks/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks - Create new task
app.post('/api/tasks', async (req, res) => {
  try {
    const taskData = req.body as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
    
    // Validate required fields
    if (!taskData.title || !taskData.status) {
      return res.status(400).json({ error: 'Title and status are required' });
    }
    
    // Set defaults
    const newTaskData = {
      description: '',
      priority: 50,
      tags: [],
      ...taskData,
    };
    
    const task = await createTask(newTaskData);
    res.status(201).json({ task });
  } catch (error) {
    console.error('POST /api/tasks error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const updates = req.body as Partial<Task>;
    const task = await updateTask(req.params.id, updates);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ task });
  } catch (error) {
    console.error(`PUT /api/tasks/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id - Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const success = await removeTask(req.params.id);
    
    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/tasks/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Worker API routes

// GET /api/worker/status - Get worker status
app.get('/api/worker/status', (_req, res) => {
  try {
    const status = getWorkerStatus();
    res.json({ status });
  } catch (error) {
    console.error('GET /api/worker/status error:', error);
    res.status(500).json({ error: 'Failed to get worker status' });
  }
});

// POST /api/worker/toggle - Enable/disable worker
app.post('/api/worker/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    
    await toggleWorker(enabled);
    const status = getWorkerStatus();
    
    res.json({ status });
  } catch (error) {
    console.error('POST /api/worker/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle worker' });
  }
});

// PUT /api/worker/interval - Update worker interval
app.put('/api/worker/interval', async (req, res) => {
  try {
    const { interval } = req.body;
    
    if (typeof interval !== 'string') {
      return res.status(400).json({ error: 'interval must be a string' });
    }
    
    await updateWorkerInterval(interval);
    const status = getWorkerStatus();
    
    res.json({ status });
  } catch (error) {
    console.error('PUT /api/worker/interval error:', error);
    res.status(500).json({ error: 'Failed to update worker interval' });
  }
});

// GET /api/personas - Get all personas
app.get('/api/personas', async (_req, res) => {
  try {
    const personas = await getAllPersonas();
    res.json({ personas });
  } catch (error) {
    console.error('GET /api/personas error:', error);
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

// GitHub API routes

// GET /api/github/config - Get GitHub configuration
app.get('/api/github/config', async (_req, res) => {
  try {
    const config = await getGitHubConfig();
    res.json({ config });
  } catch (error) {
    console.error('GET /api/github/config error:', error);
    res.status(500).json({ error: 'Failed to get GitHub config' });
  }
});

// PUT /api/github/config - Update GitHub configuration
app.put('/api/github/config', async (req, res) => {
  try {
    const config = req.body as GitHubConfig;
    await saveGitHubConfig(config);
    res.json({ config });
  } catch (error) {
    console.error('PUT /api/github/config error:', error);
    res.status(500).json({ error: 'Failed to update GitHub config' });
  }
});

// GET /api/github/auth - Check GitHub authentication status
app.get('/api/github/auth', async (_req, res) => {
  try {
    const authStatus = await testGitHubAuth();
    res.json(authStatus);
  } catch (error) {
    console.error('GET /api/github/auth error:', error);
    res.status(500).json({ error: 'Failed to check GitHub auth' });
  }
});

// POST /api/github/pr - Create PR from task
app.post('/api/github/pr', async (req, res) => {
  try {
    const { repo, taskId, taskTitle, taskDescription, branchName } = req.body;
    
    if (!repo || !taskId || !taskTitle) {
      return res.status(400).json({ error: 'repo, taskId, and taskTitle are required' });
    }
    
    const prStatus = await createTaskPR(repo, taskId, taskTitle, taskDescription, branchName);
    res.json({ prStatus });
  } catch (error) {
    console.error('POST /api/github/pr error:', error);
    res.status(500).json({ error: 'Failed to create PR', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/github/pr/:repo/:number - Get PR status
app.get('/api/github/pr/:repo/:number', async (req, res) => {
  try {
    const repo = `${req.params.repo}`.replace('--', '/'); // Convert owner--repo back to owner/repo
    const prNumber = parseInt(req.params.number, 10);
    
    if (isNaN(prNumber)) {
      return res.status(400).json({ error: 'Invalid PR number' });
    }
    
    const prStatus = await getPRStatus(repo, prNumber);
    res.json({ prStatus });
  } catch (error) {
    console.error(`GET /api/github/pr/${req.params.repo}/${req.params.number} error:`, error);
    res.status(500).json({ error: 'Failed to get PR status', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/github/prs/:repo - Get all PRs for a repo
app.get('/api/github/prs/:repo', async (req, res) => {
  try {
    const repo = `${req.params.repo}`.replace('--', '/'); // Convert owner--repo back to owner/repo
    const state = req.query.state as 'open' | 'closed' | 'merged' | 'all' || 'open';
    
    const prs = await getRepoPRs(repo, state);
    res.json({ prs });
  } catch (error) {
    console.error(`GET /api/github/prs/${req.params.repo} error:`, error);
    res.status(500).json({ error: 'Failed to get PRs', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/github/issues/:repo - Get all issues for a repo
app.get('/api/github/issues/:repo', async (req, res) => {
  try {
    const repo = `${req.params.repo}`.replace('--', '/'); // Convert owner--repo back to owner/repo
    const state = req.query.state as 'open' | 'closed' | 'all' || 'open';
    
    const issues = await getRepoIssues(repo, state);
    res.json({ issues });
  } catch (error) {
    console.error(`GET /api/github/issues/${req.params.repo} error:`, error);
    res.status(500).json({ error: 'Failed to get issues', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/github/sync/:taskId - Sync task with its linked PRs
app.post('/api/github/sync/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { repo, prNumber } = req.body;
    
    if (!repo || !prNumber) {
      return res.status(400).json({ error: 'repo and prNumber are required' });
    }
    
    const syncResult = await syncTaskWithPR(taskId, repo, parseInt(prNumber, 10));
    res.json(syncResult);
  } catch (error) {
    console.error(`POST /api/github/sync/${req.params.taskId} error:`, error);
    res.status(500).json({ error: 'Failed to sync task with PR', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// GET /api/github/task/:taskId - Get GitHub data for a task
app.get('/api/github/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const githubData = await getTaskGitHubData(taskId);
    res.json(githubData);
  } catch (error) {
    console.error(`GET /api/github/task/${req.params.taskId} error:`, error);
    res.status(500).json({ error: 'Failed to get task GitHub data', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Initialize storage and start server
async function startServer() {
  try {
    await initializeStorage();
    await initializePersonas();
    await startWorker();
    
    app.listen(PORT, () => {
      console.log(`🚀 Tix Kanban server running on port ${PORT}`);
      console.log(`📁 Serving static files from: ${clientBuildPath}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();