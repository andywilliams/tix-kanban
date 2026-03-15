/**
 * Parallel Execution System - Phase 3
 *
 * Enables multiple personas to work simultaneously on the same task.
 * Handles conflict resolution and state merging.
 */

import { readTask, writeTask, withTaskLock, logActivity } from './storage.js';
import type { Task } from '../client/types/index.js';

export interface ParallelExecution {
  taskId: string;
  executionId: string;
  participants: ParallelParticipant[];
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'conflict';
  conflictResolutionStrategy: 'last-write-wins' | 'merge-fields' | 'manual-review';
}

export interface ParallelParticipant {
  personaId: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  changes?: Partial<Task>;
  error?: string;
}

export interface ChangeSet {
  personaId: string;
  timestamp: Date;
  changes: Partial<Task>;
  priority: number; // Used for conflict resolution
}

// In-memory execution tracker
const activeExecutions = new Map<string, ParallelExecution>();

/**
 * Start a parallel execution session
 */
export async function startParallelExecution(
  taskId: string,
  personaIds: string[],
  strategy: 'last-write-wins' | 'merge-fields' | 'manual-review' = 'merge-fields'
): Promise<string> {
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  const execution: ParallelExecution = {
    taskId,
    executionId,
    participants: personaIds.map(id => ({
      personaId: id,
      status: 'waiting',
    })),
    startedAt: new Date(),
    status: 'running',
    conflictResolutionStrategy: strategy,
  };
  
  activeExecutions.set(executionId, execution);
  
  await logActivity(
    taskId,
    'comment_added',
    `[Parallel Execution] Started execution ${executionId} with ${personaIds.length} personas: ${personaIds.join(', ')}`,
    'system'
  );
  
  console.log(`🔀 Started parallel execution ${executionId} for task ${taskId} with personas: ${personaIds.join(', ')}`);
  
  return executionId;
}

/**
 * Mark a persona as started in a parallel execution
 */
export async function markPersonaStarted(executionId: string, personaId: string): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  const participant = execution.participants.find(p => p.personaId === personaId);
  if (!participant) {
    throw new Error(`Persona ${personaId} not in execution ${executionId}`);
  }
  
  participant.status = 'running';
  participant.startedAt = new Date();
  
  console.log(`🏃 Persona ${personaId} started in execution ${executionId}`);
}

/**
 * Record persona completion and changes
 */
export async function recordPersonaCompletion(
  executionId: string,
  personaId: string,
  changes: Partial<Task>,
  priority: number = 100
): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  const participant = execution.participants.find(p => p.personaId === personaId);
  if (!participant) {
    throw new Error(`Persona ${personaId} not in execution ${executionId}`);
  }
  
  participant.status = 'completed';
  participant.completedAt = new Date();
  participant.changes = changes;
  
  console.log(`✅ Persona ${personaId} completed in execution ${executionId}`);
  
  // Check if all participants are done
  const allDone = execution.participants.every(p => 
    p.status === 'completed' || p.status === 'failed'
  );
  
  if (allDone) {
    await finalizeExecution(executionId);
  }
}

/**
 * Record persona failure
 */
export async function recordPersonaFailure(
  executionId: string,
  personaId: string,
  error: string
): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  const participant = execution.participants.find(p => p.personaId === personaId);
  if (!participant) {
    throw new Error(`Persona ${personaId} not in execution ${executionId}`);
  }
  
  participant.status = 'failed';
  participant.completedAt = new Date();
  participant.error = error;
  
  console.error(`❌ Persona ${personaId} failed in execution ${executionId}: ${error}`);
  
  // Check if all participants are done
  const allDone = execution.participants.every(p => 
    p.status === 'completed' || p.status === 'failed'
  );
  
  if (allDone) {
    await finalizeExecution(executionId);
  }
}

/**
 * Finalize execution and merge changes
 */
async function finalizeExecution(executionId: string): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  const completedParticipants = execution.participants.filter(p => p.status === 'completed');
  
  if (completedParticipants.length === 0) {
    execution.status = 'failed';
    execution.completedAt = new Date();
    
    await logActivity(
      execution.taskId,
      'comment_added',
      `[Parallel Execution] Execution ${executionId} failed - no successful completions`,
      'system'
    );
    
    activeExecutions.delete(executionId);
    return;
  }
  
  // Collect all change sets
  const changeSets: ChangeSet[] = completedParticipants
    .filter(p => p.changes)
    .map((p, index) => ({
      personaId: p.personaId,
      timestamp: p.completedAt!,
      changes: p.changes!,
      priority: 100 - index, // First to complete gets higher priority
    }));
  
  // Apply conflict resolution
  let mergedChanges: Partial<Task>;
  let hasConflicts = false;
  
  try {
    const result = await resolveConflicts(changeSets, execution.conflictResolutionStrategy);
    mergedChanges = result.merged;
    hasConflicts = result.hasConflicts;
  } catch (error) {
    execution.status = 'conflict';
    execution.completedAt = new Date();
    
    await logActivity(
      execution.taskId,
      'comment_added',
      `[Parallel Execution] Execution ${executionId} failed to resolve conflicts: ${error}`,
      'system'
    );
    
    activeExecutions.delete(executionId);
    return;
  }
  
  // Apply merged changes to task
  await withTaskLock(execution.taskId, async () => {
    const task = await readTask(execution.taskId);
    if (!task) {
      throw new Error(`Task ${execution.taskId} not found`);
    }
    
    // Merge changes
    Object.assign(task, mergedChanges);
    task.updatedAt = new Date();
    
    await writeTask(task);
  });
  
  execution.status = hasConflicts ? 'conflict' : 'completed';
  execution.completedAt = new Date();
  
  await logActivity(
    execution.taskId,
    'comment_added',
    `[Parallel Execution] Execution ${executionId} completed with ${changeSets.length} change sets${hasConflicts ? ' (with conflicts resolved)' : ''}`,
    'system'
  );
  
  console.log(`🎉 Parallel execution ${executionId} finalized for task ${execution.taskId}`);
  
  activeExecutions.delete(executionId);
}

/**
 * Resolve conflicts between multiple change sets
 */
async function resolveConflicts(
  changeSets: ChangeSet[],
  strategy: 'last-write-wins' | 'merge-fields' | 'manual-review'
): Promise<{ merged: Partial<Task>; hasConflicts: boolean }> {
  if (changeSets.length === 0) {
    return { merged: {}, hasConflicts: false };
  }
  
  if (changeSets.length === 1) {
    return { merged: changeSets[0].changes, hasConflicts: false };
  }
  
  const merged: Partial<Task> = {};
  const conflicts: string[] = [];
  
  // Collect all modified fields
  const allFields = new Set<string>();
  for (const cs of changeSets) {
    Object.keys(cs.changes).forEach(field => allFields.add(field));
  }
  
  for (const field of allFields) {
    const values = changeSets
      .filter(cs => field in cs.changes)
      .map(cs => ({
        personaId: cs.personaId,
        value: (cs.changes as any)[field],
        priority: cs.priority,
        timestamp: cs.timestamp,
      }));
    
    if (values.length === 1) {
      // No conflict - only one persona touched this field
      (merged as any)[field] = values[0].value;
      continue;
    }
    
    // Multiple personas modified the same field - conflict!
    const uniqueValues = new Set(values.map(v => JSON.stringify(v.value)));
    
    if (uniqueValues.size === 1) {
      // All personas set the same value - not really a conflict
      (merged as any)[field] = values[0].value;
      continue;
    }
    
    // Real conflict - apply resolution strategy
    conflicts.push(field);
    
    switch (strategy) {
      case 'last-write-wins':
        // Take the value from the most recently completed persona
        values.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        (merged as any)[field] = values[0].value;
        break;
      
      case 'merge-fields':
        // For arrays, merge; for objects, merge; for primitives, use highest priority
        if (Array.isArray(values[0].value)) {
          // Merge arrays and deduplicate
          const mergedArray = values.flatMap(v => v.value as any[]);
          (merged as any)[field] = Array.from(new Set(mergedArray.map((v) => JSON.stringify(v)))).map((v) => JSON.parse(v));
        } else if (typeof values[0].value === 'object' && values[0].value !== null) {
          // Merge objects
          const mergedObject = {};
          for (const v of values) {
            Object.assign(mergedObject, v.value);
          }
          (merged as any)[field] = mergedObject;
        } else {
          // Primitive - use highest priority
          values.sort((a, b) => b.priority - a.priority);
          (merged as any)[field] = values[0].value;
        }
        break;
      
      case 'manual-review':
        // Skip conflicting fields - leave for manual resolution
        // Could mark the task for manual review
        break;
    }
  }
  
  return { 
    merged, 
    hasConflicts: conflicts.length > 0,
  };
}

/**
 * Get execution status
 */
export function getExecutionStatus(executionId: string): ParallelExecution | undefined {
  return activeExecutions.get(executionId);
}

/**
 * Get all active executions for a task
 */
export function getTaskExecutions(taskId: string): ParallelExecution[] {
  return Array.from(activeExecutions.values()).filter(ex => ex.taskId === taskId);
}

/**
 * Cancel an execution
 */
export async function cancelExecution(executionId: string, reason: string = 'Cancelled'): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }
  
  execution.status = 'failed';
  execution.completedAt = new Date();
  
  await logActivity(
    execution.taskId,
    'comment_added',
    `[Parallel Execution] Execution ${executionId} cancelled: ${reason}`,
    'system'
  );
  
  activeExecutions.delete(executionId);
  console.log(`🛑 Cancelled parallel execution ${executionId}`);
}
