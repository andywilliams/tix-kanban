import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllTasks,
  getTask,
  createTask,
  updateTask,
  removeTask,
  initializeStorage,
  getTaskActivity,
  getAllActivity
} from './storage.js';
import { Task, Comment, Link, Persona } from '../client/types/index.js';
import { 
  startWorker,
  toggleWorker,
  updateWorkerInterval,
  getWorkerStatus,
  toggleStandupScheduler,
  updateStandupTime,
  triggerStandupGeneration
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
  updatePersonaRating,
  updatePersonaStats
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
import { processChatMention, startDirectConversation, getTeamOverview } from './agent-chat.js';
import {
  getAgentMemory,
  addMemoryEntry,
  updateMemoryEntry,
  deleteMemoryEntry,
  searchMemories,
  getMemoriesByCategory,
  clearMemories
} from './agent-memory.js';
import {
  getAgentSoul,
  updateAgentSoul,
  initializeSoulForPersona,
  getAllSouls
} from './agent-soul.js';
import {
  getAllReports,
  getReport,
  saveReport,
  deleteReport,
  initializeReportsStorage
} from './reports-storage.js';
import {
  getAllKnowledgeDocs,
  getKnowledgeDoc,
  saveKnowledgeDoc,
  deleteKnowledgeDoc,
  searchKnowledgeDocs,
  initializeKnowledgeStorage
} from './knowledge-storage.js';
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
import {
  getUserSettings,
  saveUserSettings,
  UserSettings
} from './user-settings.js';
import {
  initializeStandupStorage,
  generateStandupEntry,
  saveStandupEntry,
  getAllStandupEntries,
  getRecentStandupEntries,
  deleteStandupEntry,
  updateStandupEntry,
  StandupEntry
} from './standup-storage.js';
import {
  loadNotionConfig,
  saveNotionConfig,
  syncTasksFromNotion,
  mapNotionStatusToKanban,
  getDefaultStatusMappings,
  NotionConfig
} from './notion-sync.js';
import {
  runPRCommentResolver,
  startPRResolver,
  togglePRResolver,
  updatePRResolverFrequency,
  getPRResolverStatus
} from './pr-comment-resolver.js';

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
    const { actor, ...taskData } = req.body as Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { actor?: string };
    
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
    
    const task = await createTask(newTaskData, actor || 'api');
    res.status(201).json({ task });
  } catch (error) {
    console.error('POST /api/tasks error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { actor, ...updates } = req.body as Partial<Task> & { actor?: string };

    // Get the current task state before updating
    const previousTask = await getTask(req.params.id);
    if (!previousTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update the task
    const task = await updateTask(req.params.id, updates, actor || 'api');

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // If task is being marked as done and has a persona, update persona stats
    if (updates.status === 'done' && previousTask.status !== 'done' && task.persona) {
      // Find the persona by name to get its ID
      const personas = await getAllPersonas();
      const persona = personas.find(p => p.name === task.persona);

      if (persona) {
        // Calculate completion time (difference between creation and completion)
        const completionTimeMs = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
        const completionTimeMinutes = completionTimeMs / (1000 * 60); // Convert to minutes

        // Determine if task was successful (no redo rating)
        const wasSuccessful = !task.rating || task.rating.rating !== 'redo';

        try {
          await updatePersonaStats(persona.id, completionTimeMinutes, wasSuccessful);
          console.log(`Updated persona stats for ${task.persona} after task completion`);
        } catch (error) {
          console.error(`Failed to update persona stats:`, error);
          // Don't fail the request if stats update fails
        }
      } else {
        console.error(`Persona not found for name: ${task.persona}`);
      }
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

// Activity API routes

// GET /api/tasks/:id/activity - Get activity for a specific task
app.get('/api/tasks/:id/activity', async (req, res) => {
  try {
    const activity = await getTaskActivity(req.params.id);
    res.json({ activity });
  } catch (error) {
    console.error(`GET /api/tasks/${req.params.id}/activity error:`, error);
    res.status(500).json({ error: 'Failed to fetch task activity' });
  }
});

// GET /api/activity - Get activity across all tasks with optional filters
app.get('/api/activity', async (req, res) => {
  try {
    const { start, end, tasks, hours } = req.query;
    
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    let taskIds: string[] | undefined;
    
    // Parse date filters
    if (start) {
      startDate = new Date(start as string);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({ error: 'Invalid start date format' });
      }
    }
    
    if (end) {
      endDate = new Date(end as string);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'Invalid end date format' });
      }
    }
    
    // Support for "last X hours" query
    if (hours && !start && !end) {
      const hoursNum = parseInt(hours as string);
      if (!isNaN(hoursNum)) {
        startDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
        endDate = new Date();
      }
    }
    
    // Parse task ID filter
    if (tasks) {
      taskIds = (tasks as string).split(',');
    }
    
    const activity = await getAllActivity(startDate, endDate, taskIds);
    res.json({ 
      activity,
      filters: {
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        taskIds
      }
    });
  } catch (error) {
    console.error('GET /api/activity error:', error);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// Auto-tagging API routes

// GET /api/tasks/:id/tags/suggest - Get tag suggestions for a task
app.get('/api/tasks/:id/tags/suggest', async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const analysis = analyzeTaskTags(task);
    res.json(analysis);
  } catch (error) {
    console.error(`GET /api/tasks/${req.params.id}/tags/suggest error:`, error);
    res.status(500).json({ error: 'Failed to suggest tags' });
  }
});

// POST /api/tasks/:id/tags/auto-apply - Auto-apply high-confidence tags
app.post('/api/tasks/:id/tags/auto-apply', async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const { threshold = 0.7 } = req.body;
    const newTags = autoApplyTags(task, threshold);
    
    if (newTags.length > 0) {
      const updatedTags = [...new Set([...task.tags, ...newTags])];
      await updateTask(req.params.id, { tags: updatedTags });
      res.json({ applied: newTags, allTags: updatedTags });
    } else {
      res.json({ applied: [], allTags: task.tags, message: 'No high-confidence tags to apply' });
    }
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/tags/auto-apply error:`, error);
    res.status(500).json({ error: 'Failed to auto-apply tags' });
  }
});

// GET /api/tags/available - Get all available auto-tags
app.get('/api/tags/available', (_req, res) => {
  res.json({ tags: getAllAutoTags() });
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

// Reports API routes

// GET /api/reports - Get all reports (metadata only)
app.get('/api/reports', async (_req, res) => {
  try {
    const reports = await getAllReports();
    res.json({ reports });
  } catch (error) {
    console.error('GET /api/reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// GET /api/reports/:id - Get single report with full content
app.get('/api/reports/:id', async (req, res) => {
  try {
    const report = await getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ report });
  } catch (error) {
    console.error(`GET /api/reports/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// POST /api/reports - Create new report
app.post('/api/reports', async (req, res) => {
  try {
    const { title, content, summary, tags, taskId, slug } = req.body;
    
    // Validate required fields
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    const report = await saveReport(title, content, {
      summary,
      tags: tags || [],
      taskId,
      slug
    });
    
    res.status(201).json({ report });
  } catch (error) {
    console.error('POST /api/reports error:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// DELETE /api/reports/:id - Delete a report
app.delete('/api/reports/:id', async (req, res) => {
  try {
    const success = await deleteReport(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/reports/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete report' });
  }
});

// Knowledge API routes

// GET /api/knowledge - Get all knowledge docs (metadata only)
app.get('/api/knowledge', async (_req, res) => {
  try {
    const docs = await getAllKnowledgeDocs();
    res.json({ docs });
  } catch (error) {
    console.error('GET /api/knowledge error:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge docs' });
  }
});

// GET /api/knowledge/search - Search knowledge docs
app.get('/api/knowledge/search', async (req, res) => {
  try {
    const { q, repo, area, tags, limit } = req.query;
    
    const query: any = {};
    if (q) query.keywords = q as string;
    if (repo) query.repo = repo as string;
    if (area) query.area = area as string;
    if (tags) query.tags = (tags as string).split(',');
    if (limit) query.limit = parseInt(limit as string);
    
    const results = await searchKnowledgeDocs(query);
    res.json({ results });
  } catch (error) {
    console.error('GET /api/knowledge/search error:', error);
    res.status(500).json({ error: 'Failed to search knowledge docs' });
  }
});

// GET /api/knowledge/:id - Get single knowledge doc with full content
app.get('/api/knowledge/:id', async (req, res) => {
  try {
    const doc = await getKnowledgeDoc(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Knowledge doc not found' });
    }
    res.json({ doc });
  } catch (error) {
    console.error(`GET /api/knowledge/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch knowledge doc' });
  }
});

// POST /api/knowledge - Create new knowledge doc
app.post('/api/knowledge', async (req, res) => {
  try {
    const { title, content, description, repo, area, topic, tags, slug } = req.body;
    
    // Validate required fields
    if (!title || !content || !area || !topic) {
      return res.status(400).json({ error: 'Title, content, area, and topic are required' });
    }
    
    const doc = await saveKnowledgeDoc(title, content, {
      description,
      repo,
      area,
      topic,
      tags,
      slug
    });
    
    res.status(201).json({ doc });
  } catch (error) {
    console.error('POST /api/knowledge error:', error);
    res.status(500).json({ error: 'Failed to create knowledge doc' });
  }
});

// PUT /api/knowledge/:id - Update existing knowledge doc
app.put('/api/knowledge/:id', async (req, res) => {
  try {
    const { title, content, description, repo, area, topic, tags } = req.body;
    
    // Validate required fields
    if (!title || !content || !area || !topic) {
      return res.status(400).json({ error: 'Title, content, area, and topic are required' });
    }
    
    const doc = await saveKnowledgeDoc(title, content, {
      description,
      repo,
      area,
      topic,
      tags,
      id: req.params.id
    });
    
    res.json({ doc });
  } catch (error) {
    console.error(`PUT /api/knowledge/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to update knowledge doc' });
  }
});

// DELETE /api/knowledge/:id - Delete a knowledge doc
app.delete('/api/knowledge/:id', async (req, res) => {
  try {
    const success = await deleteKnowledgeDoc(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Knowledge doc not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/knowledge/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete knowledge doc' });
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

// POST /api/worker/standup/toggle - Enable/disable standup scheduler
app.post('/api/worker/standup/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    
    await toggleStandupScheduler(enabled);
    const status = getWorkerStatus();
    
    res.json({ status });
  } catch (error) {
    console.error('POST /api/worker/standup/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle standup scheduler' });
  }
});

// PUT /api/worker/standup/time - Update standup generation time
app.put('/api/worker/standup/time', async (req, res) => {
  try {
    const { cronExpression } = req.body;
    
    if (typeof cronExpression !== 'string') {
      return res.status(400).json({ error: 'cronExpression must be a string' });
    }
    
    await updateStandupTime(cronExpression);
    const status = getWorkerStatus();
    
    res.json({ status });
  } catch (error) {
    console.error('PUT /api/worker/standup/time error:', error);
    res.status(500).json({ error: 'Failed to update standup time' });
  }
});

// POST /api/worker/standup/trigger - Manually trigger standup generation
app.post('/api/worker/standup/trigger', async (_req, res) => {
  try {
    await triggerStandupGeneration();
    res.json({ success: true, message: 'Standup generation triggered' });
  } catch (error) {
    console.error('POST /api/worker/standup/trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger standup generation' });
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

// Structured Memory API routes (enhanced memory system)
import {
  getStructuredMemory,
  saveStructuredMemory,
  addMemoryEntry as addStructuredMemoryEntry,
  searchMemories as searchStructuredMemories,
  getPersonaSoul,
  savePersonaSoul,
  generateDefaultSoul,
  MemoryEntry,
  PersonaSoul
} from './persona-memory.js';

// GET /api/personas/:id/memories - Get structured memories
app.get('/api/personas/:id/memories', async (req, res) => {
  try {
    const memory = await getStructuredMemory(req.params.id);
    res.json(memory);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memories error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona memories' });
  }
});

// POST /api/personas/:id/memories - Add a memory entry
app.post('/api/personas/:id/memories', async (req, res) => {
  try {
    const { category, content, source, tags, importance } = req.body as {
      category: MemoryEntry['category'];
      content: string;
      source: string;
      tags?: string[];
      importance?: MemoryEntry['importance'];
    };

    if (!category || !content || !source) {
      return res.status(400).json({ error: 'category, content, and source are required' });
    }

    const entry = await addStructuredMemoryEntry(req.params.id, category, content, source, { tags, importance });
    res.json(entry);
  } catch (error) {
    console.error(`POST /api/personas/${req.params.id}/memories error:`, error);
    res.status(500).json({ error: 'Failed to add memory entry' });
  }
});

// Agent Memory API routes

// GET /api/personas/:id/agent-memory - Get agent memory for a user
app.get('/api/personas/:id/agent-memory', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const memory = await getAgentMemory(req.params.id, userId);
    res.json({ memory });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/agent-memory error:`, error);
    res.status(500).json({ error: 'Failed to fetch agent memory' });
  }
});

// POST /api/personas/:id/agent-memory - Add a memory entry
app.post('/api/personas/:id/agent-memory', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const { category, content, keywords, importance } = req.body;

    if (!category || !content) {
      return res.status(400).json({ error: 'category and content are required' });
    }

    const entry = await addMemoryEntry(req.params.id, userId, {
      category,
      content,
      keywords: keywords || [],
      source: 'explicit',
      importance: importance || 5
    });

    res.status(201).json({ entry });
  } catch (error) {
    console.error(`POST /api/personas/${req.params.id}/agent-memory error:`, error);
    res.status(500).json({ error: 'Failed to add memory entry' });
  }
});

// GET /api/personas/:id/memories/search - Search memories
app.get('/api/personas/:id/memories/search', async (req, res) => {
  try {
    const { q, category, limit } = req.query;
    const results = await searchStructuredMemories(req.params.id, q as string || '', {
      category: category as MemoryEntry['category'],
      limit: limit ? parseInt(limit as string) : undefined
    });
    res.json({ results });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memories/search error:`, error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

// DELETE /api/personas/:id/memories/:entryId - Delete a memory entry
app.delete('/api/personas/:id/memories/:entryId', async (req, res) => {
  try {
    const memory = await getStructuredMemory(req.params.id);
    const initialLength = memory.entries.length;
    memory.entries = memory.entries.filter(e => e.id !== req.params.entryId);

    if (memory.entries.length === initialLength) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }

    await saveStructuredMemory(memory);
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/personas/${req.params.id}/memories/${req.params.entryId} error:`, error);
    res.status(500).json({ error: 'Failed to delete memory entry' });
  }
});

// PUT /api/personas/:id/agent-memory/:entryId - Update a memory entry
app.put('/api/personas/:id/agent-memory/:entryId', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const updates = req.body;
    delete updates.userId;

    const entry = await updateMemoryEntry(req.params.id, userId, req.params.entryId, updates);

    if (!entry) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }

    res.json({ entry });
  } catch (error) {
    console.error(`PUT /api/personas/${req.params.id}/agent-memory/${req.params.entryId} error:`, error);
    res.status(500).json({ error: 'Failed to update memory entry' });
  }
});

// DELETE /api/personas/:id/agent-memory/:entryId - Delete a memory entry
app.delete('/api/personas/:id/agent-memory/:entryId', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const success = await deleteMemoryEntry(req.params.id, userId, req.params.entryId);

    if (!success) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/personas/${req.params.id}/agent-memory/${req.params.entryId} error:`, error);
    res.status(500).json({ error: 'Failed to delete memory entry' });
  }
});

// Soul API routes

// GET /api/personas/:id/soul - Get persona soul/personality
app.get('/api/personas/:id/soul', async (req, res) => {
  try {
    let soul = await getPersonaSoul(req.params.id);
    
    // Generate default soul if none exists
    if (!soul) {
      const persona = await getPersona(req.params.id);
      if (!persona) {
        return res.status(404).json({ error: 'Persona not found' });
      }
      soul = await generateDefaultSoul(persona);
      await savePersonaSoul(soul);
    }
    
    res.json(soul);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/soul error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona soul' });
  }
});

// PUT /api/personas/:id/soul - Update persona soul
app.put('/api/personas/:id/soul', async (req, res) => {
  try {
    const soul = req.body as PersonaSoul;
    
    if (!soul.personaId || soul.personaId !== req.params.id) {
      soul.personaId = req.params.id;
    }
    
    await savePersonaSoul(soul);
    res.json(soul);
  } catch (error) {
    console.error(`PUT /api/personas/${req.params.id}/soul error:`, error);
    res.status(500).json({ error: 'Failed to update persona soul' });
  }
});

// Mood API routes
import { calculatePersonaMood, getAllMoodTypes } from './persona-mood.js';

// Auto-tagging
import { suggestTags, autoApplyTags, analyzeTaskTags, getAllAutoTags } from './auto-tagger.js';

// Achievements
import { calculateAchievements, getAllAchievements, getRarityColor } from './persona-achievements.js';

// GET /api/personas/:id/mood - Get persona's current mood
app.get('/api/personas/:id/mood', async (req, res) => {
  try {
    const persona = await getPersona(req.params.id);
    if (!persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    
    const mood = await calculatePersonaMood(persona);
    res.json(mood);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/mood error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona mood' });
  }
});

// GET /api/moods - Get all mood types (for UI)
app.get('/api/moods', (_req, res) => {
  res.json({ moods: getAllMoodTypes() });
});

// Achievement API routes

// GET /api/personas/:id/achievements - Get persona achievements
app.get('/api/personas/:id/achievements', async (req, res) => {
  try {
    const persona = await getPersona(req.params.id);
    if (!persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    
    const achievements = await calculateAchievements(persona);
    res.json(achievements);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/achievements error:`, error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// GET /api/achievements - Get all available achievements
app.get('/api/achievements', (_req, res) => {
  const achievements = getAllAchievements();
  res.json({ 
    achievements,
    rarityColors: {
      common: getRarityColor('common'),
      uncommon: getRarityColor('uncommon'),
      rare: getRarityColor('rare'),
      epic: getRarityColor('epic'),
      legendary: getRarityColor('legendary'),
    }
  });
});

// GET /api/personas/:id/agent-memory/search - Search memories
app.get('/api/personas/:id/agent-memory/search', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const query = req.query.q as string;
    const category = req.query.category as string;
    const limit = parseInt(req.query.limit as string) || 10;
    
    if (!query) {
      return res.status(400).json({ error: 'query (q) is required' });
    }
    
    const entries = await searchMemories(req.params.id, userId, query, {
      category: category as any,
      limit
    });
    
    res.json({ entries });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/agent-memory/search error:`, error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

// DELETE /api/personas/:id/agent-memory - Clear all memories for a user
app.delete('/api/personas/:id/agent-memory', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    await clearMemories(req.params.id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/personas/${req.params.id}/agent-memory error:`, error);
    res.status(500).json({ error: 'Failed to clear memories' });
  }
});

// Agent Soul API routes

// GET /api/personas/:id/soul - Get agent soul/personality
app.get('/api/personas/:id/soul', async (req, res) => {
  try {
    let soul = await getAgentSoul(req.params.id);
    
    if (!soul) {
      // Initialize a default soul for this persona
      soul = await initializeSoulForPersona(req.params.id);
    }
    
    res.json({ soul });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/soul error:`, error);
    res.status(500).json({ error: 'Failed to fetch agent soul' });
  }
});

// PUT /api/personas/:id/soul - Update agent soul/personality
app.put('/api/personas/:id/soul', async (req, res) => {
  try {
    const updates = req.body;
    let soul = await updateAgentSoul(req.params.id, updates);
    
    if (!soul) {
      // Create new soul with provided data
      soul = await initializeSoulForPersona(req.params.id);
      soul = await updateAgentSoul(req.params.id, updates);
    }
    
    res.json({ soul });
  } catch (error) {
    console.error(`PUT /api/personas/${req.params.id}/soul error:`, error);
    res.status(500).json({ error: 'Failed to update agent soul' });
  }
});

// GET /api/souls - Get all agent souls
app.get('/api/souls', async (_req, res) => {
  try {
    const souls = await getAllSouls();
    res.json({ souls });
  } catch (error) {
    console.error('GET /api/souls error:', error);
    res.status(500).json({ error: 'Failed to fetch souls' });
  }
});

// Direct chat API routes

// POST /api/personas/:id/chat/start - Start a direct conversation
app.post('/api/personas/:id/chat/start', async (req, res) => {
  try {
    const userId = req.body.userId || 'default';
    const result = await startDirectConversation(req.params.id, userId);
    
    // Create/get the direct chat channel
    const channel = await createOrGetChannel(
      result.channelId,
      'direct',
      undefined,
      `Chat with ${req.params.id}`,
      req.params.id  // personaId
    );
    
    res.json({ 
      channelId: result.channelId,
      greeting: result.greeting,
      channel
    });
  } catch (error) {
    console.error(`POST /api/personas/${req.params.id}/chat/start error:`, error);
    res.status(500).json({ error: 'Failed to start direct conversation' });
  }
});

// GET /api/team/overview - Get team overview
app.get('/api/team/overview', async (_req, res) => {
  try {
    const overview = await getTeamOverview();
    res.json({ overview });
  } catch (error) {
    console.error('GET /api/team/overview error:', error);
    res.status(500).json({ error: 'Failed to get team overview' });
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
    const { type = 'general', taskId, name, personaId } = req.query;
    
    if (!['task', 'general', 'persona', 'direct'].includes(type as string)) {
      return res.status(400).json({ error: 'type must be "task", "general", "persona", or "direct"' });
    }
    
    const channel = await createOrGetChannel(
      channelId, 
      type as 'task' | 'general' | 'persona' | 'direct', 
      taskId as string, 
      name as string,
      personaId as string
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
      processChatMention(message).catch(error => {
        console.error('Error processing mentions:', error);
      });
    }
    
    // Auto-respond in direct/persona DM channels (even without @mention)
    const isDirectChannel = (channel.type === 'persona' || channel.type === 'direct' || 
      channel.id.startsWith('direct-')) && authorType === 'human';
    if (isDirectChannel && message.mentions.length === 0) {
      // Figure out which persona this channel belongs to
      // Channel ID format: "direct-{personaId}-{userId}" — extract persona part
      const personaId = channel.personaId || channel.id.replace(/^direct-/, '').replace(/-[^-]+$/, '');
      if (personaId) {
        // Inject the persona as a mention so processChatMention handles it
        const personaMessage = {
          ...message,
          mentions: [personaId],
        };
        console.log(`📨 Direct channel - auto-triggering ${personaId} (no @mention needed)`);
        processChatMention(personaMessage).catch(error => {
          console.error('Error processing direct chat:', error);
        });
      }
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

// User Settings API routes

// GET /api/settings - Get user settings
app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await getUserSettings();
    res.json({ settings });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings - Update user settings
app.put('/api/settings', async (req, res) => {
  try {
    const settings = req.body as UserSettings;

    if (!settings.userName || typeof settings.userName !== 'string') {
      return res.status(400).json({ error: 'userName is required and must be a string' });
    }

    await saveUserSettings(settings);
    res.json({ settings });
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// PR Comment Resolver API routes

// GET /api/pr-resolver/status - Get PR resolver status
app.get('/api/pr-resolver/status', async (_req, res) => {
  try {
    const settings = await getUserSettings();
    const prStatus = await getPRResolverStatus();
    const status = {
      enabled: settings.prResolver?.enabled || false,
      frequency: settings.prResolver?.frequency || '0 */6 * * *',
      lastRun: settings.prResolver?.lastRun,
      githubUsername: settings.githubUsername,
      isRunning: prStatus.isRunning
    };
    res.json({ status });
  } catch (error) {
    console.error('GET /api/pr-resolver/status error:', error);
    res.status(500).json({ error: 'Failed to get PR resolver status' });
  }
});

// POST /api/pr-resolver/toggle - Enable/disable PR resolver
app.post('/api/pr-resolver/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const settings = await getUserSettings();
    if (!settings.githubUsername) {
      return res.status(400).json({ error: 'GitHub username must be configured first' });
    }

    await togglePRResolver(enabled);
    const status = await getUserSettings();

    res.json({
      enabled: status.prResolver?.enabled || false,
      frequency: status.prResolver?.frequency || '0 */6 * * *'
    });
  } catch (error) {
    console.error('POST /api/pr-resolver/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle PR resolver' });
  }
});

// PUT /api/pr-resolver/frequency - Update PR resolver frequency
app.put('/api/pr-resolver/frequency', async (req, res) => {
  try {
    const { frequency } = req.body;

    if (typeof frequency !== 'string') {
      return res.status(400).json({ error: 'frequency must be a string' });
    }

    await updatePRResolverFrequency(frequency);
    const settings = await getUserSettings();

    res.json({
      enabled: settings.prResolver?.enabled || false,
      frequency: settings.prResolver?.frequency
    });
  } catch (error) {
    console.error('PUT /api/pr-resolver/frequency error:', error);
    res.status(500).json({ error: 'Failed to update PR resolver frequency' });
  }
});

// POST /api/pr-resolver/run - Manually trigger PR comment resolution
app.post('/api/pr-resolver/run', async (req, res) => {
  try {
    const { dryRun = false } = req.body;

    const settings = await getUserSettings();
    if (!settings.githubUsername) {
      return res.status(400).json({ error: 'GitHub username must be configured first' });
    }

    // Run in background and return immediately
    runPRCommentResolver(dryRun).catch(error => {
      console.error('PR resolver run failed:', error);
    });

    res.json({
      success: true,
      message: `PR comment resolution ${dryRun ? 'dry run' : 'run'} started`
    });
  } catch (error) {
    console.error('POST /api/pr-resolver/run error:', error);
    res.status(500).json({ error: 'Failed to trigger PR resolution' });
  }
});

// Standup API routes

// GET /api/standup/generate - Generate a new standup from recent activity
app.get('/api/standup/generate', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const entry = await generateStandupEntry(hours);
    res.json({ standup: entry });
  } catch (error) {
    console.error('GET /api/standup/generate error:', error);
    res.status(500).json({ error: 'Failed to generate standup' });
  }
});

// POST /api/standup - Save a standup entry
app.post('/api/standup', async (req, res) => {
  try {
    const entry = req.body as StandupEntry;
    
    if (!entry.date || !entry.yesterday || !entry.today || !entry.blockers) {
      return res.status(400).json({ error: 'Invalid standup entry format' });
    }
    
    await saveStandupEntry(entry);
    res.status(201).json({ standup: entry });
  } catch (error) {
    console.error('POST /api/standup error:', error);
    res.status(500).json({ error: 'Failed to save standup' });
  }
});

// GET /api/standup/history - Get standup history
app.get('/api/standup/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const entries = await getRecentStandupEntries(days);
    res.json({ standups: entries });
  } catch (error) {
    console.error('GET /api/standup/history error:', error);
    res.status(500).json({ error: 'Failed to fetch standup history' });
  }
});

// GET /api/standup/all - Get all standups
app.get('/api/standup/all', async (_req, res) => {
  try {
    const entries = await getAllStandupEntries();
    res.json({ standups: entries });
  } catch (error) {
    console.error('GET /api/standup/all error:', error);
    res.status(500).json({ error: 'Failed to fetch all standups' });
  }
});

// PUT /api/standup/:id - Update a standup entry
app.put('/api/standup/:id', async (req, res) => {
  try {
    const { yesterday, today, blockers } = req.body as { yesterday?: string[]; today?: string[]; blockers?: string[] };
    
    const updated = await updateStandupEntry(req.params.id, { yesterday, today, blockers });
    if (!updated) {
      return res.status(404).json({ error: 'Standup not found' });
    }
    res.json({ standup: updated });
  } catch (error) {
    console.error(`PUT /api/standup/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to update standup' });
  }
});

// DELETE /api/standup/:id - Delete a standup entry
app.delete('/api/standup/:id', async (req, res) => {
  try {
    const deleted = await deleteStandupEntry(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Standup not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/standup/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete standup' });
  }
});

// Full Sync API route
app.get('/api/sync/full', async (_req, res) => {
  try {
    // Set up Server-Sent Events for progress streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const sendProgress = (step: string, status: 'started' | 'progress' | 'completed' | 'error', message: string, data?: any) => {
      res.write(`data: ${JSON.stringify({ step, status, message, data, timestamp: new Date().toISOString() })}\n\n`);
    };

    sendProgress('init', 'started', 'Starting full sync pipeline...');

    // Helper to run a CLI command and stream output
    const { exec: execCmd } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(execCmd);

    const runStep = async (stepName: string, command: string, description: string): Promise<boolean> => {
      sendProgress(stepName, 'started', description);
      try {
        const { stdout } = await execAsync(command, { 
          timeout: 120000, // 2 min timeout per step
          env: { ...process.env, PATH: process.env.PATH }
        });
        const output = stdout.trim();
        sendProgress(stepName, 'completed', output || `${stepName} completed`);
        return true;
      } catch (error: any) {
        const errMsg = error.stderr?.trim() || error.stdout?.trim() || error.message;
        console.error(`Sync step ${stepName} error:`, errMsg);
        sendProgress(stepName, 'error', `${stepName} failed: ${errMsg}`);
        return false;
      }
    };

    try {
      // Step 1: tix sync — fetch tickets from Notion via Claude MCP
      await runStep('notion', 'tix sync', 'Syncing tickets from Notion (via Claude MCP)...');

      // Step 2: tix sync-gh — find GitHub PRs for each ticket
      await runStep('github', 'tix sync-gh', 'Syncing GitHub PR data...');

      // Step 3: tix kanban-sync — push synced data into tix-kanban
      await runStep('kanban', 'tix kanban-sync', 'Syncing tickets to kanban board...');

      // Step 4: Refresh task count
      const refreshedTasks = await getAllTasks();
      sendProgress('refresh', 'completed', `Board refreshed: ${refreshedTasks.length} tasks loaded`);

      // Complete
      sendProgress('complete', 'completed', 'Full sync pipeline completed successfully!');
      
    } catch (error: any) {
      console.error('Full sync pipeline error:', error);
      sendProgress('error', 'error', `Pipeline failed: ${error.message}`);
    }

    res.end();
  } catch (error) {
    console.error('GET /api/sync/full error:', error);
    res.status(500).json({ error: 'Failed to start sync pipeline' });
  }
});

// Notion Sync API routes

// GET /api/notion/config - Get Notion configuration
app.get('/api/notion/config', async (_req, res) => {
  try {
    const config = await loadNotionConfig();
    if (!config) {
      return res.json({ configured: false });
    }
    
    // Don't expose the API key in the response
    const { apiKey, ...safeConfig } = config;
    res.json({ 
      configured: true, 
      config: { ...safeConfig, hasApiKey: !!apiKey }
    });
  } catch (error) {
    console.error('GET /api/notion/config error:', error);
    res.status(500).json({ error: 'Failed to fetch Notion config' });
  }
});

// POST /api/notion/config - Save Notion configuration
app.post('/api/notion/config', async (req, res) => {
  try {
    const config = req.body as NotionConfig;
    
    // Validate required fields
    if (!config.apiKey || !config.databaseId || !config.userName) {
      return res.status(400).json({ 
        error: 'apiKey, databaseId, and userName are required' 
      });
    }

    // Set default status mappings if not provided
    if (!config.statusMappings) {
      config.statusMappings = getDefaultStatusMappings();
    }

    await saveNotionConfig(config);
    res.json({ success: true });
  } catch (error) {
    console.error('POST /api/notion/config error:', error);
    res.status(500).json({ error: 'Failed to save Notion config' });
  }
});

// POST /api/notion/sync - Sync tasks from Notion
app.post('/api/notion/sync', async (_req, res) => {
  try {
    const config = await loadNotionConfig();
    if (!config) {
      return res.status(400).json({ error: 'Notion not configured' });
    }

    if (!config.syncEnabled) {
      return res.status(400).json({ error: 'Notion sync is disabled' });
    }

    const notionTasks = await syncTasksFromNotion(config);
    
    // Convert Notion tasks to kanban tasks
    const tasksCreated = [];
    const tasksSkipped = [];

    for (const notionTask of notionTasks) {
      try {
        // Check if task already exists (by Notion ID)
        const existingTask = await getTask(notionTask.id);
        
        if (existingTask) {
          // Update existing task
          const kanbanStatus = mapNotionStatusToKanban(notionTask.status, config.statusMappings);
          await updateTask(notionTask.id, {
            title: notionTask.title,
            description: notionTask.description || '',
            status: kanbanStatus,
            priority: notionTask.priority || 100,
            updatedAt: new Date(),
          });
          tasksSkipped.push(notionTask.title);
        } else {
          // Create new task
          const kanbanStatus = mapNotionStatusToKanban(notionTask.status, config.statusMappings);
          await createTask({
            title: notionTask.title,
            description: notionTask.description || '',
            status: kanbanStatus,
            priority: notionTask.priority || 100,
            persona: 'general-developer',
            tags: ['notion-sync'],
            comments: [],
            links: [{
              id: `link-${Date.now()}`,
              taskId: notionTask.id,
              url: notionTask.url,
              title: 'Notion Page',
              type: 'reference'
            }],
          });
          tasksCreated.push(notionTask.title);
        }
      } catch (taskError) {
        console.error(`Failed to sync task "${notionTask.title}":`, taskError);
        tasksSkipped.push(notionTask.title);
      }
    }

    res.json({ 
      success: true,
      summary: {
        totalFetched: notionTasks.length,
        tasksCreated: tasksCreated.length,
        tasksUpdated: tasksSkipped.length,
        createdTasks: tasksCreated,
        updatedTasks: tasksSkipped,
      }
    });
  } catch (error) {
    console.error('POST /api/notion/sync error:', error);
    res.status(500).json({ error: 'Failed to sync from Notion' });
  }
});

// GET /api/notion/test - Test Notion connection
app.get('/api/notion/test', async (_req, res) => {
  try {
    const config = await loadNotionConfig();
    if (!config) {
      return res.status(400).json({ error: 'Notion not configured' });
    }

    // Try to fetch a small number of tasks to test the connection
    const notionTasks = await syncTasksFromNotion({
      ...config,
      // Override to fetch only a few tasks for testing
    });
    
    res.json({ 
      success: true, 
      message: `Successfully connected to Notion. Found ${notionTasks.length} tasks.`,
      sampleTasks: notionTasks.slice(0, 3).map(task => ({
        title: task.title,
        status: task.status,
        mappedStatus: mapNotionStatusToKanban(task.status, config.statusMappings)
      }))
    });
  } catch (error) {
    console.error('GET /api/notion/test error:', error);
    res.status(400).json({ 
      error: 'Failed to connect to Notion', 
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Activity Log API routes
const ACTIVITY_LOG_DIR = path.join(process.env.HOME || '/root', '.tix', 'logs');

async function ensureLogDir() {
  const fsSync = await import('fs');
  if (!fsSync.default.existsSync(ACTIVITY_LOG_DIR)) {
    fsSync.default.mkdirSync(ACTIVITY_LOG_DIR, { recursive: true });
  }
}

async function readLogFile(date: string): Promise<any[]> {
  const { promises: fsp } = await import('fs');
  const filePath = path.join(ACTIVITY_LOG_DIR, `${date}.json`);
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeLogFile(date: string, entries: any[]) {
  const { promises: fsp } = await import('fs');
  await ensureLogDir();
  const filePath = path.join(ACTIVITY_LOG_DIR, `${date}.json`);
  await fsp.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

// GET /api/activity-log?days=7 — returns log entries
app.get('/api/activity-log', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const allEntries: Record<string, any[]> = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const entries = await readLogFile(date);
      if (entries.length > 0) {
        allEntries[date] = entries;
      }
    }
    
    res.json({ entries: allEntries });
  } catch (error) {
    console.error('GET /api/activity-log error:', error);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// POST /api/activity-log — adds a new entry
app.post('/api/activity-log', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    
    const settings = await getUserSettings();
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    
    const entry = {
      timestamp: now.toISOString(),
      date,
      entry: message,
      author: settings.userName || 'unknown'
    };
    
    const entries = await readLogFile(date);
    entries.push(entry);
    await writeLogFile(date, entries);
    
    res.status(201).json({ entry });
  } catch (error) {
    console.error('POST /api/activity-log error:', error);
    res.status(500).json({ error: 'Failed to add log entry' });
  }
});

// DELETE /api/activity-log/:date/:index — deletes an entry
app.delete('/api/activity-log/:date/:index', async (req, res) => {
  try {
    const { date, index } = req.params;
    const idx = parseInt(index);
    
    const entries = await readLogFile(date);
    if (idx < 0 || idx >= entries.length) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    entries.splice(idx, 1);
    await writeLogFile(date, entries);
    
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/activity-log error:', error);
    res.status(500).json({ error: 'Failed to delete log entry' });
  }
});

// Daily Notes API routes
const DAILY_NOTES_DIR = path.join(process.env.HOME || '/root', '.tix', 'notes');

async function ensureNotesDir() {
  const fsSync = await import('fs');
  if (!fsSync.default.existsSync(DAILY_NOTES_DIR)) {
    fsSync.default.mkdirSync(DAILY_NOTES_DIR, { recursive: true });
  }
}

async function readNotesFile(date: string): Promise<any[]> {
  const { promises: fsp } = await import('fs');
  const filePath = path.join(DAILY_NOTES_DIR, `${date}.json`);
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeNotesFile(date: string, entries: any[]) {
  const { promises: fsp } = await import('fs');
  await ensureNotesDir();
  const filePath = path.join(DAILY_NOTES_DIR, `${date}.json`);
  await fsp.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

// GET /api/daily-notes?days=14 — returns notes grouped by date
app.get('/api/daily-notes', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const allNotes: Record<string, any[]> = {};

    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const notes = await readNotesFile(date);
      if (notes.length > 0) {
        allNotes[date] = notes;
      }
    }

    res.json({ notes: allNotes });
  } catch (error) {
    console.error('GET /api/daily-notes error:', error);
    res.status(500).json({ error: 'Failed to fetch daily notes' });
  }
});

// POST /api/daily-notes — adds a new note
app.post('/api/daily-notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const settings = await getUserSettings();
    const now = new Date();
    const date = now.toISOString().split('T')[0];

    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now.toISOString(),
      date,
      content,
      author: settings.userName || 'unknown'
    };

    const notes = await readNotesFile(date);
    notes.push(note);
    await writeNotesFile(date, notes);

    res.status(201).json({ note });
  } catch (error) {
    console.error('POST /api/daily-notes error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// PUT /api/daily-notes/:date/:id — updates a note
app.put('/api/daily-notes/:date/:id', async (req, res) => {
  try {
    const { date, id } = req.params;
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const notes = await readNotesFile(date);
    const idx = notes.findIndex((n: any) => n.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Note not found' });
    }

    notes[idx].content = content;
    notes[idx].timestamp = new Date().toISOString();
    await writeNotesFile(date, notes);

    res.json({ note: notes[idx] });
  } catch (error) {
    console.error('PUT /api/daily-notes error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// DELETE /api/daily-notes/:date/:id — deletes a note
app.delete('/api/daily-notes/:date/:id', async (req, res) => {
  try {
    const { date, id } = req.params;

    const notes = await readNotesFile(date);
    const idx = notes.findIndex((n: any) => n.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Note not found' });
    }

    notes.splice(idx, 1);
    await writeNotesFile(date, notes);

    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/daily-notes error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
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
    await initializeReportsStorage();
    await initializeKnowledgeStorage();
    await initializeStandupStorage();
    await startWorker();
    await startPRResolver();

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