import express from 'express'
import { taskStorage } from '../../storage/tasks.js'
import { personaSystem } from '../../storage/personas.js'
import { cronSystem } from '../../cron/index.js'

export const apiRouter = express.Router()

// Tasks API
apiRouter.get('/tasks', async (req, res) => {
  try {
    const { status, assignee } = req.query
    const tasks = await taskStorage.list({
      status: status as string,
      assignee: assignee as string
    })
    res.json({ tasks })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

apiRouter.get('/tasks/:id', async (req, res) => {
  try {
    const task = await taskStorage.get(req.params.id)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }
    res.json({ task })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task' })
  }
})

apiRouter.post('/tasks', async (req, res) => {
  try {
    const task = await taskStorage.create(req.body)
    res.status(201).json({ task })
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' })
  }
})

apiRouter.put('/tasks/:id', async (req, res) => {
  try {
    const task = await taskStorage.update(req.params.id, req.body)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }
    res.json({ task })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update task' })
  }
})

apiRouter.delete('/tasks/:id', async (req, res) => {
  try {
    await taskStorage.delete(req.params.id)
    res.status(204).send()
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

apiRouter.post('/tasks/:id/comments', async (req, res) => {
  try {
    const task = await taskStorage.addComment(req.params.id, req.body.text)
    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }
    res.json({ task })
  } catch (error) {
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// Board overview
apiRouter.get('/board', async (req, res) => {
  try {
    const summary = await taskStorage.getBoardSummary()
    res.json(summary)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch board summary' })
  }
})

// Personas API
apiRouter.get('/personas', async (req, res) => {
  try {
    const personas = await personaSystem.list()
    res.json({ personas })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch personas' })
  }
})

// Cron management API
apiRouter.get('/cron', (req, res) => {
  const status = cronSystem.getStatus()
  res.json(status)
})

apiRouter.post('/cron/trigger', (req, res) => {
  cronSystem.triggerWorker()
  res.json({ message: 'Worker triggered manually' })
})

apiRouter.put('/cron/settings', (req, res) => {
  const { enabled, interval } = req.body
  cronSystem.updateSettings({ enabled, interval })
  res.json({ message: 'Settings updated' })
})