/**
 * Persona Collaboration Phase 3 - Integration Layer
 *
 * High-level API for event-driven triggers, parallel execution, and orchestration.
 */

import { 
  initializeTriggerSystem, 
  registerTrigger,
  clearAllTriggers,
  emitEvent, 
  emitPROpened, 
  emitTestFailure,
  emitStatusChange,
  TRIGGER_KEY_TO_EVENT_TYPE,
  type TriggerEvent, 
  type PersonaTrigger,
  type TriggerEventType,
} from './event-triggers.js';
import {
  startParallelExecution,
  markPersonaStarted,
  recordPersonaCompletion,
  recordPersonaFailure,
  getExecutionStatus,
  type ParallelExecution,
} from './parallel-execution.js';
import {
  registerOrchestrator,
  getOrchestratorConfig,
  isOrchestrator,
  orchestrateTask,
  startOrchestration,
  completeSubtask,
  failSubtask,
  autoAssignSpecialists,
  evaluateDelegationRules,
  type OrchestratorConfig,
  type OrchestratedTask,
} from './orchestrator.js';
import { getAllPersonas, getPersona } from './persona-storage.js';
import type { Persona } from '../client/types/index.js';

/**
 * Composable addressing priority order:
 * 1. Human override (manual mention/assignment)
 * 2. Direct mention in message/comment
 * 3. Event trigger
 * 4. Orchestrator delegation
 * 5. Silence (no response)
 */
export async function resolvePersonaInvocation(
  taskId: string,
  options: {
    humanOverride?: string; // Explicitly assigned persona
    directMention?: string; // Persona mentioned in message
    event?: TriggerEvent; // Event that occurred
    orchestratorId?: string; // Orchestrator that might delegate
  }
): Promise<{
  personas: string[];
  mode: 'human-override' | 'direct-mention' | 'event-trigger' | 'orchestrator' | 'silence';
  parallel: boolean;
}> {
  // 1. Human override
  if (options.humanOverride) {
    return {
      personas: [options.humanOverride],
      mode: 'human-override',
      parallel: false,
    };
  }
  
  // 2. Direct mention
  if (options.directMention) {
    return {
      personas: [options.directMention],
      mode: 'direct-mention',
      parallel: false,
    };
  }
  
  // 3. Event trigger
  if (options.event) {
    const triggeredPersonas = await emitEvent(options.event);
    if (triggeredPersonas.length > 0) {
      return {
        personas: triggeredPersonas,
        mode: 'event-trigger',
        parallel: triggeredPersonas.length > 1, // Auto-parallel if multiple
      };
    }
  }
  
  // 4. Orchestrator delegation
  if (options.orchestratorId && isOrchestrator(options.orchestratorId)) {
    const delegation = await evaluateDelegationRules(taskId, options.orchestratorId);
    if (delegation.shouldDelegate && delegation.targetPersonas.length > 0) {
      return {
        personas: delegation.targetPersonas,
        mode: 'orchestrator',
        parallel: delegation.strategy === 'parallel',
      };
    }
  }
  
  // 5. Silence
  return {
    personas: [],
    mode: 'silence',
    parallel: false,
  };
}

/**
 * Coordinate multiple personas responding to an event
 */

// Export sub-modules
export {
  // Event triggers
  emitEvent,
  emitPROpened,
  emitTestFailure,
  emitStatusChange,
  registerTrigger,
  clearAllTriggers,
  
  // Parallel execution
  startParallelExecution,
  markPersonaStarted,
  recordPersonaCompletion,
  recordPersonaFailure,
  getExecutionStatus,
  
  // Orchestration
  registerOrchestrator,
  isOrchestrator,
  orchestrateTask,
  startOrchestration,
  completeSubtask,
  failSubtask,
  autoAssignSpecialists,
  evaluateDelegationRules,
};

// Export types
export type {
  TriggerEvent,
  TriggerEventType,
  PersonaTrigger,
  ParallelExecution,
  OrchestratorConfig,
  OrchestratedTask,
};
