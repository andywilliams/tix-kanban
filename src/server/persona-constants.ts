/**
 * Shared Persona Constants
 *
 * Common constants used across persona-related modules.
 */

import type { PersonaTriggers } from '../client/types/index.js';

/**
 * Built-in default trigger configurations for well-known persona IDs.
 * These are merged with (and overridden by) any explicit YAML trigger config.
 */
export const BUILTIN_TRIGGER_DEFAULTS: Record<string, PersonaTriggers> = {
  'qa-reviewer': { onPROpened: true },
  'tech-writer': { onPRMerged: true },
};
