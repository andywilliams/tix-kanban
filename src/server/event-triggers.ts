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

// Shared mapping from worker.ts style trigger keys to internal TriggerEventType
const TRIGGER_KEY_TO_EVENT_TYPE: Record<string, TriggerEventType> = {
  onPROpened: 'pr_opened',
  onPRMerged: 'pr_merged',
  onPRClosed: 'pr_closed',
  onPRReviewRequested: 'pr_review_requested',
  onCIPassed: 'test_success',
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
      const eventTypes = [...new Set(
        Object.entries(persona.triggers)
          .filter(([key, val]) => {
            const isEnabled = val === true || (typeof val === 'object' && val !== null && 'enabled' in val && (val as any).enabled === true);
            return isEnabled && TRIGGER_KEY_TO_EVENT_TYPE[key];
          })
          .map(([key]) => TRIGGER_KEY_TO_EVENT_TYPE[key])
      )];

      if (eventTypes.length > 0) {
        const trigger: PersonaTrigger = {
          personaId: persona.id,
          eventTypes,
          conditions: persona.triggers?.conditions,
          priority: persona.triggers?.priority ?? 100,
        };

        for (const eventType of eventTypes) {
          if (!triggerSubscriptions.has(eventType)) {
            triggerSubscriptions.set(eventType, []);
          }
          triggerSubscriptions.get(eventType)!.push(trigger);
        }
      }
    }
  }
  
  console.log(`🎯 Initialized ${triggerSubscriptions.size} event trigger types with ${personas.length} persona subscriptions`);
}

/**
 * Register a persona trigger subscription
 */
export async function registerTrigger(trigger: PersonaTrigger): Promise<void> {
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
  const eventType = TRIGGER_KEY_TO_EVENT_TYPE[triggerKey];
  if (!eventType) {
    return [];
  }
  
  const triggers = getTriggeredPersonas(eventType);
  if (triggers.length === 0) {
    return [];
  }
  
  // Convert PersonaTrigger[] to Persona[] by looking up each persona
  const personas: Persona[] = [];
  for (const trigger of triggers) {
    const persona = await getPersona(trigger.personaId);
    if (persona) {
      personas.push(persona);
    }
  }
  
  // Sort by priority (descending) - triggers are already sorted in the registry
  return personas;
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
      return evaluateCondition(condition, task, event);
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
 * Evaluate a trigger condition against task/event data
 */
function evaluateCondition(condition: TriggerCondition, task: any, event: TriggerEvent): boolean {
  let actualValue: any;
  
  // Extract value from task or event metadata
  if (condition.field.startsWith('metadata.')) {
    const metadataKey = condition.field.substring(9);
    actualValue = event.metadata?.[metadataKey];
  } else {
    actualValue = task[condition.field];
  }
  
  if (actualValue === undefined) {
    return false;
  }
  
  switch (condition.operator) {
    case 'equals':
      return actualValue === condition.value;
    
    case 'contains':
      if (Array.isArray(actualValue)) {
        return actualValue.includes(condition.value);
      }
      if (typeof actualValue === 'string') {
        return actualValue.includes(condition.value);
      }
      return false;
    
    case 'matches':
      if (typeof actualValue === 'string' && typeof condition.value === 'string') {
        // Sanitize user-supplied regex to prevent ReDoS: escape special chars and
        // disallow catastrophic backtracking patterns by limiting pattern length.
        const rawPattern = condition.value;
        if (rawPattern.length > 200) return false;
        try {
          const regex = new RegExp(rawPattern);
          return regex.test(actualValue);
        } catch {
          return false;
        }
      }
      return false;
    
    case 'greaterThan':
      return actualValue > condition.value;
    
    case 'lessThan':
      return actualValue < condition.value;
    
    default:
      return false;
  }
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
