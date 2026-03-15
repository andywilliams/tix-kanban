/**
 * Event Trigger System - Phase 3
 *
 * Enables personas to subscribe to task events and respond automatically.
 * Events include PR operations, test failures, status changes, etc.
 */

import { readTask, logActivity } from './storage.js';
import { getAllPersonas } from './persona-storage.js';

export type TriggerEventType =
  | 'pr_opened'
  | 'pr_merged'
  | 'pr_closed'
  | 'pr_review_requested'
  | 'ci_passed'
  | 'test_failure'
  | 'test_success'
  | 'status_change'
  | 'assignment_changed'
  | 'priority_changed'
  | 'comment_added'
  | 'link_added'
  | 'task_created'
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

// Map camelCase PersonaTriggers keys to snake_case event types.
// onCIPassed maps to 'ci_passed' (distinct from test_success).
const TRIGGER_KEY_TO_EVENT_TYPE: Record<string, TriggerEventType> = {
  onPROpened: 'pr_opened',
  onPRMerged: 'pr_merged',
  onPRClosed: 'pr_closed',
  onPRReviewRequested: 'pr_review_requested',
  onCIPassed: 'ci_passed',
  onTestFailure: 'test_failure',
  onTestSuccess: 'test_success',
  onStatusChange: 'status_change',
  onTaskCreated: 'task_created',
  onAssignmentChanged: 'assignment_changed',
  onPriorityChanged: 'priority_changed',
  onCommentAdded: 'comment_added',
  onLinkAdded: 'link_added',
  onDueDateApproaching: 'due_date_approaching',
};

/**
 * Initialize trigger system - load persona trigger configs
 */
export async function initializeTriggerSystem(): Promise<void> {
  // Clear existing subscriptions to prevent duplicate accumulation on repeated calls
  triggerSubscriptions.clear();
  const personas = await getAllPersonas();
  
  for (const persona of personas) {
    if (persona.triggers && typeof persona.triggers === 'object') {
      const eventTypes: TriggerEventType[] = [];

      for (const [key, value] of Object.entries(persona.triggers)) {
        // Skip non-boolean metadata fields
        if (key === 'conditions' || key === 'priority') continue;
        if (value === true) {
          const eventType = TRIGGER_KEY_TO_EVENT_TYPE[key];
          if (eventType) eventTypes.push(eventType);
        }
      }

      if (eventTypes.length > 0) {
        const trigger: PersonaTrigger = {
          personaId: persona.id,
          eventTypes,
          conditions: persona.triggers.conditions,
          priority: persona.triggers.priority ?? 100,
        };
        
        for (const eventType of eventTypes) {
          if (!triggerSubscriptions.has(eventType)) {
            triggerSubscriptions.set(eventType, []);
          }
          const list = triggerSubscriptions.get(eventType)!;
          list.push(trigger);
          list.sort((a, b) => b.priority - a.priority);
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
        try {
          return new RegExp(condition.value).test(actualValue);
        } catch {
          console.warn(`[event-triggers] Invalid regex pattern in condition: "${condition.value}"`);
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
