import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { initializeTriggerSystem } from './event-triggers.js';
import { loadPermissionsFromPersonas } from './persona-invocation-permissions.js';
import {
  getAllTasks,
  getTask,
  createTask,
  updateTask,
  removeTask,
  initializeStorage,
  getTaskActivity,
  getAllActivity,
  withTaskLock,
  writeTask,
  updateSummary
} from './storage.js';
import { Task, Comment, Link, Persona } from '../client/types/index.js';
import {
  startWorker,
  toggleWorker,
  updateWorkerInterval,
  getWorkerStatus,
  toggleStandupScheduler,
  updateStandupTime,
  triggerStandupGeneration,
  toggleSlxSyncScheduler,
  updateSlxSyncInterval,
  triggerSlxSync,
  toggleReminderCheckScheduler,
  updateReminderCheckInterval,
  triggerReminderCheck,
  getRequiredProviders
} from './worker.js';
import {
  getRules,
  addRule,
  updateRule,
  deleteRule,
  evaluateReminderRules,
  getReminderHistory,
  clearCooldowns
} from './reminder-rules.js';
import {
  createReminder,
  getAllReminders,
  getPendingReminders,
  getDueReminders,
  getRemindersForTarget,
  getReminderById,
  markReminderTriggered,
  snoozeReminder,
  deleteReminder,
  clearTriggeredReminders,
  createRecurringReminder,
  scheduleNextOccurrence,
  pauseReminder,
  resumeReminder,
  Recurrence
} from './personal-reminders.js';
import {
  getAllPersonas,
  getPersona,
  createPersona,
  updatePersona,
  deletePersona,
  initializePersonas,
  updatePersonaRating,
  updatePersonaStats
} from './persona-storage.js';
import { enforceProviderAccess } from './persona-yaml-loader.js';
import {
  getOrCreateSession,
  getSessionHistory,
  resetSession,
  getSessionStats
} from '../services/sessionService.js';

/**
 * Refresh persona-derived runtime state after a CRUD mutation.
 * Uses a single getAllPersonas() call to feed both invocation permissions
 * and trigger system re-initialization, avoiding a redundant storage read.
 */
async function refreshPersonaSystemState(label: string): Promise<void> {
  const all = await getAllPersonas();
  loadPermissionsFromPersonas(all);
  await initializeTriggerSystem(all);
  console.log(`[persona-system] Refreshed after ${label}`);
}

import { loadExternalPersona, loadExternalPersonas, clearPersonaCache, ExternalPersonaSource } from './persona-external-loader.js';
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
  getAllChannels,
  runArchiveMaintenance
} from './chat-storage.js';
import { processChatMention, startDirectConversation, getTeamOverview } from './agent-chat.js';
import { initSSE, sendSSE } from './streaming-chat.js';
import {
  loadProviderConfig,
  listProviders,
  setTicketProvider,
  setMessageProvider,
  getTicketProvider,
  getMessageProvider,
  getDocumentProvider,
  initializeProviders,
} from './providers/index.js';
import {
  startConversationHandler,
  pauseConversationHandler,
  resumeConversationHandler,
  getConversationStateHandler,
  getBudgetStatusHandler
} from './conversation-api.js';
import { runConversationMonitor } from './persona-conversation.js';
import type { ProviderConfig } from './providers/types.js';
import { startPRCacheAutoRefresh } from './pr-cache.js';
import {
  getAgentMemory,
  addMemoryEntry,
  updateMemoryEntry,
  deleteMemoryEntry,
  searchMemories,
  clearMemories,
  getAllPersonaMemories,
  buildTaskMemoryContext,
  MemoryEntry as AgentMemoryEntry
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
  getAllTaskPipelineStates,
  updateTaskPipelineState,
  deleteTaskPipelineState
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
  resolveBackupDir,
  UserSettings
} from './user-settings.js';
import {
  runBackup,
  getBackupStatus,
  updateBackupSchedule,
  startBackupScheduler,
  stopBackupScheduler,
  getBackupCategories,
  updateBackupCategories,
  createFileBackup,
  restoreFileBackup,
  listBackups
} from './backup.js';
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
  generateDailySummary,
  readSummary,
  summaryExists
} from './dailySummary.js';
// Notion sync removed - now using CLI-based providers
// See documentation/providers.md for the new architecture
import {
  runPRCommentResolver,
  startPRResolver,
  togglePRResolver,
  updatePRResolverFrequency,
  getPRResolverStatus
} from './pr-comment-resolver.js';
import {
  getSlxConfig,
  saveSlxConfig,
  runSlxSync,
  runSlxDigest,
  getSlackData,
  getSlxStatus
} from './slx-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Build an error response with detail from the actual error
function errorResponse(message: string, error: unknown): { error: string } {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`${message}: ${detail}`);
  return { error: message };
}

// Safely parse an integer with NaN check and min/max bounds
function clampInt(value: string | undefined, defaultVal: number, min: number, max: number): number {
  if (value === undefined) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

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
    res.status(500).json(errorResponse('Failed to fetch tasks', error));
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
    res.status(500).json(errorResponse('Failed to fetch task', error));
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
    res.status(500).json(errorResponse('Failed to create task', error));
  }
});

// PUT /api/tasks/:id - Update task
app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { actor, newComment, ...updates } = req.body as Partial<Task> & { actor?: string; newComment?: { body: string } };

    // Validate newComment: if provided, only allow body field (server generates id, author, taskId, createdAt)
    let validatedNewComment: { body: string } | undefined;
    if (newComment) {
      if (typeof newComment.body !== 'string' || !newComment.body.trim()) {
        return res.status(400).json({ error: 'newComment.body must be a non-empty string' });
      }
      validatedNewComment = { body: newComment.body.trim() };
    }

    // Merge validated newComment back into updates (type cast for storage function)
    const finalUpdates = validatedNewComment
      ? { ...updates, newComment: validatedNewComment as any }
      : updates;

    // Get the current task state before updating
    const previousTask = await getTask(req.params.id);
    if (!previousTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Enforce provider access at assignment/update time, not only at worker runtime.
    const targetPersonaRef = updates.persona ?? previousTask.persona;
    if (targetPersonaRef) {
      const personas = await getAllPersonas();
      const targetPersona = personas.find(
        (p) => p.id === targetPersonaRef || p.name.toLowerCase() === targetPersonaRef.toLowerCase(),
      );
      if (targetPersona) {
        const effectiveRepo = updates.repo !== undefined ? updates.repo : previousTask.repo;
        const requiredProviders = getRequiredProviders({ ...previousTask, ...updates, repo: effectiveRepo } as Task);

        for (const provider of requiredProviders) {
          try {
            enforceProviderAccess(targetPersona, provider);
          } catch (accessError) {
            return res.status(400).json({
              error:
                accessError instanceof Error
                  ? accessError.message
                  : `Persona "${targetPersona.name}" cannot access required provider "${provider}"`,
            });
          }
        }
      }
    }

    // Update the task
    const task = await updateTask(req.params.id, finalUpdates, actor || 'api');

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // If pipelineId is being cleared (set to null), also delete the pipeline state
    if (updates.pipelineId === null && previousTask.pipelineId) {
      try {
        await deleteTaskPipelineState(req.params.id);
      } catch (error) {
        console.error(`Failed to delete pipeline state for task ${req.params.id}:`, error);
        // Don't fail the request if state deletion fails
      }
    }

    // If task is being marked as done and has a persona, update persona stats
    if (updates.status === 'done' && previousTask.status !== 'done' && task.persona) {
      // Find the persona by name to get its ID
      const personas = await getAllPersonas();
      const persona = personas.find(p => p.name.toLowerCase() === task.persona?.toLowerCase() || p.id === task.persona);

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
    res.status(500).json(errorResponse('Failed to update task', error));
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
    res.status(500).json(errorResponse('Failed to delete task', error));
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
    res.status(500).json(errorResponse('Failed to fetch task activity', error));
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
    res.status(500).json(errorResponse('Failed to fetch activity', error));
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
    res.status(500).json(errorResponse('Failed to suggest tags', error));
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
    res.status(500).json(errorResponse('Failed to auto-apply tags', error));
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
    res.status(500).json(errorResponse('Failed to add comment', error));
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
    res.status(500).json(errorResponse('Failed to add link', error));
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
    res.status(500).json(errorResponse('Failed to delete link', error));
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
    res.status(500).json(errorResponse('Failed to add rating', error));
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

// Document Provider API routes

// GET /api/documents - List all indexed documents
app.get('/api/documents', async (_req, res) => {
  try {
    const provider = getDocumentProvider();
    if (!provider) {
      return res.status(503).json({ error: 'Document provider not available' });
    }
    
    const documents = await provider.list();
    res.json(documents);
  } catch (error) {
    console.error('GET /api/documents error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /api/documents/search - Search for documents
app.get('/api/documents/search', async (req, res) => {
  try {
    const provider = getDocumentProvider();
    if (!provider) {
      return res.status(503).json({ error: 'Document provider not available' });
    }
    
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    if (Number.isNaN(limit) || limit <= 0) {
      return res.status(400).json({ error: 'Query parameter "limit" must be a positive integer' });
    }

    const documents = await provider.search(query, limit);
    res.json(documents);
  } catch (error) {
    console.error('GET /api/documents/search error:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

// POST /api/documents/index - Index documents from paths
app.post('/api/documents/index', async (req, res) => {
  try {
    const provider = getDocumentProvider();
    if (!provider) {
      return res.status(503).json({ error: 'Document provider not available' });
    }
    
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      return res.status(400).json({ error: 'paths must be an array' });
    }
    
    await provider.index(paths);
    const documents = await provider.list();
    res.json({ success: true, count: documents.length });
  } catch (error) {
    console.error('POST /api/documents/index error:', error);
    res.status(500).json({ error: 'Failed to index documents' });
  }
});

// POST /api/documents/refresh - Refresh document index
app.post('/api/documents/refresh', async (_req, res) => {
  try {
    const provider = getDocumentProvider();
    if (!provider) {
      return res.status(503).json({ error: 'Document provider not available' });
    }
    
    await provider.refresh();
    const documents = await provider.list();
    res.json({ success: true, count: documents.length });
  } catch (error) {
    console.error('POST /api/documents/refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh documents' });
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
    res.status(500).json(errorResponse('Failed to toggle worker', error));
  }
});

// PUT /api/worker/interval - Update worker interval
app.put('/api/worker/interval', async (req, res) => {
  try {
    const { interval } = req.body;
    
    if (typeof interval !== 'string') {
      return res.status(400).json({ error: 'interval must be a string' });
    }

    const cronModule = await import('node-cron');
    if (!cronModule.validate(interval)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
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

    const cronModule = await import('node-cron');
    if (!cronModule.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
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

// POST /api/worker/slx-sync/toggle - Enable/disable slx sync scheduler
app.post('/api/worker/slx-sync/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    await toggleSlxSyncScheduler(enabled);
    const status = getWorkerStatus();

    res.json({ status });
  } catch (error) {
    console.error('POST /api/worker/slx-sync/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle slx sync scheduler' });
  }
});

// PUT /api/worker/slx-sync/interval - Update slx sync interval
app.put('/api/worker/slx-sync/interval', async (req, res) => {
  try {
    const { cronExpression } = req.body;

    if (typeof cronExpression !== 'string') {
      return res.status(400).json({ error: 'cronExpression must be a string' });
    }

    const cronModule = await import('node-cron');
    if (!cronModule.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }

    await updateSlxSyncInterval(cronExpression);
    const status = getWorkerStatus();

    res.json({ status });
  } catch (error) {
    console.error('PUT /api/worker/slx-sync/interval error:', error);
    res.status(500).json({ error: 'Failed to update slx sync interval' });
  }
});

// POST /api/worker/slx-sync/trigger - Manually trigger slx sync
app.post('/api/worker/slx-sync/trigger', async (_req, res) => {
  try {
    await triggerSlxSync();
    res.json({ success: true, message: 'slx sync triggered' });
  } catch (error) {
    console.error('POST /api/worker/slx-sync/trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger slx sync' });
  }
});


// POST /api/worker/reminder-check/toggle - Enable/disable reminder check scheduler
app.post('/api/worker/reminder-check/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    await toggleReminderCheckScheduler(enabled);
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('POST /api/worker/reminder-check/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle reminder check scheduler' });
  }
});

// POST /api/worker/reminder-check/interval - Update reminder check interval
app.post('/api/worker/reminder-check/interval', async (req, res) => {
  try {
    const { interval } = req.body;

    if (typeof interval !== 'string') {
      return res.status(400).json({ error: 'interval must be a string' });
    }

    await updateReminderCheckInterval(interval);
    res.json({ success: true, interval });
  } catch (error) {
    console.error('POST /api/worker/reminder-check/interval error:', error);
    res.status(500).json({
      error: error instanceof Error && error.message === 'Invalid cron expression'
        ? 'Invalid cron expression format'
        : 'Failed to update reminder check interval'
    });
  }
});

// POST /api/worker/reminder-check/trigger - Manually trigger reminder check
app.post('/api/worker/reminder-check/trigger', async (_req, res) => {
  try {
    await triggerReminderCheck();
    res.json({ success: true, message: 'Reminder check triggered' });
  } catch (error) {
    console.error('POST /api/worker/reminder-check/trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger reminder check' });
  }
});

// Reminder Rules API routes

// GET /api/reminder-rules - Get all reminder rules
app.get('/api/reminder-rules', async (_req, res) => {
  try {
    const rules = await getRules();
    res.json({ rules });
  } catch (error) {
    console.error('GET /api/reminder-rules error:', error);
    res.status(500).json({ error: 'Failed to fetch reminder rules' });
  }
});

// POST /api/reminder-rules - Create a new reminder rule
app.post('/api/reminder-rules', async (req, res) => {
  try {
    const { name, description, enabled, target, conditions, action, cooldown } = req.body;

    // Validate required fields
    if (!name || !description || target === undefined || !conditions || !Array.isArray(conditions) || conditions.length === 0 || !action || !cooldown) {
      return res.status(400).json({ error: 'Missing required fields (conditions must be a non-empty array)' });
    }

    const rule = await addRule({
      name,
      description,
      enabled: enabled !== false,
      target,
      conditions,
      action,
      cooldown
    });

    res.json({ success: true, rule });
  } catch (error) {
    console.error('POST /api/reminder-rules error:', error);
    res.status(500).json({ error: 'Failed to create reminder rule' });
  }
});

// PUT /api/reminder-rules/:id - Update a reminder rule
app.put('/api/reminder-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    await updateRule(id, updates);
    res.json({ success: true });
  } catch (error) {
    console.error('PUT /api/reminder-rules/:id error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update reminder rule' });
  }
});

// DELETE /api/reminder-rules/:id - Delete a reminder rule
app.delete('/api/reminder-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await deleteRule(id);
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/reminder-rules/:id error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete reminder rule' });
  }
});

// POST /api/reminder-rules/evaluate - Manually evaluate all rules (dry run option)
app.post('/api/reminder-rules/evaluate', async (req, res) => {
  try {
    const { dryRun } = req.body;

    await evaluateReminderRules(dryRun === true);
    res.json({ success: true, dryRun: dryRun === true });
  } catch (error) {
    console.error('POST /api/reminder-rules/evaluate error:', error);
    res.status(500).json({ error: 'Failed to evaluate reminder rules' });
  }
});

// GET /api/reminder-rules/history - Get reminder trigger history
app.get('/api/reminder-rules/history', async (_req, res) => {
  try {
    const history = await getReminderHistory();
    res.json({ history });
  } catch (error) {
    console.error('GET /api/reminder-rules/history error:', error);
    res.status(500).json({ error: 'Failed to fetch reminder history' });
  }
});

// POST /api/reminder-rules/clear-cooldowns - Clear all cooldowns
app.post('/api/reminder-rules/clear-cooldowns', async (_req, res) => {
  try {
    await clearCooldowns();
    res.json({ success: true, message: 'Cooldowns cleared' });
  } catch (error) {
    console.error('POST /api/reminder-rules/clear-cooldowns error:', error);
    res.status(500).json({ error: 'Failed to clear cooldowns' });
  }
});

// Personal Reminders API routes

// Parse snooze duration to Date
function parseSnoozeDuration(duration: string): Date {
  const now = new Date();
  switch (duration) {
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000);
    case '4h':
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case 'next week': {
      const d = new Date(now);
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    default: {
      const match = duration?.match(/^(\d+)([hm])$/);
      if (match) {
        return new Date(
          now.getTime() + parseInt(match[1]) * (match[2] === 'h' ? 3600000 : 60000)
        );
      }
      throw new Error(`Unknown duration: ${duration}`);
    }
  }
}

// GET /api/reminders - Get all personal reminders (with optional filters)
app.get('/api/reminders', async (req, res) => {
  try {
    const { status, type } = req.query;
    let reminders = await getAllReminders();

    // Filter by status
    if (status === 'active') {
      reminders = reminders.filter(r => r.status === 'pending');
    } else if (status === 'triggered') {
      reminders = reminders.filter(r => r.status === 'triggered');
    }

    // Filter by type
    if (type === 'adhoc') {
      reminders = reminders.filter(r => r.type === 'adhoc');
    } else if (type === 'recurring') {
      reminders = reminders.filter(r => r.type === 'recurring');
    }

    res.json({ reminders });
  } catch (error) {
    console.error('GET /api/reminders error:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// POST /api/reminders - Create a new personal reminder
app.post('/api/reminders', async (req, res) => {
  try {
    const { message, remindAt, taskId, creator, target, type, recurrence } = req.body;

    if (!message || !remindAt || !creator || !target) {
      return res
        .status(400)
        .json({ error: 'message, remindAt, creator, and target are required' });
    }

    // Check if this is a recurring reminder
    if (recurrence) {
      const validRecurrence: Recurrence = {
        type: recurrence.type || 'simple',
        interval: recurrence.interval,
        weekday: recurrence.weekday,
        cronExpr: recurrence.cronExpr
      };
      
      const reminder = await createRecurringReminder(
        message,
        validRecurrence,
        taskId,
        creator,
        target,
        new Date(remindAt)
      );
      res.status(201).json({ reminder });
    } else {
      const reminder = await createReminder(
        message,
        new Date(remindAt),
        taskId,
        creator,
        target,
        type || 'adhoc'
      );
      res.status(201).json({ reminder });
    }
  } catch (error) {
    console.error('POST /api/reminders error:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// GET /api/reminders/pending - Get pending reminders (must be before /:id)
app.get('/api/reminders/pending', async (_req, res) => {
  try {
    const reminders = await getPendingReminders();
    res.json({ reminders });
  } catch (error) {
    console.error('GET /api/reminders/pending error:', error);
    res.status(500).json({ error: 'Failed to fetch pending reminders' });
  }
});

// GET /api/reminders/due - Get due reminders (must be before /:id)
app.get('/api/reminders/due', async (_req, res) => {
  try {
    const reminders = await getDueReminders();
    res.json({ reminders });
  } catch (error) {
    console.error('GET /api/reminders/due error:', error);
    res.status(500).json({ error: 'Failed to fetch due reminders' });
  }
});

// GET /api/reminders/target/:target - Get reminders for a specific target (must be before /:id)
app.get('/api/reminders/target/:target', async (req, res) => {
  try {
    const { target } = req.params;
    const reminders = await getRemindersForTarget(target);
    res.json({ reminders });
  } catch (error) {
    console.error('GET /api/reminders/target/:target error:', error);
    res.status(500).json({ error: 'Failed to fetch reminders for target' });
  }
});

// GET /api/reminders/:id - Get a single reminder (after specific routes)
app.get('/api/reminders/:id', async (req, res) => {
  try {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json({ reminder });
  } catch (error) {
    console.error(`GET /api/reminders/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to fetch reminder' });
  }
});

// POST /api/reminders/:id/snooze - Snooze a reminder
app.post('/api/reminders/:id/snooze', async (req, res) => {
  try {
    const { id } = req.params;
    const { duration } = req.body;

    if (!duration) {
      return res.status(400).json({ error: 'duration is required (e.g., 1h, 4h, tomorrow, next week)' });
    }

    const newTime = parseSnoozeDuration(duration);
    const reminder = await snoozeReminder(id, newTime);
    res.json({ reminder });
  } catch (error) {
    console.error(`POST /api/reminders/${req.params.id}/snooze error:`, error);
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to snooze reminder' });
    }
  }
});

// POST /api/reminders/:id/trigger - Mark a reminder as triggered
app.post('/api/reminders/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params;
    const reminder = await getReminderById(id);
    
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    await markReminderTriggered(id);
    
    // If this is a recurring reminder, schedule the next occurrence
    if (reminder.recurrence) {
      const nextReminder = await scheduleNextOccurrence(id);
      return res.json({ 
        success: true, 
        message: 'Reminder triggered, next occurrence scheduled',
        nextOccurrence: nextReminder?.triggerTime
      });
    }
    
    res.json({ success: true, message: 'Reminder marked as triggered' });
  } catch (error) {
    console.error(`POST /api/reminders/${req.params.id}/trigger error:`, error);
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : 'Failed to trigger reminder' });
  }
});

// POST /api/reminders/:id/pause - Pause a recurring reminder
app.post('/api/reminders/:id/pause', async (req, res) => {
  try {
    const { id } = req.params;
    const reminder = await getReminderById(id);
    
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    if (!reminder.recurrence) {
      return res.status(400).json({ error: 'Only recurring reminders can be paused' });
    }
    
    const pausedReminder = await pauseReminder(id);
    res.json({ success: true, reminder: pausedReminder });
  } catch (error) {
    console.error(`POST /api/reminders/${req.params.id}/pause error:`, error);
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : 'Failed to pause reminder' });
  }
});

// POST /api/reminders/:id/resume - Resume a paused recurring reminder
app.post('/api/reminders/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;
    const reminder = await getReminderById(id);
    
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    if (!reminder.recurrence) {
      return res.status(400).json({ error: 'Only recurring reminders can be resumed' });
    }
    
    const resumedReminder = await resumeReminder(id);
    res.json({ success: true, reminder: resumedReminder });
  } catch (error) {
    console.error(`POST /api/reminders/${req.params.id}/resume error:`, error);
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : 'Failed to resume reminder' });
  }
});

// DELETE /api/reminders/:id - Delete a reminder
app.delete('/api/reminders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteReminder(id);
    res.json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    console.error(`DELETE /api/reminders/${req.params.id} error:`, error);
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : 'Failed to delete reminder' });
  }
});

// POST /api/reminders/clear-triggered - Clear all triggered reminders
app.post('/api/reminders/clear-triggered', async (_req, res) => {
  try {
    await clearTriggeredReminders();
    res.json({ success: true, message: 'Triggered reminders cleared' });
  } catch (error) {
    console.error('POST /api/reminders/clear-triggered error:', error);
    res.status(500).json({ error: 'Failed to clear triggered reminders' });
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

// POST /api/personas/external - Load a persona from an external URL or file path
app.post('/api/personas/external', async (req, res) => {
  try {
    const { location, type, cacheDurationSeconds, authToken } = req.body as ExternalPersonaSource & { type: 'url' | 'file' };
    if (!location || !type) {
      return res.status(400).json({ error: 'location and type are required' });
    }
    const source: ExternalPersonaSource = { location, type, cacheDurationSeconds, authToken };
    const loaded = await loadExternalPersona(source);
    res.json({ persona: loaded.persona, loadedAt: loaded.loadedAt, cacheExpiresAt: loaded.cacheExpiresAt });
  } catch (error) {
    console.error('POST /api/personas/external error:', error);
    res.status(500).json({ error: 'Failed to load external persona', details: String(error) });
  }
});

// POST /api/personas/external/batch - Load multiple personas from external sources
app.post('/api/personas/external/batch', async (req, res) => {
  try {
    const { sources } = req.body as { sources: ExternalPersonaSource[] };
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: 'sources array is required' });
    }
    const results = await loadExternalPersonas(sources);
    const sanitizedFailed = results.failed.map(({ source, error }) => ({
      source: { ...source, authToken: undefined },
      error,
    }));
    res.json({
      loaded: results.loaded.map(l => ({ persona: l.persona, loadedAt: l.loadedAt })),
      failed: sanitizedFailed,
    });
  } catch (error) {
    console.error('POST /api/personas/external/batch error:', error);
    res.status(500).json({ error: 'Failed to load external personas', details: String(error) });
  }
});

// DELETE /api/personas/external/cache - Clear the external persona cache
app.delete('/api/personas/external/cache', (req, res) => {
  try {
    const { location } = req.query as { location?: string };
    clearPersonaCache(location);
    res.json({ cleared: true, location: location || 'all' });
  } catch (error) {
    console.error('DELETE /api/personas/external/cache error:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
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
    refreshPersonaSystemState('persona create').catch(err => console.error('[persona-system] Failed to refresh on persona create:', err));
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

    refreshPersonaSystemState('persona update').catch(err => console.error('[persona-system] Failed to refresh on persona update:', err));
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
    
    refreshPersonaSystemState('persona delete').catch(err => console.error('[persona-system] Failed to refresh on persona delete:', err));
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/personas/${req.params.id} error:`, error);
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

// Persona Memory API routes

// GET /api/personas/:id/memory - Get persona memory context (from unified agent-memory)
app.get('/api/personas/:id/memory', async (req, res) => {
  try {
    const memory = await buildTaskMemoryContext(req.params.id);
    const tokenCount = Math.ceil(memory.length / 4);
    res.json({ memory, tokenCount, isLarge: tokenCount > 10000 });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memory error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona memory' });
  }
});

// Types from persona-memory (memory functions now unified via agent-memory, soul via agent-soul)
import {
  MemoryEntry,
  StructuredMemory
} from './persona-memory.js';

// GET /api/personas/:id/memories - Get structured memories
app.get('/api/personas/:id/memories', async (req, res) => {
  try {
    // Get all agent memories for this persona (from all users)
    const agentMemories = await getAllPersonaMemories(req.params.id);

    // Transform agent memories to structured memory format
    const allEntries: MemoryEntry[] = [];
    const preferences: { [key: string]: string } = {};
    const relationships: { [personName: string]: string } = {};

    // Load persona names for relationship matching
    const allPersonas = await getAllPersonas();
    const personaNames = new Set(allPersonas.map(p => p.name.toLowerCase()));

    // Aggregate entries from all users
    for (const agentMemory of agentMemories) {
      for (const entry of agentMemory.entries) {
        // Map agent memory categories to structured memory categories
        let category: MemoryEntry['category'];
        switch (entry.category) {
          case 'preferences':
            category = 'preference';
            // Add to preferences map
            if (entry.keywords && entry.keywords.length > 0) {
              preferences[entry.keywords[0]] = entry.content;
            }
            break;
          case 'instructions':
            category = 'instruction';
            break;
          case 'context':
            category = 'context';
            break;
          case 'relationships':
            category = 'relationship';
            // Match against known persona names in the content
            const contentLower = entry.content.toLowerCase();
            for (const name of personaNames) {
              if (contentLower.includes(name)) {
                relationships[name] = entry.content;
                break;
              }
            }
            break;
          default:
            category = 'context';
        }

        // Map importance from number to high/medium/low
        let importance: 'high' | 'medium' | 'low';
        if (entry.importance >= 8) {
          importance = 'high';
        } else if (entry.importance >= 5) {
          importance = 'medium';
        } else {
          importance = 'low';
        }

        // Create structured memory entry
        const structuredEntry: MemoryEntry = {
          id: entry.id,
          category,
          content: entry.content,
          source: entry.source || 'agent-chat',
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          tags: entry.keywords || [],
          importance
        };

        allEntries.push(structuredEntry);
      }
    }

    // Sort entries by importance and date
    allEntries.sort((a, b) => {
      const importanceOrder = { high: 0, medium: 1, low: 2 };
      const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
      if (impDiff !== 0) return impDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Create structured memory response
    const structuredMemory: StructuredMemory = {
      version: 2,
      personaId: req.params.id,
      entries: allEntries,
      preferences,
      relationships,
      lastUpdated: new Date().toISOString()
    };

    res.json(structuredMemory);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memories error:`, error);
    res.status(500).json({ error: 'Failed to fetch persona memories' });
  }
});

// POST /api/personas/:id/memories - Add a memory entry (via unified agent-memory)
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

    // Map structured memory categories to agent-memory categories
    const categoryMap: Record<string, AgentMemoryEntry['category']> = {
      preference: 'preferences',
      instruction: 'instructions',
      context: 'context',
      relationship: 'relationships',
      learning: 'learning',
      reflection: 'reflection',
    };
    const importanceMap: Record<string, number> = { high: 9, medium: 6, low: 3 };

    const entry = await addMemoryEntry(req.params.id, source || 'default', {
      category: categoryMap[category] || 'context',
      content,
      keywords: tags || [],
      source: 'explicit',
      importance: importanceMap[importance || 'medium'] || 6,
    });
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

// GET /api/personas/:id/memories/search - Search memories (via unified agent-memory)
app.get('/api/personas/:id/memories/search', async (req, res) => {
  try {
    const { q, category, limit } = req.query;

    // Search across all user memory files for this persona
    const allMemories = await getAllPersonaMemories(req.params.id);
    const allResults: AgentMemoryEntry[] = [];

    for (const memory of allMemories) {
      const results = await searchMemories(req.params.id, memory.userId, q as string || '', {
        category: category as AgentMemoryEntry['category'],
        limit: limit ? parseInt(limit as string) : undefined,
      });
      allResults.push(...results);
    }

    // Deduplicate by id and sort by importance
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    uniqueResults.sort((a, b) => b.importance - a.importance);
    const finalResults = uniqueResults.slice(0, limit ? parseInt(limit as string) : 10);

    res.json({ results: finalResults });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/memories/search error:`, error);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

// DELETE /api/personas/:id/memories/:entryId - Delete a memory entry
app.delete('/api/personas/:id/memories/:entryId', async (req, res) => {
  try {
    // Get all agent memories for this persona to find which user has this entry
    const agentMemories = await getAllPersonaMemories(req.params.id);

    let found = false;
    for (const agentMemory of agentMemories) {
      const hasEntry = agentMemory.entries.some(e => e.id === req.params.entryId);
      if (hasEntry) {
        // Found the user who has this entry — pass pre-loaded memory to avoid double read
        const success = await deleteMemoryEntry(req.params.id, agentMemory.userId, req.params.entryId, agentMemory);
        if (success) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Memory entry not found' });
    }

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

// Soul API routes (old persona-memory routes removed — agent-soul routes below handle this)

// Mood API routes
import { calculatePersonaMood, getAllMoodTypes } from './persona-mood.js';

// Auto-tagging
import { autoApplyTags, analyzeTaskTags, getAllAutoTags } from './auto-tagger.js';

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
    const limit = clampInt(req.query.limit as string, 10, 1, 100);
    
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

// Session management API routes

// GET /api/personas/:id/session - Get session info and stats
app.get('/api/personas/:id/session', async (req, res) => {
  try {
    const sessionId = await getOrCreateSession(req.params.id);
    const stats = await getSessionStats(sessionId);
    res.json({ sessionId, ...stats });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/session error:`, error);
    res.status(500).json({ error: 'Failed to get session info' });
  }
});

// POST /api/personas/:id/session/reset - Reset session (clear all messages)
app.post('/api/personas/:id/session/reset', async (req, res) => {
  try {
    const sessionId = await getOrCreateSession(req.params.id);
    await resetSession(sessionId);
    res.json({ success: true, message: 'Session reset successfully' });
  } catch (error) {
    console.error(`POST /api/personas/${req.params.id}/session/reset error:`, error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// GET /api/personas/:id/session/messages - Get session message history
app.get('/api/personas/:id/session/messages', async (req, res) => {
  try {
    const sessionId = await getOrCreateSession(req.params.id);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const messages = await getSessionHistory(sessionId, limit);
    res.json({ messages });
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/session/messages error:`, error);
    res.status(500).json({ error: 'Failed to get session messages' });
  }
});

// Budget status API route
app.get('/api/personas/:id/budget-status', async (req, res) => {
  try {
    const { getPersonaBudgetStatus } = await import('./collaboration-budget.js');
    const status = await getPersonaBudgetStatus(req.params.id);
    if (!status) {
      return res.json({ tokensUsed: 0, tokenLimit: 0, percentage: 0, paused: false, month: '' });
    }
    res.json(status);
  } catch (error) {
    console.error(`GET /api/personas/${req.params.id}/budget-status error:`, error);
    res.status(500).json({ error: 'Failed to get budget status' });
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
    const limit = clampInt(req.query.limit as string, 50, 1, 500);
    const before = req.query.before as string;
    
    const messages = await getMessages(channelId, limit, before);
    res.json({ messages });
  } catch (error) {
    console.error(`GET /api/chat/${req.params.channelId}/messages error:`, error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/chat/:channelId/state - Get channel state (speakingPersona, etc.)
app.get('/api/chat/:channelId/state', async (req, res) => {
  try {
    const chId = req.params.channelId;
    const channel = await getChannel(chId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json({
      speakingPersona: channel.speakingPersona,
      speakingSince: channel.speakingSince,
      lastActivity: channel.lastActivity,
    });
  } catch (error) {
    console.error('GET /api/chat/' + req.params.channelId + '/state error:', error);
    res.status(500).json({ error: 'Failed to fetch channel state' });
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

// GET /api/chat/:channelId/stream - Stream persona response via SSE
app.get('/api/chat/:channelId/stream', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { messageId, personaId } = req.query;

    if (!messageId || typeof messageId !== 'string') {
      return res.status(400).json({ error: 'messageId query parameter is required' });
    }

    if (!personaId || typeof personaId !== 'string') {
      return res.status(400).json({ error: 'personaId query parameter is required' });
    }

    // Initialize SSE connection
    initSSE(res);

    // Get the channel and recent messages
    const channel = await getChannel(channelId);
    if (!channel) {
      sendSSE(res, { event: 'error', data: { error: 'Channel not found' } });
      res.end();
      return;
    }

    const messages = await getMessages(channelId, 15);
    const triggerMessage = messages.find(m => m.id === messageId);
    
    if (!triggerMessage) {
      sendSSE(res, { event: 'error', data: { error: 'Message not found' } });
      res.end();
      return;
    }

    // Get the persona
    const persona = await getPersona(personaId);
    if (!persona) {
      sendSSE(res, { event: 'error', data: { error: 'Persona not found' } });
      res.end();
      return;
    }

    // Send thinking event immediately
    sendSSE(res, { event: 'thinking', data: {} });

    // Handle client disconnect
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
      console.log(`SSE client disconnected from ${channelId}`);
    });

    // FIX: Instead of regenerating, wait for the response from processChatMention
    // which should already be running (or will be triggered by the message)
    try {
      // First, check if a response already exists (processChatMention may have already completed)
      let responseMessages = messages.filter(
        m => m.replyTo === messageId && m.authorType === 'persona'
      );

      // Poll for response if not found (wait for processChatMention to complete)
      const maxWaitMs = 60000; // 60 second max wait
      const pollIntervalMs = 500;
      let waitedMs = 0;

      while (responseMessages.length === 0 && waitedMs < maxWaitMs && !clientDisconnected) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waitedMs += pollIntervalMs;
        
        // Re-fetch messages to check for new response
        const updatedMessages = await getMessages(channelId, 15);
        responseMessages = updatedMessages.filter(
          m => m.replyTo === messageId && m.authorType === 'persona'
        );
      }

      if (clientDisconnected) {
        res.end();
        return;
      }

      if (responseMessages.length > 0) {
        // Found existing response - stream it
        const responseMessage = responseMessages[0];
        
        // Stream the content in chunks
        const content = responseMessage.content;
        const chunkSize = 20;
        for (let i = 0; i < content.length && !clientDisconnected; i += chunkSize) {
          const chunk = content.substring(i, Math.min(i + chunkSize, content.length));
          sendSSE(res, { event: 'token', data: { text: chunk } });
          // Small delay to simulate streaming feel
          await new Promise(resolve => setTimeout(resolve, 30));
        }

        if (!clientDisconnected) {
          sendSSE(res, {
            event: 'done',
            data: {
              messageId: responseMessage.id,
              fullText: content
            }
          });
        }
      } else {
        // No response found after polling - this shouldn't happen if processChatMention is working
        console.warn(`No persona response found for message ${messageId} after ${waitedMs}ms`);
        sendSSE(res, {
          event: 'error',
          data: { error: 'Persona response not found (may have failed to generate)' }
        });
      }
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      if (!clientDisconnected) {
        sendSSE(res, {
          event: 'error',
          data: { error: 'Failed to stream response' }
        });
      }
    }

    res.end();
  } catch (error) {
    console.error(`GET /api/chat/${req.params.channelId}/stream error:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream response' });
    } else {
      sendSSE(res, { event: 'error', data: { error: 'Internal server error' } });
      res.end();
    }
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
    // Optional: pass specific PR numbers to avoid fetching all
    const prNumbersParam = req.query.prNumbers as string | undefined;
    const prNumbers = prNumbersParam ? prNumbersParam.split(',').map(n => parseInt(n, 10)).filter(n => !isNaN(n)) : undefined;
    
    const prs = await getRepoPRs(repo, state, prNumbers);
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
    const task = await getTask(taskId);
    const githubData = await getTaskGitHubData(taskId, task?.links);
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

// GET /api/pipeline-states - Get all pipeline states
app.get('/api/pipeline-states', async (_req, res) => {
  try {
    const states = await getAllTaskPipelineStates();
    res.json({ states });
  } catch (error) {
    console.error('GET /api/pipeline-states error:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline states' });
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

// DELETE /api/tasks/:taskId/pipeline-state - Delete pipeline state for a task
app.delete('/api/tasks/:taskId/pipeline-state', async (req, res) => {
  try {
    await deleteTaskPipelineState(req.params.taskId);
    res.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/tasks/${req.params.taskId}/pipeline-state error:`, error);
    res.status(500).json({ error: 'Failed to delete pipeline state' });
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

// POST /api/tasks/:id/assign-pipeline - Assign a pipeline to a task and initialize state
app.post('/api/tasks/:id/assign-pipeline', async (req, res) => {
  try {
    const { id: taskId } = req.params;
    const { pipelineId } = req.body;
    
    if (!pipelineId) {
      return res.status(400).json({ error: 'pipelineId is required' });
    }
    
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    if (pipeline.stages.length === 0) {
      return res.status(400).json({ error: 'Pipeline has no stages' });
    }
    
    // First check if task exists and update with pipelineId
    const updatedTask = await updateTask(taskId, { pipelineId }, 'system');
    if (!updatedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Then create the pipeline state at the first stage
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
    
    res.json({ task: updatedTask, pipelineState });
  } catch (error) {
    console.error(`POST /api/tasks/${req.params.id}/assign-pipeline error:`, error);
    res.status(500).json({ error: 'Failed to assign pipeline' });
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

// PUT /api/settings/backup-dir - Set and validate custom backup directory
app.put('/api/settings/backup-dir', async (req, res) => {
  try {
    const { backupDir } = req.body;

    if (backupDir !== undefined && typeof backupDir !== 'string') {
      return res.status(400).json({ error: 'backupDir must be a string or null/undefined to reset' });
    }

    const settings = await getUserSettings();

    if (!backupDir) {
      // Clear the setting — revert to default
      delete settings.backupDir;
      await saveUserSettings(settings);
      return res.json({ backupDir: null, resolved: null, message: 'Reset to default backup directory' });
    }

    const resolved = resolveBackupDir(backupDir);

    // Validate by attempting to create + write-test
    const { getBackupStorageDir } = await import('./backup.js');
    settings.backupDir = backupDir;
    await saveUserSettings(settings);

    try {
      await getBackupStorageDir(); // Will throw if not writable
      res.json({ backupDir, resolved, message: 'Backup directory set and verified' });
    } catch (err) {
      // Revert the setting if validation fails
      delete settings.backupDir;
      await saveUserSettings(settings);
      return res.status(400).json({ error: (err as Error).message });
    }
  } catch (error) {
    console.error('PUT /api/settings/backup-dir error:', error);
    res.status(500).json({ error: 'Failed to update backup directory' });
  }
});

// Backup API routes

// GET /api/backup/status - Get backup status
app.get('/api/backup/status', async (_req, res) => {
  try {
    const status = await getBackupStatus();
    res.json({ status });
  } catch (error) {
    console.error('GET /api/backup/status error:', error);
    res.status(500).json({ error: 'Failed to fetch backup status' });
  }
});

// POST /api/backup/schedule - Update backup schedule
app.post('/api/backup/schedule', async (req, res) => {
  try {
    const updates = req.body;
    const schedule = await updateBackupSchedule(updates);
    res.json({ schedule });
  } catch (error) {
    console.error('POST /api/backup/schedule error:', error);
    res.status(500).json({ error: 'Failed to update backup schedule' });
  }
});

// POST /api/backup/trigger - Manually trigger a backup
app.post('/api/backup/trigger', async (_req, res) => {
  try {
    const result = await runBackup();
    res.json(result);
  } catch (error) {
    console.error('POST /api/backup/trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger backup' });
  }
});

// POST /api/backup/toggle - Enable/disable backup scheduler
app.post('/api/backup/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const schedule = await updateBackupSchedule({ enabled });

    // Start/stop the scheduler immediately so the change takes effect without restart
    if (enabled) {
      await startBackupScheduler();
    } else {
      stopBackupScheduler();
    }

    res.json({ schedule });
  } catch (error) {
    console.error('POST /api/backup/toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle backup' });
  }
});

// GET /api/backup/categories - Get backup category settings
app.get('/api/backup/categories', async (_req, res) => {
  try {
    const categories = await getBackupCategories();
    res.json({ categories });
  } catch (error) {
    console.error('GET /api/backup/categories error:', error);
    res.status(500).json({ error: 'Failed to fetch backup categories' });
  }
});

// POST /api/backup/categories - Update backup category settings
app.post('/api/backup/categories', async (req, res) => {
  try {
    const { categories } = req.body;

    if (!categories || typeof categories !== 'object') {
      return res.status(400).json({ error: 'categories must be an object' });
    }

    const updatedCategories = await updateBackupCategories(categories);
    res.json({ categories: updatedCategories });
  } catch (error) {
    console.error('POST /api/backup/categories error:', error);
    res.status(500).json({ error: 'Failed to update backup categories' });
  }
});

// Helper: resolve effective backup dir (param > settings > default ~/.tix-kanban)
async function resolveEffectiveBackupDir(requested?: string): Promise<string> {
  // Always delegate to getBackupStorageDir so the directory is auto-created
  if (requested) {
    const fsModule = await import('fs/promises');
    await fsModule.mkdir(requested, { recursive: true });
    return requested;
  }
  const { getBackupStorageDir } = await import('./backup.js');
  return getBackupStorageDir();
}

// POST /api/backup/file - Create a file-based backup (optionally encrypted)
// outputDir defaults to configured backupDir or ~/.tix-kanban
app.post('/api/backup/file', async (req, res) => {
  try {
    const { outputDir, password, categories } = req.body;
    const effectiveOutputDir = await resolveEffectiveBackupDir(outputDir);

    const result = await createFileBackup({
      outputDir: effectiveOutputDir,
      password: password || undefined,
      categories,
    });

    res.json({
      success: true,
      backupPath: result.backupPath,
      metadataPath: result.metadataPath,
      encrypted: result.encrypted,
      outputDir: effectiveOutputDir,
    });
  } catch (error: any) {
    console.error('POST /api/backup/file error:', error);
    res.status(500).json({ error: error.message || 'Failed to create backup' });
  }
});

// POST /api/backup/restore - Restore from a file-based backup
// backupDir defaults to configured backupDir or ~/.tix-kanban
app.post('/api/backup/restore', async (req, res) => {
  try {
    const { backupDir, password, targetDir } = req.body;
    const effectiveBackupDir = await resolveEffectiveBackupDir(backupDir);

    const result = await restoreFileBackup({
      backupDir: effectiveBackupDir,
      password: password || undefined,
      targetDir: targetDir || undefined,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.message, encrypted: result.wasEncrypted });
    }

    res.json({
      success: true,
      message: result.message,
      wasEncrypted: result.wasEncrypted,
      restoredFrom: effectiveBackupDir,
    });
  } catch (error: any) {
    console.error('POST /api/backup/restore error:', error);
    res.status(500).json({ error: error.message || 'Failed to restore backup' });
  }
});

// GET /api/backup/files - List available file backups
// backupDir defaults to configured backupDir or ~/.tix-kanban
app.get('/api/backup/files', async (req, res) => {
  try {
    const { backupDir } = req.query;
    const effectiveBackupDir = await resolveEffectiveBackupDir(
      typeof backupDir === 'string' ? backupDir : undefined
    );

    const backups = await listBackups(effectiveBackupDir);
    res.json({ backups, backupDir: effectiveBackupDir });
  } catch (error: any) {
    console.error('GET /api/backup/files error:', error);
    res.status(500).json({ error: error.message || 'Failed to list backups' });
  }
});

// Provider API routes

// GET /api/providers - List available providers and active config
app.get('/api/providers', async (_req, res) => {
  try {
    const available = listProviders();
    const config = await loadProviderConfig();
    res.json({ available, config });
  } catch (error) {
    console.error('GET /api/providers error:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
});

// PUT /api/providers/config - Update active providers
app.put('/api/providers/config', async (req, res) => {
  try {
    const { ticketProvider, messageProvider } = req.body as Partial<ProviderConfig>;

    const errors: string[] = [];
    if (ticketProvider && !setTicketProvider(ticketProvider)) {
      errors.push(`Unknown ticket provider: "${ticketProvider}"`);
    }
    if (messageProvider && !setMessageProvider(messageProvider)) {
      errors.push(`Unknown message provider: "${messageProvider}"`);
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    // Persist to disk
    const configPath = path.join(os.homedir(), '.tix-kanban', 'providers.json');
    const existing = await loadProviderConfig() || {};
    const updated: ProviderConfig = {
      ...existing,
      ...(ticketProvider ? { ticketProvider } : {}),
      ...(messageProvider ? { messageProvider } : {}),
    };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(updated, null, 2), 'utf8');

    res.json({ config: updated });
  } catch (error) {
    console.error('PUT /api/providers/config error:', error);
    res.status(500).json({ error: 'Failed to update provider config' });
  }
});

// POST /api/providers/sync - Manually trigger a provider sync
app.post('/api/providers/sync', async (_req, res) => {
  try {
    const ticketProvider = getTicketProvider();
    const messageProvider = getMessageProvider();

    const results: Record<string, any> = {};
    if (ticketProvider) {
      const tickets = await ticketProvider.sync();
      results.tickets = { provider: ticketProvider.name, count: tickets.length };
    }
    if (messageProvider) {
      const messages = await messageProvider.sync();
      results.messages = { provider: messageProvider.name, count: messages.length };
    }
    res.json({ results });
  } catch (error: any) {
    console.error('POST /api/providers/sync error:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
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
    const hours = clampInt(req.query.hours as string, 24, 1, 168);
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
    const days = clampInt(req.query.days as string, 7, 1, 90);
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

// POST /api/daily-summary/generate - Generate daily summary for a date (defaults to today)
app.post('/api/daily-summary/generate', async (req, res) => {
  try {
    const { date } = req.body as { date?: string };
    const summary = await generateDailySummary(date);
    res.json({ summary, date: date || new Date().toISOString().split('T')[0] });
  } catch (error) {
    console.error('POST /api/daily-summary/generate error:', error);
    res.status(500).json({ error: 'Failed to generate daily summary' });
  }
});

// GET /api/daily-summary/:date - Get daily summary for a specific date
app.get('/api/daily-summary/:date', async (req, res) => {
  try {
    const { date } = req.params;
    
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    const summary = await readSummary(date);
    if (!summary) {
      return res.status(404).json({ error: `No summary found for ${date}` });
    }
    
    res.json({ summary, date });
  } catch (error) {
    console.error(`GET /api/daily-summary/${req.params.date} error:`, error);
    res.status(500).json({ error: 'Failed to fetch daily summary' });
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
// Notion API endpoints removed - use CLI-based providers instead
// The tix provider now shells out to `tix list --json` which handles Notion sync
// Use /api/providers/sync endpoint for provider-based synchronization
// See documentation/providers.md for migration guide

// Daily Notes API routes
const DAILY_NOTES_DIR = path.join(process.env.HOME || '/root', '.tix', 'notes');
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
    const days = clampInt(req.query.days as string, 7, 1, 90);
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
    const days = clampInt(req.query.days as string, 7, 1, 90);
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

// Slack (slx) API routes

// Auto-sync scheduler
let slxSyncInterval: NodeJS.Timeout | null = null;

async function startSlxAutoSync() {
  if (slxSyncInterval) clearInterval(slxSyncInterval);
  
  const config = await getSlxConfig();
  if (!config?.sync?.autoSyncEnabled) return;
  
  const intervalMs = (config.sync.autoSyncIntervalHours || 1) * 3600000;
  
  slxSyncInterval = setInterval(async () => {
    console.log('[slx] Running auto-sync...');
    const result = await runSlxSync();
    if (result.success) {
      console.log('[slx] Auto-sync complete');
      try {
        console.log('[slx] Running digest...');
        await runSlxDigest();
        console.log('[slx] Digest complete');
      } catch (digestErr) {
        console.error('[slx] Digest failed:', digestErr);
      }
    } else {
      console.error('[slx] Auto-sync failed:', result.error);
    }
  }, intervalMs);
  
  console.log(`[slx] Auto-sync enabled (every ${config.sync.autoSyncIntervalHours}h)`);
}

// GET /api/slx/config - Get slx config
app.get('/api/slx/config', async (_req, res) => {
  try {
    const config = await getSlxConfig();
    res.json(config || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/slx/config - Update slx config
app.put('/api/slx/config', async (req, res) => {
  try {
    await saveSlxConfig(req.body);
    await startSlxAutoSync(); // Restart scheduler with new config
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/slx/sync - Trigger sync
app.post('/api/slx/sync', async (req, res) => {
  try {
    const { hours } = req.body;
    const result = await runSlxSync(hours);
    if (result.success) {
      try {
        console.log('[slx] Running digest after manual sync...');
        await runSlxDigest();
        console.log('[slx] Digest complete');
      } catch (digestErr) {
        console.error('[slx] Digest failed:', digestErr);
      }
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/slx/data - Get Slack data
app.get('/api/slx/data', async (_req, res) => {
  try {
    const data = await getSlackData();
    res.json(data || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/slx/digest - Get digest
app.post('/api/slx/digest', async (req, res) => {
  try {
    const { focus } = req.body;
    const digest = await runSlxDigest(focus);
    res.json({ digest });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/slx/status - Get sync status
app.get('/api/slx/status', async (_req, res) => {
  try {
    const status = await getSlxStatus();
    res.json(status || {});
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Test Suite Links (apix acceptance criteria) ====================

// Link a test suite to a task
app.post('/api/tasks/:taskId/test-suites', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { path: suitePath, repo } = req.body;

    if (!suitePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    // Do read-modify-write inside lock to prevent concurrent requests from losing data
    const result = await withTaskLock(taskId, async () => {
      const task = await getTask(taskId);
      if (!task) {
        return { status: 404, error: 'Task not found' };
      }

      const suiteRepo = repo || task.repo || 'apix';
      const suiteLink = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Add random component to prevent collisions
        path: suitePath,
        repo: suiteRepo,
        addedAt: new Date(),
        addedBy: 'cli',
      };

      const existingSuites = task.testSuites || [];

      // Don't add duplicate path+repo combinations (include repo in duplicate check)
      if (existingSuites.some((s: any) => s.path === suitePath && s.repo === suiteRepo)) {
        return {
          status: 409,
          error: 'Test suite already linked',
          existing: existingSuites.find((s: any) => s.path === suitePath && s.repo === suiteRepo)
        };
      }

      const updatedSuites = [...existingSuites, suiteLink];
      const updatedTask = {
        ...task,
        testSuites: updatedSuites,
        testStatus: task.testStatus || { overall: 'not-run' },
        updatedAt: new Date()
      };
      await writeTask(updatedTask);

      return { status: 200, message: 'Test suite linked', suite: suiteLink };
    });

    if (result.status === 200) {
      res.json({ message: result.message, suite: result.suite });
    } else {
      res.status(result.status).json({ error: result.error, existing: result.existing });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List test suites for a task
app.get('/api/tasks/:taskId/test-suites', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({
      testSuites: task.testSuites || [],
      testStatus: task.testStatus || { overall: 'not-run' },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Unlink a test suite from a task
app.delete('/api/tasks/:taskId/test-suites/:suiteId', async (req, res) => {
  try {
    const { taskId, suiteId } = req.params;
    
    // Wrap entire read-modify-write in lock to prevent TOCTOU races
    const result = await withTaskLock(taskId, async () => {
      const task = await getTask(taskId);
      if (!task) {
        return { status: 404, error: 'Task not found' };
      }

      const existingSuites = task.testSuites || [];
      const filtered = existingSuites.filter((s: any) => s.id !== suiteId);

      if (filtered.length === existingSuites.length) {
        return { status: 404, error: 'Test suite link not found' };
      }

      // Recalculate test status based on remaining suites
      let testStatus;
      if (filtered.length === 0) {
        testStatus = { overall: 'not-run' as const };
      } else if (task.testStatus && task.testStatus.results) {
        // Filter out results from the removed suite
        const remainingSuiteIds = new Set(filtered.map((s: any) => s.id));
        const remainingResults = task.testStatus.results.filter((r: any) => remainingSuiteIds.has(r.suiteId));
        
        if (remainingResults.length === 0) {
          testStatus = { overall: 'not-run' as const };
        } else {
          // Recalculate overall status from remaining results
          const hasErrors = remainingResults.some((r: any) => r.errors > 0);
          const hasFailures = remainingResults.some((r: any) => r.failed > 0);
          const overall = hasErrors ? 'error' : hasFailures ? 'failing' : 'passing';
          testStatus = {
            overall: overall as 'passing' | 'failing' | 'error',
            lastRun: task.testStatus.lastRun,
            results: remainingResults,
          };
        }
      } else {
        testStatus = { overall: 'not-run' as const };
      }

      const updatedTask = {
        ...task,
        testSuites: filtered,
        testStatus,
        updatedAt: new Date()
      };
      await writeTask(updatedTask);
      return { status: 200, message: 'Test suite unlinked' };
    });

    if (result.status === 200) {
      res.json({ message: result.message });
    } else {
      res.status(result.status).json({ error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update test results for a task (called by CI/apix runner)
app.post('/api/tasks/:taskId/test-results', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { results } = req.body; // Array of TestSuiteResult

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'results array is required' });
    }

    // Empty results array should not be treated as "passing" (reject empty arrays)
    if (results.length === 0) {
      return res.status(400).json({ error: 'results array cannot be empty' });
    }

    // Do read-modify-write inside lock to prevent concurrent updates
    const result = await withTaskLock(taskId, async () => {
      // Read status inside lock to avoid stale read causing wrong auto-transition
      const task = await getTask(taskId);
      if (!task) {
        return { status: 404, error: 'Task not found' };
      }

      // Determine overall status
      const hasFailures = results.some((r: any) => r.failed > 0);
      const hasErrors = results.some((r: any) => r.errors > 0);
      const overall = hasErrors ? 'error' : hasFailures ? 'failing' : 'passing';

      const testStatus = {
        overall: overall as 'passing' | 'failing' | 'error',
        lastRun: new Date().toISOString(),
        results,
      };

      // Auto-transition: if all pass and task is in review, move to done
      let statusChanged = false;
      let newStatus = task.status;
      if (overall === 'passing' && task.status === 'review') {
        newStatus = 'done';
        statusChanged = true;
      }
      // If failing and task is in done, move back to review
      if ((overall === 'failing' || overall === 'error') && task.status === 'done') {
        newStatus = 'review';
        statusChanged = true;
      }

      // Build activity log entries for status changes (avoid updateTask which re-locks)
      const existingActivity = task.activity || [];
      const newActivity = [...existingActivity];
      if (statusChanged) {
        newActivity.push({
          id: Math.random().toString(36).substr(2, 9),
          taskId,
          type: 'status_change' as const,
          description: `Status changed from '${task.status}' to '${newStatus}'`,
          actor: 'acceptance-tests',
          timestamp: new Date(),
          metadata: { from: task.status, to: newStatus }
        });
      }

      // Write directly to avoid nested withTaskLock deadlock (we already hold the lock)
      await writeTask({
        ...task,
        testStatus,
        status: newStatus,
        activity: newActivity.slice(-100),
        updatedAt: new Date(),
      });

      // Update summary cache when status changes
      if (statusChanged) {
        const allTasks = await getAllTasks();
        await updateSummary(allTasks);
      }

      return { status: 200, message: 'Test results updated', testStatus, statusChanged };
    });

    if (result.status === 200) {
      res.json({ message: result.message, testStatus: result.testStatus, statusChanged: result.statusChanged });
    } else {
      res.status(result.status).json({ error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// Conversation API (Phase 2)
// ========================================

// POST /api/conversation/:taskId/start - Start multi-persona conversation
app.post('/api/conversation/:taskId/start', startConversationHandler);

// POST /api/conversation/:taskId/pause - Pause conversation (kill switch)
app.post('/api/conversation/:taskId/pause', pauseConversationHandler);

// POST /api/conversation/:taskId/resume - Resume paused conversation
app.post('/api/conversation/:taskId/resume', resumeConversationHandler);

// GET /api/conversation/budget - Get global budget status
app.get('/api/conversation/budget', getBudgetStatusHandler);

// GET /api/conversation/:taskId - Get conversation state
app.get('/api/conversation/:taskId', getConversationStateHandler);

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

import { initializeBudgetStorage } from './collaboration-budget.js';
import { initializeAuditStorage } from './collaboration-audit.js';
import { initializeControlStorage } from './collaboration-control.js';

// Initialize storage and start server
async function startServer() {
  try {
    await initializeStorage();
    await initializeBudgetStorage();
    await initializeAuditStorage();
    await initializeControlStorage();
    await initializePersonas();
    await initializePipelines();
    await initializeChatStorage();
    await initializeBudgetStorage();
    await initializeAuditStorage();
    await initializeControlStorage();
    // Run archive maintenance on startup to trim old chat messages
    runArchiveMaintenance().catch(err => console.error('Archive maintenance failed:', err));
    await initializeReportsStorage();
    await initializeKnowledgeStorage();
    await initializeStandupStorage();
    await startWorker();
    await startPRResolver();
    startPRCacheAutoRefresh();
    await startSlxAutoSync();
    await startBackupScheduler();
    await initializeProviders();
    
    // Start conversation monitor (Phase 2)
    setInterval(() => {
      runConversationMonitor().catch(err => console.error('Conversation monitor error:', err));
    }, 30000); // Every 30 seconds

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
