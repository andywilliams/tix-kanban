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

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Initialize storage and start server
async function startServer() {
  try {
    await initializeStorage();
    
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