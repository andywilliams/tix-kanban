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
import { Task, Comment, Link, Persona } from '../client/types/index.js';
import { 
  startWorker,
  toggleWorker,
  updateWorkerInterval,
  getWorkerStatus
} from './worker.js';
import {
  getAllPersonas,
  getPersona,
  createPersona,
  updatePersona,
  deletePersona,
  initializePersonas,
  getPersonaMemoryWithTokens,
  setPersonaMemory,
  updatePersonaRating
} from './persona-storage.js';
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
import {
  initializeChatStorage,
  getChannel,
  createOrGetChannel,
  addMessage,
  getMessages,
  getAllChannels
} from './chat-storage.js';
import { processMentions } from './mention-handler.js';
import {
  getAllPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  removePipeline,
  initializePipelines,
  getTaskPipelineState,
  updateTaskPipelineState
} from './pipeline-storage.js';
import {
  getAutoReviewConfig,
  updateAutoReviewConfig,
  getTaskReviewState,
  executeReviewCycle
} from './auto-review.js';

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

// Comments API routes

// POST /api/tasks/:id/comments - Add comment to task
app.post('/api/tasks/:id/comments', async (req, res) => {
  try {
    const { body, author } = req.body as { body: string; author: string };
    
    if (!body || !author) {
      return res.status(400).json({ error: 'body and author are required' });
    }
    
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const newComment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      taskId: req.params.id,
      body,
      author,
      createdAt: new Date(),
    };
    
    const updatedComments = [...(task.comments || []), newComment];
    const updatedTask = await updateTask(req.params.id, { comments: updatedComments });
    
    res.status(201).json({ comment: newComment, task: updatedTask });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/comments error:`, error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Links API routes

// POST /api/tasks/:id/links - Add link to task
app.post('/api/tasks/:id/links', async (req, res) => {
  try {
    const { url, title, type } = req.body as { url: string; title: string; type: 'pr' | 'attachment' | 'reference' };
    
    if (!url || !title || !type) {
      return res.status(400).json({ error: 'url, title, and type are required' });
    }
    
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const newLink: Link = {
      id: Math.random().toString(36).substr(2, 9),
      taskId: req.params.id,
      url,
      title,
      type,
    };
    
    const updatedLinks = [...(task.links || []), newLink];
    const updatedTask = await updateTask(req.params.id, { links: updatedLinks });
    
    res.status(201).json({ link: newLink, task: updatedTask });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/links error:`, error);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

// DELETE /api/tasks/:id/links/:linkId - Delete link from task
app.delete('/api/tasks/:id/links/:linkId', async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const links = task.links || [];
    const linkIndex = links.findIndex(link => link.id === req.params.linkId);
    
    if (linkIndex === -1) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    const updatedLinks = links.filter(link => link.id !== req.params.linkId);
    const updatedTask = await updateTask(req.params.id, { links: updatedLinks });
    
    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error(`DELETE /api/tasks/${req.params.id}/links/${req.params.linkId} error:`, error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// POST /api/tasks/:id/rating - Add rating to task
app.post('/api/tasks/:id/rating', async (req, res) => {
  try {
    const { rating, comment, ratedBy } = req.body;
    
    if (!rating || !['good', 'needs-improvement', 'redo'].includes(rating)) {
      return res.status(400).json({ error: 'Invalid rating. Must be good, needs-improvement, or redo' });
    }
    
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Create rating object
    const taskRating = {
      id: Date.now().toString(), // Simple ID generation
      taskId: req.params.id,
      rating,
      comment: comment || undefined,
      ratedBy: ratedBy || 'User',
      ratedAt: new Date()
    };
    
    // Update task with rating
    const updatedTask = await updateTask(req.params.id, { 
      rating: taskRating,
      // If rating is redo or needs-improvement, task stays in review
      // If rating is good, we'll let the frontend handle status change
    });
    
    // Update persona rating stats and trigger reflection if needed
    if (task.persona) {
      await updatePersonaRating(
        task.persona,
        rating,
        task.title,
        task.description,
        comment
      );
      console.log(`Updated persona ${task.persona} rating stats and ${rating !== 'good' ? 'triggered reflection' : 'logged positive feedback'}`);
    }
    
    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/rating error:`, error);
    res.status(500).json({ error: 'Failed to add rating' });
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

// Personas API routes

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

// GET /api/personas/:id - Get single persona
app.get('/api/personas/:id', async (req, res) => {
  try {
    const persona = await getPersona(req.params.id);
    if (!persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    res.json({ persona });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona' });
  }
});

// POST /api/personas - Create new persona
app.post('/api/personas', async (req, res) => {
  try {
    const personaData = req.body as Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>;
    
    // Validate required fields
    if (!personaData.name || !personaData.prompt) {
      return res.status(400).json({ error: 'name and prompt are required' });
    }
    
    // Set defaults
    const newPersonaData = {
      emoji: '🤖',
      description: '',
      specialties: [],
      stats: { tasksCompleted: 0, averageCompletionTime: 0, successRate: 0 },
      ...personaData,
    };
    
    const persona = await createPersona(newPersonaData);
    res.status(201).json({ persona });
  } catch (error) {
    console.error('POST /api/personas error:', error);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

// PUT /api/personas/:id - Update persona
app.put('/api/personas/:id', async (req, res) => {
  try {
    const updates = req.body as Partial<Persona>;
    const persona = await updatePersona(req.params.id, updates);
    
    if (!persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    
    res.json({ persona });
  } catch (error) {
    console.error(`PUT /api/personas/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

// DELETE /api/personas/:id - Delete persona
app.delete('/api/personas/:id', async (req, res) => {
  try {
    const success = await deletePersona(req.params.id);
    
    if (!success) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/personas/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

// Persona Memory API routes

// GET /api/personas/:id/memory - Get persona memory with token info
app.get('/api/personas/:id/memory', async (req, res) => {
  try {
    const memoryData = await getPersonaMemoryWithTokens(req.params.id);
    res.json(memoryData);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memory error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona memory' });
  }
});

// PUT /api/personas/:id/memory - Update persona memory
app.put('/api/personas/:id/memory', async (req, res) => {
  try {
    const { memory } = req.body as { memory: string };
    
    if (typeof memory !== 'string') {
      return res.status(400).json({ error: 'memory must be a string' });
    }
    
    await setPersonaMemory(req.params.id, memory);
    const memoryData = await getPersonaMemoryWithTokens(req.params.id);
    
    res.json(memoryData);
  } catch (error) {
    console.error(`PUT /api/personas/${req.params.id}/memory error:`, error);
    res.status(500).json({ error: 'Failed to update persona memory' });
  }
});

// Chat API routes

// GET /api/chat/channels - Get all channels
app.get('/api/chat/channels', async (_req, res) => {
  try {
    const channels = await getAllChannels();
    res.json({ channels });
  } catch (error) {
    console.error('GET /api/chat/channels error:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// GET /api/chat/:channelId - Get or create a channel
app.get('/api/chat/:channelId', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { type = 'general', taskId, name } = req.query;
    
    if (!['task', 'general'].includes(type as string)) {
      return res.status(400).json({ error: 'type must be "task" or "general"' });
    }
    
    const channel = await createOrGetChannel(
      channelId, 
      type as 'task' | 'general', 
      taskId as string, 
      name as string
    );
    
    res.json({ channel });
  } catch (error) {
    console.error(`GET /api/chat/${req.params.channelId} error:`, error);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// GET /api/chat/:channelId/messages - Get messages for a channel
app.get('/api/chat/:channelId/messages', async (req, res) => {
  try {
    const { channelId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before as string;
    
    const messages = await getMessages(channelId, limit, before);
    res.json({ messages });
  } catch (error) {
    console.error(`GET /api/chat/${req.params.channelId}/messages error:`, error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/chat/:channelId/messages - Send a message to a channel
app.post('/api/chat/:channelId/messages', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { author, authorType = 'human', content, replyTo } = req.body;
    
    if (!author || !content) {
      return res.status(400).json({ error: 'author and content are required' });
    }
    
    if (!['human', 'persona'].includes(authorType)) {
      return res.status(400).json({ error: 'authorType must be "human" or "persona"' });
    }
    
    // Ensure channel exists
    const channel = await getChannel(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    const message = await addMessage(channelId, author, authorType, content, replyTo);
    
    // Process @mentions - trigger persona responses asynchronously
    if (message.mentions.length > 0) {
      console.log(`Message mentions personas: ${message.mentions.join(', ')}`);
      // Don't await - let persona responses happen in background
      processMentions(message).catch(error => {
        console.error('Error processing mentions:', error);
      });
    }
    
    res.status(201).json({ message });
  } catch (error) {
    console.error(`POST /api/chat/${req.params.channelId}/messages error:`, error);
    res.status(500).json({ error: 'Failed to send message' });
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

// Pipeline API routes

// GET /api/pipelines - Get all pipelines
app.get('/api/pipelines', async (_req, res) => {
  try {
    const pipelines = await getAllPipelines();
    res.json({ pipelines });
  } catch (error) {
    console.error('GET /api/pipelines error:', error);
    res.status(500).json({ error: 'Failed to fetch pipelines' });
  }
});

// GET /api/pipelines/:id - Get single pipeline
app.get('/api/pipelines/:id', async (req, res) => {
  try {
    const pipeline = await getPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    res.json({ pipeline });
  } catch (error) {
    console.error(`GET /api/pipelines/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
});

// POST /api/pipelines - Create new pipeline
app.post('/api/pipelines', async (req, res) => {
  try {
    const pipelineData = req.body;
    
    // Validate required fields
    if (!pipelineData.name || !pipelineData.stages || !Array.isArray(pipelineData.stages)) {
      return res.status(400).json({ error: 'Name and stages array are required' });
    }
    
    const pipeline = await createPipeline(pipelineData);
    res.status(201).json({ pipeline });
  } catch (error) {
    console.error('POST /api/pipelines error:', error);
    res.status(500).json({ error: 'Failed to create pipeline' });
  }
});

// PUT /api/pipelines/:id - Update pipeline
app.put('/api/pipelines/:id', async (req, res) => {
  try {
    const updates = req.body;
    const pipeline = await updatePipeline(req.params.id, updates);
    
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    res.json({ pipeline });
  } catch (error) {
    console.error(`PUT /api/pipelines/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to update pipeline' });
  }
});

// DELETE /api/pipelines/:id - Delete pipeline
app.delete('/api/pipelines/:id', async (req, res) => {
  try {
    const success = await removePipeline(req.params.id);
    
    if (!success) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/pipelines/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete pipeline' });
  }
});

// GET /api/tasks/:taskId/pipeline-state - Get pipeline state for a task
app.get('/api/tasks/:taskId/pipeline-state', async (req, res) => {
  try {
    const state = await getTaskPipelineState(req.params.taskId);
    res.json({ state });
  } catch (error) {
    console.error(`GET /api/tasks/${req.params.taskId}/pipeline-state error:`, error);
    res.status(500).json({ error: 'Failed to fetch pipeline state' });
  }
});

// PUT /api/tasks/:taskId/pipeline-state - Update pipeline state for a task
app.put('/api/tasks/:taskId/pipeline-state', async (req, res) => {
  try {
    const stateData = req.body;
    stateData.taskId = req.params.taskId; // Ensure taskId matches
    await updateTaskPipelineState(stateData);
    res.json({ success: true });
  } catch (error) {
    console.error(`PUT /api/tasks/${req.params.taskId}/pipeline-state error:`, error);
    res.status(500).json({ error: 'Failed to update pipeline state' });
  }
});

// POST /api/tasks/:taskId/pipeline/:pipelineId/start - Start a task in a pipeline
app.post('/api/tasks/:taskId/pipeline/:pipelineId/start', async (req, res) => {
  try {
    const { taskId, pipelineId } = req.params;
    
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    if (pipeline.stages.length === 0) {
      return res.status(400).json({ error: 'Pipeline has no stages' });
    }
    
    const firstStage = pipeline.stages[0];
    const pipelineState = {
      taskId,
      pipelineId,
      currentStageId: firstStage.id,
      stageAttempts: { [firstStage.id]: 0 },
      stageHistory: [],
      isStuck: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await updateTaskPipelineState(pipelineState);
    
    // Update task to assign to first stage persona
    await updateTask(taskId, { 
      persona: firstStage.persona,
      assignee: firstStage.persona 
    });
    
    res.json({ pipelineState });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.taskId}/pipeline/${req.params.pipelineId}/start error:`, error);
    res.status(500).json({ error: 'Failed to start task in pipeline' });
  }
});

// Auto-Review API endpoints

// GET /api/auto-review/config - Get auto-review configuration
app.get('/api/auto-review/config', async (_req, res) => {
  try {
    const config = await getAutoReviewConfig();
    res.json(config);
  } catch (error) {
    console.error('GET /api/auto-review/config error:', error);
    res.status(500).json({ error: 'Failed to fetch auto-review config' });
  }
});

// PUT /api/auto-review/config - Update auto-review configuration
app.put('/api/auto-review/config', async (req, res) => {
  try {
    const updates = req.body;
    const config = await updateAutoReviewConfig(updates);
    res.json(config);
  } catch (error) {
    console.error('PUT /api/auto-review/config error:', error);
    res.status(500).json({ error: 'Failed to update auto-review config' });
  }
});

// GET /api/tasks/:taskId/review-state - Get auto-review state for a task
app.get('/api/tasks/:taskId/review-state', async (req, res) => {
  try {
    const state = await getTaskReviewState(req.params.taskId);
    res.json({ state });
  } catch (error) {
    console.error(`GET /api/tasks/${req.params.taskId}/review-state error:`, error);
    res.status(500).json({ error: 'Failed to fetch review state' });
  }
});

// POST /api/tasks/:taskId/review-cycle - Manually trigger a review cycle
app.post('/api/tasks/:taskId/review-cycle', async (req, res) => {
  try {
    const result = await executeReviewCycle(req.params.taskId);
    res.json({ result });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.taskId}/review-cycle error:`, error);
    res.status(500).json({ error: 'Failed to execute review cycle' });
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
    await initializePipelines();
    initializeChatStorage();
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