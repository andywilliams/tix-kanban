/**
 * Event Trigger System - Phase 3
 *
 * Enables personas to subscribe to task events and respond automatically.
 * Events include PR operations, test failures, status changes, etc.
 *
 * TODO: This module has duplicate implementations with worker.ts trigger logic.
 * worker.ts (lines 155, 446-536) contains a simpler trigger system that is
 * currently in use. Consider consolidating to one implementation.
 */

import { readTask, logActivity } from './storage.js';
import { getAllPersonas, getPersona } from './persona-storage.js';
import { Persona } from '../client/types/index.js';
import { evaluateTriggerCondition } from './condition-utils.js';

// Shared mapping from worker.ts style trigger keys to internal TriggerEventType
export const TRIGGER_KEY_TO_EVENT_TYPE: Record<string, TriggerEventType> = {
  onPROpened: 'pr_opened',
  onPRMerged: 'pr_merged',
  onPRClosed: 'pr_closed',
  onPRReviewRequested: 'pr_review_requested',
  onCIPassed: 'ci_passed',
  onTestSuccess: 'test_success',
  onTestFailure: 'test_failure',
  onStatusChange: 'status_change',
  onTaskCreated: 'task_created',
  onTaskStarted: 'task_started',
  onAssignmentChanged: 'assignment_changed',
  onPriorityChanged: 'priority_changed',
  onCommentAdded: 'comment_added',
  onLinkAdded: 'link_added',
  onDueDateApproaching: 'due_date_approaching',
};

export type TriggerEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'pr_review_requested'
  | 'ci_passed'
  | 'test_failure'
  | 'test_success'
  | 'status_change'
  | 'task_created'
  | 'task_started'
  | 'assignment_changed'
  | 'priority_changed'
  | 'comment_added'
  | 'link_added'
  | 'due_date_approaching';

export interface TriggerEvent {
  type: TriggerEventType;
  taskId: string;
  metadata?: {
    from?: string;
    to?: string;
    url?: string;
    [key: string]: any;
  };
  timestamp: Date;
}

export interface PersonaTrigger {
  personaId: string;
  eventTypes: TriggerEventType[];
  conditions?: TriggerCondition[];
  priority: number; // Higher priority personas respond first
}

export interface TriggerCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan';
  value: any;
}

// In-memory subscription registry
const triggerSubscriptions = new Map<string, PersonaTrigger[]>();

/**
 * Initialize trigger system - load persona trigger configs
 */
export async function initializeTriggerSystem(): Promise<void> {
  // Clear existing subscriptions to avoid accumulating duplicates on re-init
  triggerSubscriptions.clear();

  const personas = await getAllPersonas();

  for (const persona of personas) {
    if (persona.triggers) {
      // Build per-event-type triggers to honour per-trigger priority from config objects
      const enabledEntries = Object.entries(persona.triggers)
        .filter(([key, val]) => {
          if (!TRIGGER_KEY_TO_EVENT_TYPE[key]) return false;
          // onLinkAdded doesn't have a separate handler in worker.ts, so treat like other triggers
          return val === true || (typeof val === 'object' && val !== null && (val as any).enabled === true);
        });

      for (const [key, val] of enabledEntries) {
        const eventType = TRIGGER_KEY_TO_EVENT_TYPE[key];
        // Per-trigger priority overrides top-level persona trigger priority
        const perTriggerPriority = (typeof val === 'object' && val !== null && typeof (val as any).priority === 'number')
          ? (val as any).priority
          : undefined;
        const priority = perTriggerPriority ?? persona.triggers?.priority ?? 100;

        const trigger: PersonaTrigger = {
          personaId: persona.id,
          eventTypes: [eventType],
          conditions: persona.triggers?.conditions,
          priority,
        };

        if (!triggerSubscriptions.has(eventType)) {
          triggerSubscriptions.set(eventType, []);
        }
        triggerSubscriptions.get(eventType)!.push(trigger);
      }
    }
  }
  
  // Sort all trigger arrays by priority (descending)
  for (const triggers of triggerSubscriptions.values()) {
    triggers.sort((a, b) => b.priority - a.priority);
  }
  
  console.log(`🎯 Initialized ${triggerSubscriptions.size} event trigger types with ${personas.length} persona subscriptions`);
}

/**
 * Register a persona trigger subscription
 */
export async function registerTrigger(trigger: PersonaTrigger): Promise<void> {
  const newEventTypeSet = new Set(trigger.eventTypes);

  // Remove stale subscriptions for event types this persona no longer subscribes to
  for (const [eventType, subscribers] of triggerSubscriptions.entries()) {
    if (!newEventTypeSet.has(eventType as TriggerEventType)) {
      const filtered = subscribers.filter(t => t.personaId !== trigger.personaId);
      if (filtered.length === 0) {
        triggerSubscriptions.delete(eventType);
      } else {
        triggerSubscriptions.set(eventType, filtered);
      }
    }
  }

  for (const eventType of trigger.eventTypes) {
    if (!triggerSubscriptions.has(eventType)) {
      triggerSubscriptions.set(eventType, []);
    }
    
    const existing = triggerSubscriptions.get(eventType)!;
    const index = existing.findIndex(t => t.personaId === trigger.personaId);
    
    if (index >= 0) {
      existing[index] = trigger; // Update existing
    } else {
      existing.push(trigger);
    }
    
    // Sort by priority (descending)
    existing.sort((a, b) => b.priority - a.priority);
  }
}

/**
 * Unregister a persona from a specific event type
 */
export async function unregisterTrigger(personaId: string, eventType: TriggerEventType): Promise<void> {
  const subscribers = triggerSubscriptions.get(eventType);
  if (!subscribers) return;
  
  const filtered = subscribers.filter(t => t.personaId !== personaId);
  if (filtered.length === 0) {
    triggerSubscriptions.delete(eventType);
  } else {
    triggerSubscriptions.set(eventType, filtered);
  }
}

/**
 * Get all personas subscribed to an event type
 */
export function getTriggeredPersonas(eventType: TriggerEventType): PersonaTrigger[] {
  return triggerSubscriptions.get(eventType) || [];
}

/**
 * Get triggered personas by worker.ts style trigger key (e.g., 'onTaskStarted')
 * Returns Persona objects sorted by priority (highest first)
 */
export async function getPersonasByTriggerKey(triggerKey: string): Promise<Persona[]> {
  return getPersonasByTriggerKeyWithContext(triggerKey, {});
}

/**
 * Get triggered personas by worker.ts style trigger key and evaluate trigger conditions.
 * If conditions are present and no task context is provided, the persona is excluded.
 */
export async function getPersonasByTriggerKeyWithContext(
  triggerKey: string,
  context: { task?: any; metadata?: Record<string, any> }
): Promise<Persona[]> {
  const eventType = TRIGGER_KEY_TO_EVENT_TYPE[triggerKey];
  if (!eventType) {
    return [];
  }

  const triggers = getTriggeredPersonas(eventType);
  if (triggers.length === 0) {
    return [];
  }

  const matched: Array<{ persona: Persona; priority: number }> = [];
  for (const trigger of triggers) {
    const persona = await getPersona(trigger.personaId);
    if (!persona) {
      continue;
    }

    if (!trigger.conditions || trigger.conditions.length === 0) {
      matched.push({ persona, priority: trigger.priority });
      continue;
    }

    if (!context.task) {
      continue;
    }

    const allMatch = trigger.conditions.every(condition => {
      return evaluateTriggerCondition(condition, context.task, context.metadata);
    });

    if (allMatch) {
      matched.push({ persona, priority: trigger.priority });
    }
  }

  matched.sort((a, b) => b.priority - a.priority);
  return matched.map((entry) => entry.persona);
}
/**
 * Emit an event and get the list of personas that should respond
 */
export async function emitEvent(event: TriggerEvent): Promise<string[]> {
  const triggers = getTriggeredPersonas(event.type);
  
  if (triggers.length === 0) {
    return [];
  }
  
  // Filter by conditions (if any)
  const task = await readTask(event.taskId);
  if (!task) {
    console.error(`Task ${event.taskId} not found for event ${event.type}`);
    return [];
  }
  
  const matchingPersonas: string[] = [];
  
  for (const trigger of triggers) {
    if (!trigger.conditions || trigger.conditions.length === 0) {
      matchingPersonas.push(trigger.personaId);
      continue;
    }
    
    // Evaluate conditions
    const allMatch = trigger.conditions.every(condition => {
      return evaluateTriggerCondition(condition, task, event.metadata);
    });
    
    if (allMatch) {
      matchingPersonas.push(trigger.personaId);
    }
  }
  
  // Log the trigger event
  await logActivity(
    event.taskId,
    'comment_added',
    `[Event Trigger] ${event.type} triggered ${matchingPersonas.length} persona(s): ${matchingPersonas.join(', ')}`,
    'system'
  );
  
  console.log(`🎯 Event ${event.type} on task ${event.taskId} triggered personas: ${matchingPersonas.join(', ')}`);
  
  return matchingPersonas;
}

/**
 * Helper to emit common event types
 */
export async function emitPROpened(taskId: string, prUrl: string, prNumber: number): Promise<string[]> {
  return emitEvent({
    type: 'pr_opened',
    taskId,
    metadata: { url: prUrl, prNumber },
    timestamp: new Date(),
  });
}

export async function emitTestFailure(taskId: string, testPath: string, errorMessage: string): Promise<string[]> {
  return emitEvent({
    type: 'test_failure',
    taskId,
    metadata: { testPath, errorMessage },
    timestamp: new Date(),
  });
}

export async function emitCIPassed(taskId: string, prUrl: string, prNumber: number): Promise<string[]> {
  return emitEvent({
    type: 'ci_passed',
    taskId,
    metadata: { url: prUrl, prNumber },
    timestamp: new Date(),
  });
}

export async function emitStatusChange(taskId: string, from: string, to: string): Promise<string[]> {
  return emitEvent({
    type: 'status_change',
    taskId,
    metadata: { from, to },
    timestamp: new Date(),
  });
}

/**
 * Get all registered triggers for debugging/monitoring
 */
export function getAllTriggers(): Map<string, PersonaTrigger[]> {
  return new Map(triggerSubscriptions);
}

/**
 * Clear all triggers (for testing)
 */
export function clearAllTriggers(): void {
  triggerSubscriptions.clear();
  console.log('🧹 Cleared all trigger subscriptions');
}
