/**
 * Shared condition evaluation utilities.
 */

export interface FieldCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan';
  value: any;
}

/**
 * Evaluate a single condition against a task object.
 * Returns false if the field value is null/undefined.
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
        const rawPattern = condition.value;
        if (rawPattern.length > 200 || /(\(.+[+*?]\)[+*?]|\[.+\][+*]{2})/.test(rawPattern)) {
          console.warn(`[condition-utils] Potentially unsafe regex pattern rejected: "${rawPattern}"`);
          return false;
        }
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

/**
 * Evaluate a trigger condition against task fields and optional event metadata.
 * `metadata.*` fields are resolved from metadata object.
 */
export function evaluateTriggerCondition(
  condition: FieldCondition,
  task: any,
  metadata?: Record<string, any>
): boolean {
  if (condition.field.startsWith('metadata.')) {
    const metadataKey = condition.field.substring(9);
    const metaValue = metadata?.[metadataKey];
    if (metaValue === undefined || metaValue === null) {
      return false;
    }
    return evaluateFieldCondition({ ...condition, field: '_meta' }, { _meta: metaValue });
  }

  return evaluateFieldCondition(condition, task);
}
