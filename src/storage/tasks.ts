import fs from 'fs-extra'
import path from 'path'
import { randomBytes } from 'crypto'
import os from 'os'

export interface Task {
  taskId: string
  title: string
  description: string
  status: 'backlog' | 'in-progress' | 'review' | 'done'
  priority: number
  assignee?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  comments: Comment[]
  links: Link[]
}

export interface Comment {
  id: string
  text: string
  author: string
  createdAt: string
}

export interface Link {
  id: string
  url: string
  title: string
  type: 'pr' | 'issue' | 'doc' | 'other'
  createdAt: string
}

export interface TaskSummary {
  taskId: string
  title: string
  status: string
  priority: number
  assignee?: string
  tags: string[]
  updatedAt: string
  commentCount: number
  linkCount: number
}

class TaskStorage {
  private dataDir: string

  constructor() {
    this.dataDir = path.join(os.homedir(), '.tix-kanban', 'tasks')
    fs.ensureDirSync(this.dataDir)
  }

  private getSummaryPath(): string {
    return path.join(this.dataDir, '_summary.json')
  }

  private getTaskPath(taskId: string): string {
    return path.join(this.dataDir, `${taskId}.json`)
  }

  private generateId(): string {
    return randomBytes(8).toString('hex').toUpperCase()
  }

  private async updateSummary(): Promise<void> {
    const files = await fs.readdir(this.dataDir)
    const taskFiles = files.filter(f => f.endsWith('.json') && f !== '_summary.json')
    
    const summaries: TaskSummary[] = []
    
    for (const file of taskFiles) {
      try {
        const task: Task = await fs.readJson(path.join(this.dataDir, file))
        summaries.push({
          taskId: task.taskId,
          title: task.title,
          status: task.status,
          priority: task.priority,
          assignee: task.assignee,
          tags: task.tags,
          updatedAt: task.updatedAt,
          commentCount: task.comments.length,
          linkCount: task.links.length
        })
      } catch (error) {
        console.error(`Failed to read task file ${file}:`, error)
      }
    }

    // Sort by priority (highest first), then by updatedAt
    summaries.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    const summaryPath = this.getSummaryPath()
    const tempPath = `${summaryPath}.tmp`
    
    await fs.writeJson(tempPath, { tasks: summaries }, { spaces: 2 })
    await fs.move(tempPath, summaryPath)
  }

  async list(filters: { status?: string; assignee?: string } = {}): Promise<TaskSummary[]> {
    try {
      const summaryData = await fs.readJson(this.getSummaryPath())
      let tasks = summaryData.tasks || []
      
      if (filters.status) {
        tasks = tasks.filter((t: TaskSummary) => t.status === filters.status)
      }
      
      if (filters.assignee) {
        tasks = tasks.filter((t: TaskSummary) => t.assignee === filters.assignee)
      }
      
      return tasks
    } catch (error) {
      // If summary doesn't exist, rebuild it
      await this.updateSummary()
      return this.list(filters)
    }
  }

  async get(taskId: string): Promise<Task | null> {
    try {
      const task = await fs.readJson(this.getTaskPath(taskId))
      return task
    } catch (error) {
      return null
    }
  }

  async create(data: Partial<Task>): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      taskId: this.generateId(),
      title: data.title || '',
      description: data.description || '',
      status: data.status || 'backlog',
      priority: data.priority || 100,
      assignee: data.assignee,
      tags: data.tags || [],
      createdAt: now,
      updatedAt: now,
      comments: [],
      links: []
    }

    const taskPath = this.getTaskPath(task.taskId)
    const tempPath = `${taskPath}.tmp`
    
    await fs.writeJson(tempPath, task, { spaces: 2 })
    await fs.move(tempPath, taskPath)
    await this.updateSummary()
    
    return task
  }

  async update(taskId: string, data: Partial<Task>): Promise<Task | null> {
    const existing = await this.get(taskId)
    if (!existing) return null

    const updated: Task = {
      ...existing,
      ...data,
      taskId: existing.taskId, // Don't allow ID changes
      createdAt: existing.createdAt, // Don't allow created time changes
      updatedAt: new Date().toISOString()
    }

    const taskPath = this.getTaskPath(taskId)
    const tempPath = `${taskPath}.tmp`
    
    await fs.writeJson(tempPath, updated, { spaces: 2 })
    await fs.move(tempPath, taskPath)
    await this.updateSummary()
    
    return updated
  }

  async delete(taskId: string): Promise<void> {
    const taskPath = this.getTaskPath(taskId)
    await fs.remove(taskPath)
    await this.updateSummary()
  }

  async addComment(taskId: string, text: string): Promise<Task | null> {
    const task = await this.get(taskId)
    if (!task) return null

    const comment: Comment = {
      id: this.generateId(),
      text,
      author: 'system', // TODO: Add proper user system
      createdAt: new Date().toISOString()
    }

    task.comments.push(comment)
    return this.update(taskId, task)
  }

  async getBoardSummary(): Promise<Record<string, TaskSummary[]>> {
    const allTasks = await this.list()
    
    const board: Record<string, TaskSummary[]> = {
      backlog: [],
      'in-progress': [],
      review: [],
      done: []
    }

    for (const task of allTasks) {
      if (board[task.status]) {
        board[task.status].push(task)
      }
    }

    return board
  }
}

export const taskStorage = new TaskStorage()