/**
 * Shared condition evaluation utility
 *
 * Used by both event-triggers.ts and orchestrator.ts to evaluate task field conditions.
 * Extracted to avoid duplication and ensure consistent behaviour (including undefined guard).
 */

export interface FieldCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan';
  value: any;
}

/**
 * Evaluate a single condition against a task object.
 * Returns false if the field value is undefined or null.
 */
export function evaluateFieldCondition(condition: FieldCondition, task: any): boolean {
  const fieldValue = (task as any)[condition.field];

  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;

    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value);
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(condition.value);
      }
      return false;

    case 'matches':
      if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
        // Sanitize user-supplied regex to prevent ReDoS: limit pattern length and wrap in try-catch.
        const rawPattern = condition.value;
        if (rawPattern.length > 200) return false;
        try {
          return new RegExp(rawPattern).test(fieldValue);
        } catch {
          return false;
        }
      }
      return false;

    case 'greaterThan':
      return fieldValue > condition.value;

    case 'lessThan':
      return fieldValue < condition.value;

    default:
      return false;
  }
}
