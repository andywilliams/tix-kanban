import * as cron from 'node-cron'
import { taskStorage } from '../storage/tasks.js'
import { personaSystem } from '../storage/personas.js'
import { spawn } from 'child_process'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'

export interface CronSettings {
  enabled: boolean
  interval: string // cron expression
  maxConcurrent: number
}

export interface WorkerRun {
  id: string
  taskId: string
  persona: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed'
  output: string
  error?: string
}

class CronSystem {
  private settings: CronSettings
  private job: cron.ScheduledTask | null = null
  private runningTasks = new Set<string>()
  private runsDir: string

  constructor() {
    this.settings = {
      enabled: true,
      interval: '*/30 * * * *', // Every 30 minutes
      maxConcurrent: 2
    }
    
    this.runsDir = path.join(os.homedir(), '.tix-kanban', 'runs')
    fs.ensureDirSync(this.runsDir)
  }

  start(): void {
    if (this.job) {
      this.job.stop()
    }

    this.job = cron.schedule(this.settings.interval, async () => {
      if (this.settings.enabled && this.runningTasks.size < this.settings.maxConcurrent) {
        await this.runWorker()
      }
    }, {
      scheduled: false
    })

    this.job.start()
    console.log(`🤖 Cron worker started with interval: ${this.settings.interval}`)
  }

  stop(): void {
    if (this.job) {
      this.job.stop()
      this.job = null
    }
    console.log('🛑 Cron worker stopped')
  }

  async triggerWorker(): Promise<void> {
    if (this.runningTasks.size < this.settings.maxConcurrent) {
      await this.runWorker()
    } else {
      console.log('⏸️ Worker not triggered - max concurrent sessions reached')
    }
  }

  updateSettings(newSettings: Partial<CronSettings>): void {
    this.settings = { ...this.settings, ...newSettings }
    
    // Restart if interval changed
    if (newSettings.interval && this.job) {
      this.start()
    }
    
    console.log('⚙️ Cron settings updated:', this.settings)
  }

  getStatus(): { settings: CronSettings; running: string[]; recentRuns: WorkerRun[] } {
    return {
      settings: this.settings,
      running: Array.from(this.runningTasks),
      recentRuns: [] // TODO: Implement recent runs tracking
    }
  }

  private async runWorker(): Promise<void> {
    try {
      // Get highest priority backlog task assigned to AI
      const backlogTasks = await taskStorage.list({ status: 'backlog' })
      const aiTasks = backlogTasks.filter(task => 
        task.assignee && ['ai', 'bot', 'claude', 'jenna'].includes(task.assignee.toLowerCase())
      )
      
      if (aiTasks.length === 0) {
        console.log('📭 No AI tasks in backlog')
        return
      }

      const task = aiTasks[0] // Highest priority (already sorted)
      const fullTask = await taskStorage.get(task.taskId)
      
      if (!fullTask) {
        console.error(`❌ Failed to load task ${task.taskId}`)
        return
      }

      console.log(`🎯 Picking up task: ${fullTask.title}`)
      
      // Move to in-progress
      await taskStorage.update(task.taskId, { status: 'in-progress' })
      this.runningTasks.add(task.taskId)

      // Determine persona (TODO: make this smarter)
      const personas = await personaSystem.list()
      const persona = personas.find(p => p.id === 'general-developer') || personas[0]

      if (!persona) {
        console.error('❌ No personas available')
        return
      }

      const runId = this.generateRunId()
      const workerRun: WorkerRun = {
        id: runId,
        taskId: task.taskId,
        persona: persona.id,
        startedAt: new Date().toISOString(),
        status: 'running',
        output: ''
      }

      await this.saveRun(workerRun)

      // Build the prompt
      const prompt = `${persona.prompt}

## Task
**Title:** ${fullTask.title}
**Description:** ${fullTask.description}

## Instructions
${fullTask.description}

Please complete this task and provide a summary of what you did.`

      console.log(`🤖 Running with persona: ${persona.name}`)

      // Spawn Claude CLI
      const claude = spawn('claude', ['--print', prompt], {
        stdio: 'pipe',
        shell: true
      })

      let output = ''
      let error = ''

      claude.stdout.on('data', (data) => {
        output += data.toString()
      })

      claude.stderr.on('data', (data) => {
        error += data.toString()
      })

      claude.on('close', async (code) => {
        this.runningTasks.delete(task.taskId)
        
        workerRun.completedAt = new Date().toISOString()
        workerRun.output = output
        workerRun.status = code === 0 ? 'completed' : 'failed'
        
        if (error) {
          workerRun.error = error
        }

        await this.saveRun(workerRun)

        if (code === 0) {
          // Add output as comment to task
          await taskStorage.addComment(task.taskId, `🤖 ${persona.name} completed this task:\n\n${output.trim()}`)
          
          // Move to review status
          await taskStorage.update(task.taskId, { status: 'review' })
          
          console.log(`✅ Task completed: ${fullTask.title}`)
        } else {
          console.error(`❌ Task failed: ${fullTask.title}`, error)
          
          // Add error comment and move back to backlog
          await taskStorage.addComment(task.taskId, `❌ ${persona.name} failed to complete this task:\n\n${error.trim()}`)
          await taskStorage.update(task.taskId, { status: 'backlog' })
        }
      })

    } catch (error) {
      console.error('💥 Worker error:', error)
    }
  }

  private generateRunId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  private async saveRun(run: WorkerRun): Promise<void> {
    const filePath = path.join(this.runsDir, `${run.id}.json`)
    await fs.writeJson(filePath, run, { spaces: 2 })
  }
}

export const cronSystem = new CronSystem()