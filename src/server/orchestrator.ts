/**
 * Orchestrator Pattern - Phase 3
 *
 * Coordinator personas that can fan out work to specialist personas.
 * Implements task decomposition and delegation.
 */

import { readTask, writeTask, withTaskLock, logActivity } from './storage.js';
import { getPersona } from './persona-storage.js';
import { startParallelExecution, markPersonaStarted, recordPersonaCompletion } from './parallel-execution.js';
import type { Task } from '../client/types/index.js';

export interface OrchestratorConfig {
  personaId: string; // The orchestrator persona
  canDelegate: boolean; // Can this persona delegate work?
  delegationRules?: DelegationRule[];
  specialists?: SpecialistMapping[];
}

export interface DelegationRule {
  condition: {
    field: string;
    operator: 'equals' | 'contains' | 'matches';
    value: any;
  };
  action: 'delegate' | 'parallel' | 'sequential';
  targetPersonas: string[];
}

export interface SpecialistMapping {
  specialty: string; // e.g., "testing", "frontend", "backend"
  personaIds: string[];
}

export interface OrchestratedTask {
  taskId: string;
  orchestratorId: string;
  strategy: 'parallel' | 'sequential';
  subtasks: Subtask[];
  startedAt: Date;
  completedAt?: Date;
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

export interface Subtask {
  id: string;
  description: string;
  assignedTo: string; // persona ID
  status: 'waiting' | 'running' | 'completed' | 'failed';
  dependencies?: string[]; // subtask IDs that must complete first
  result?: any;
  error?: string;
}

// In-memory orchestration tracker
const activeOrchestrations = new Map<string, OrchestratedTask>();

/**
 * Register an orchestrator persona
 */
const orchestratorConfigs = new Map<string, OrchestratorConfig>();

export function registerOrchestrator(config: OrchestratorConfig): void {
  orchestratorConfigs.set(config.personaId, config);
  console.log(`🎭 Registered orchestrator: ${config.personaId}`);
}

export function getOrchestratorConfig(personaId: string): OrchestratorConfig | undefined {
  return orchestratorConfigs.get(personaId);
}

export function isOrchestrator(personaId: string): boolean {
  return orchestratorConfigs.has(personaId);
}

/**
 * Create an orchestrated task - break down work and assign to specialists
 */
export async function orchestrateTask(
  taskId: string,
  orchestratorId: string,
  subtasks: Omit<Subtask, 'id' | 'status'>[],
  strategy: 'parallel' | 'sequential' = 'parallel'
): Promise<string> {
  const config = orchestratorConfigs.get(orchestratorId);
  if (!config || !config.canDelegate) {
    throw new Error(`Persona ${orchestratorId} is not configured as an orchestrator`);
  }
  
  const orchestrationId = `orch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  const orchestration: OrchestratedTask = {
    taskId,
    orchestratorId,
    strategy,
    subtasks: subtasks.map((st, index) => ({
      id: `${orchestrationId}_sub_${index}`,
      ...st,
      status: 'waiting',
    })),
    startedAt: new Date(),
    status: 'planning',
  };
  
  activeOrchestrations.set(orchestrationId, orchestration);
  
  await logActivity(
    taskId,
    'comment_added',
    `[Orchestration] ${orchestratorId} created ${strategy} orchestration with ${subtasks.length} subtasks`,
    orchestratorId
  );
  
  console.log(`🎯 Orchestrator ${orchestratorId} created ${strategy} plan for task ${taskId} with ${subtasks.length} subtasks`);
  
  return orchestrationId;
}

/**
 * Start executing an orchestration
 */
export async function startOrchestration(orchestrationId: string): Promise<void> {
  const orchestration = activeOrchestrations.get(orchestrationId);
  if (!orchestration) {
    throw new Error(`Orchestration ${orchestrationId} not found`);
  }
  
  orchestration.status = 'executing';
  
  if (orchestration.strategy === 'parallel') {
    // Start all subtasks in parallel
    const personaIds = orchestration.subtasks.map(st => st.assignedTo);
    const executionId = await startParallelExecution(
      orchestration.taskId,
      personaIds,
      'merge-fields'
    );
    
    console.log(`🔀 Started parallel execution ${executionId} for orchestration ${orchestrationId}`);
  } else {
    // Sequential - start first subtask
    const firstSubtask = orchestration.subtasks.find(st => !st.dependencies || st.dependencies.length === 0);
    if (firstSubtask) {
      firstSubtask.status = 'running';
      console.log(`➡️ Started sequential subtask ${firstSubtask.id} for ${firstSubtask.assignedTo}`);
    }
  }
  
  await logActivity(
    orchestration.taskId,
    'comment_added',
    `[Orchestration] Started ${orchestration.strategy} execution`,
    orchestration.orchestratorId
  );
}

/**
 * Record subtask completion and advance orchestration
 */
export async function completeSubtask(
  orchestrationId: string,
  subtaskId: string,
  result?: any
): Promise<void> {
  const orchestration = activeOrchestrations.get(orchestrationId);
  if (!orchestration) {
    throw new Error(`Orchestration ${orchestrationId} not found`);
  }
  
  const subtask = orchestration.subtasks.find(st => st.id === subtaskId);
  if (!subtask) {
    throw new Error(`Subtask ${subtaskId} not found in orchestration ${orchestrationId}`);
  }
  
  subtask.status = 'completed';
  subtask.result = result;
  
  await logActivity(
    orchestration.taskId,
    'comment_added',
    `[Orchestration] Subtask completed by ${subtask.assignedTo}: ${subtask.description}`,
    subtask.assignedTo
  );
  
  console.log(`✅ Subtask ${subtaskId} completed in orchestration ${orchestrationId}`);
  
  // Check if orchestration is complete
  const allComplete = orchestration.subtasks.every(st => st.status === 'completed' || st.status === 'failed');
  
  if (allComplete) {
    await finalizeOrchestration(orchestrationId);
    return;
  }
  
  // If sequential, start next available subtask
  if (orchestration.strategy === 'sequential') {
    const nextSubtask = orchestration.subtasks.find(st => {
      if (st.status !== 'waiting') return false;
      if (!st.dependencies || st.dependencies.length === 0) return true;
      
      // Check if all dependencies are completed
      return st.dependencies.every(depId => {
        const dep = orchestration.subtasks.find(s => s.id === depId);
        return dep?.status === 'completed';
      });
    });
    
    if (nextSubtask) {
      nextSubtask.status = 'running';
      console.log(`➡️ Starting next sequential subtask ${nextSubtask.id} for ${nextSubtask.assignedTo}`);
    }
  }
}

/**
 * Record subtask failure
 */
export async function failSubtask(
  orchestrationId: string,
  subtaskId: string,
  error: string
): Promise<void> {
  const orchestration = activeOrchestrations.get(orchestrationId);
  if (!orchestration) {
    throw new Error(`Orchestration ${orchestrationId} not found`);
  }
  
  const subtask = orchestration.subtasks.find(st => st.id === subtaskId);
  if (!subtask) {
    throw new Error(`Subtask ${subtaskId} not found in orchestration ${orchestrationId}`);
  }
  
  subtask.status = 'failed';
  subtask.error = error;
  
  await logActivity(
    orchestration.taskId,
    'comment_added',
    `[Orchestration] Subtask failed (${subtask.assignedTo}): ${error}`,
    subtask.assignedTo
  );
  
  console.error(`❌ Subtask ${subtaskId} failed in orchestration ${orchestrationId}: ${error}`);
  
  // Check if orchestration should fail
  const allDone = orchestration.subtasks.every(st => st.status === 'completed' || st.status === 'failed');
  
  if (allDone) {
    await finalizeOrchestration(orchestrationId);
  }
}

/**
 * Finalize orchestration
 */
async function finalizeOrchestration(orchestrationId: string): Promise<void> {
  const orchestration = activeOrchestrations.get(orchestrationId);
  if (!orchestration) {
    throw new Error(`Orchestration ${orchestrationId} not found`);
  }
  
  const completedCount = orchestration.subtasks.filter(st => st.status === 'completed').length;
  const failedCount = orchestration.subtasks.filter(st => st.status === 'failed').length;
  
  orchestration.status = failedCount === 0 ? 'completed' : 'failed';
  orchestration.completedAt = new Date();
  
  await logActivity(
    orchestration.taskId,
    'comment_added',
    `[Orchestration] Completed with ${completedCount} successful, ${failedCount} failed subtasks`,
    orchestration.orchestratorId
  );
  
  console.log(`🎉 Orchestration ${orchestrationId} finalized: ${orchestration.status}`);
  
  activeOrchestrations.delete(orchestrationId);
}

/**
 * Get orchestration status
 */
export function getOrchestrationStatus(orchestrationId: string): OrchestratedTask | undefined {
  return activeOrchestrations.get(orchestrationId);
}

/**
 * Auto-assign specialists based on task requirements
 */
export async function autoAssignSpecialists(
  taskId: string,
  orchestratorId: string,
  requirements: string[]
): Promise<string[]> {
  const config = orchestratorConfigs.get(orchestratorId);
  if (!config || !config.specialists) {
    return [];
  }
  
  const assignedPersonas: string[] = [];
  
  for (const requirement of requirements) {
    const mapping = config.specialists.find(s => 
      s.specialty.toLowerCase().includes(requirement.toLowerCase()) ||
      requirement.toLowerCase().includes(s.specialty.toLowerCase())
    );
    
    if (mapping && mapping.personaIds.length > 0) {
      // Pick the first specialist for this specialty
      assignedPersonas.push(mapping.personaIds[0]);
    }
  }
  
  return Array.from(new Set(assignedPersonas)); // Deduplicate
}

/**
 * Evaluate delegation rules for a task
 */
export async function evaluateDelegationRules(
  taskId: string,
  orchestratorId: string
): Promise<{ shouldDelegate: boolean; targetPersonas: string[]; strategy: 'parallel' | 'sequential' }> {
  const config = orchestratorConfigs.get(orchestratorId);
  if (!config || !config.delegationRules) {
    return { shouldDelegate: false, targetPersonas: [], strategy: 'parallel' };
  }
  
  const task = await readTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  
  for (const rule of config.delegationRules) {
    const fieldValue = (task as any)[rule.condition.field];
    let matches = false;
    
    switch (rule.condition.operator) {
      case 'equals':
        matches = fieldValue === rule.condition.value;
        break;
      case 'contains':
        if (Array.isArray(fieldValue)) {
          matches = fieldValue.includes(rule.condition.value);
        } else if (typeof fieldValue === 'string') {
          matches = fieldValue.includes(rule.condition.value);
        }
        break;
      case 'matches':
        if (typeof fieldValue === 'string') {
          try {
            matches = new RegExp(rule.condition.value).test(fieldValue);
          } catch {
            console.warn(`[orchestrator] Invalid regex pattern in delegation rule: "${rule.condition.value}"`);
          }
        }
        break;
    }
    
    if (matches) {
      return {
        shouldDelegate: rule.action === 'delegate',
        targetPersonas: rule.targetPersonas,
        strategy: rule.action === 'parallel' ? 'parallel' : 'sequential',
      };
    }
  }
  
  return { shouldDelegate: false, targetPersonas: [], strategy: 'parallel' };
}
