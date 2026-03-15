/**
 * Shared Persona Constants
 * 
 * Common constants used across persona-related modules.
 */

import type { PersonaTriggers } from '../client/types/index.js';

/**
 * Built-in default trigger configurations for persona IDs
 * that don't have explicit YAML files.
 */
export const BUILTIN_TRIGGER_DEFAULTS: Record<string, PersonaTriggers> = {
  'qa-reviewer': { onPROpened: true },
  'tech-writer': { onPRMerged: true },
};