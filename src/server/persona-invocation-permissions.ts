import { Persona } from '../client/types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InvocationPermission {
  /** Persona ID that can invoke others */
  personaId: string;
  /** Array of persona IDs this persona is allowed to invoke */
  canInvoke: string[];
  /** If true, this persona can invoke ANY other persona */
  canInvokeAll?: boolean;
  /** Optional: maximum number of concurrent invocations */
  maxConcurrentInvocations?: number;
}

export interface InvocationAttempt {
  /** Persona attempting to invoke */
  invoker: string;
  /** Persona being invoked */
  target: string;
  /** Context of the invocation (task ID, etc.) */
  context?: Record<string, unknown>;
}

export interface InvocationResult {
  /** Whether the invocation is allowed */
  allowed: boolean;
  /** Reason if denied */
  reason?: string;
  /** Metadata about the permission check */
  metadata?: {
    hasExplicitPermission: boolean;
    hasWildcardPermission: boolean;
    concurrentInvocations?: number;
    maxConcurrent?: number;
  };
}

// ── Permission Storage ───────────────────────────────────────────────────────

const invocationPermissions: Map<string, InvocationPermission> = new Map();

// Track active invocations for concurrent limit enforcement.
// Maps invoker persona ID → total number of currently active invocations.
// A plain counter (not a Set<targetId>) is used so that the same invoker
// calling the same target concurrently (e.g. for two different tasks) is
// counted correctly. Using Set<string> would collapse duplicate target IDs
// into one entry, undercounting concurrent calls and allowing the limit to
// be exceeded.
const activeInvocations: Map<string, number> = new Map();

// ── Permission Management ────────────────────────────────────────────────────

/**
 * Set invocation permissions for a persona
 */
export function setInvocationPermissions(
  permission: InvocationPermission
): void {
  invocationPermissions.set(permission.personaId, permission);
  console.log(
    `[invocation-permissions] Set permissions for ${permission.personaId}: ` +
    `can invoke ${permission.canInvokeAll ? 'ALL' : permission.canInvoke.join(', ')}`
  );
}

/**
 * Get invocation permissions for a persona
 */
export function getInvocationPermissions(
  personaId: string
): InvocationPermission | null {
  return invocationPermissions.get(personaId) || null;
}

/**
 * Remove invocation permissions for a persona
 */
export function removeInvocationPermissions(personaId: string): void {
  invocationPermissions.delete(personaId);
  console.log(`[invocation-permissions] Removed permissions for ${personaId}`);
}

/**
 * Check if a persona can invoke another persona
 */
export function checkInvocationPermission(
  attempt: InvocationAttempt
): InvocationResult {
  const { invoker, target } = attempt;

  // Cannot invoke self (prevent infinite loops)
  if (invoker === target) {
    return {
      allowed: false,
      reason: 'Personas cannot invoke themselves',
    };
  }

  // Get permissions for the invoker
  const permissions = invocationPermissions.get(invoker);

  // If no permissions set, default to DENY (security-first approach)
  if (!permissions) {
    return {
      allowed: false,
      reason: `Persona "${invoker}" has no invocation permissions configured`,
      metadata: {
        hasExplicitPermission: false,
        hasWildcardPermission: false,
      },
    };
  }

  // Check wildcard permission (but still enforce concurrent limit if set)
  if (permissions.canInvokeAll) {
    if (permissions.maxConcurrentInvocations !== undefined) {
      const active = activeInvocations.get(invoker) || 0;
      if (active >= permissions.maxConcurrentInvocations) {
        return {
          allowed: false,
          reason: `Persona "${invoker}" has reached max concurrent invocations ` +
                  `(${active}/${permissions.maxConcurrentInvocations})`,
          metadata: {
            hasExplicitPermission: false,
            hasWildcardPermission: true,
            concurrentInvocations: active,
            maxConcurrent: permissions.maxConcurrentInvocations,
          },
        };
      }
    }
    return {
      allowed: true,
      metadata: {
        hasExplicitPermission: false,
        hasWildcardPermission: true,
      },
    };
  }

  // Check explicit permission list
  const hasExplicitPermission = permissions.canInvoke.includes(target);
  
  if (!hasExplicitPermission) {
    return {
      allowed: false,
      reason: `Persona "${invoker}" is not allowed to invoke "${target}". ` +
              `Allowed targets: ${permissions.canInvoke.join(', ')}`,
      metadata: {
        hasExplicitPermission: false,
        hasWildcardPermission: false,
      },
    };
  }

  // Check concurrent invocation limit if set
  if (permissions.maxConcurrentInvocations !== undefined) {
    const active = activeInvocations.get(invoker) || 0;
    if (active >= permissions.maxConcurrentInvocations) {
      return {
        allowed: false,
        reason: `Persona "${invoker}" has reached max concurrent invocations ` +
                `(${active}/${permissions.maxConcurrentInvocations})`,
        metadata: {
          hasExplicitPermission: true,
          hasWildcardPermission: false,
          concurrentInvocations: active,
          maxConcurrent: permissions.maxConcurrentInvocations,
        },
      };
    }
  }

  // Permission granted
  return {
    allowed: true,
    metadata: {
      hasExplicitPermission: true,
      hasWildcardPermission: false,
    },
  };
}

/**
 * Enforce invocation permission (throws on denial)
 */
export function enforceInvocationPermission(
  attempt: InvocationAttempt
): void {
  const result = checkInvocationPermission(attempt);
  if (!result.allowed) {
    throw new Error(
      `Invocation denied: ${result.reason}`
    );
  }
}

/**
 * Register an active invocation (for concurrent limit tracking).
 * Increments the counter for the invoker so that concurrent calls
 * to the same target persona are each counted individually.
 */
export function registerActiveInvocation(
  invoker: string,
  _target: string
): void {
  activeInvocations.set(invoker, (activeInvocations.get(invoker) || 0) + 1);
}

/**
 * Unregister an active invocation.
 * Decrements the counter; removes the entry when it reaches zero.
 */
export function unregisterActiveInvocation(
  invoker: string,
  _target: string
): void {
  const current = activeInvocations.get(invoker);
  if (current === undefined) return;
  if (current <= 1) {
    activeInvocations.delete(invoker);
  } else {
    activeInvocations.set(invoker, current - 1);
  }
}

/**
 * Get count of active invocations for a persona
 */
export function getActiveInvocationCount(personaId: string): number {
  return activeInvocations.get(personaId) || 0;
}

/**
 * Clear all active invocations for a persona
 */
export function clearActiveInvocations(personaId: string): void {
  activeInvocations.delete(personaId);
}

// ── Bulk Operations ──────────────────────────────────────────────────────────

/**
 * Load permissions from persona YAML definitions
 * This extends the YAML schema to support an 'invocations' field
 */
export function loadPermissionsFromPersonas(personas: Persona[]): void {
  personas.forEach(persona => {
    // Check if persona has invocation configuration
    // This would be an extension to the PersonaYamlSchema
    const personaAny = persona as any;
    
    if (personaAny.invocations) {
      setInvocationPermissions({
        personaId: persona.id,
        canInvoke: personaAny.invocations.allow || [],
        canInvokeAll: personaAny.invocations.allowAll || false,
        maxConcurrentInvocations: personaAny.invocations.maxConcurrent,
      });
    }
  });
}

/**
 * Get all configured permissions (for debugging/admin)
 */
export function getAllPermissions(): InvocationPermission[] {
  return Array.from(invocationPermissions.values());
}

/**
 * Clear all permissions (useful for testing)
 */
export function clearAllPermissions(): void {
  invocationPermissions.clear();
  activeInvocations.clear();
  console.log('[invocation-permissions] Cleared all permissions');
}

// ── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate that all persona IDs in permissions exist
 */
export function validatePermissions(
  permissions: InvocationPermission[],
  validPersonaIds: Set<string>
): string[] {
  const errors: string[] = [];

  permissions.forEach(permission => {
    // Check invoker exists
    if (!validPersonaIds.has(permission.personaId)) {
      errors.push(
        `Permission references non-existent invoker: ${permission.personaId}`
      );
    }

    // Check targets exist (if not wildcard)
    if (!permission.canInvokeAll) {
      permission.canInvoke.forEach(targetId => {
        if (!validPersonaIds.has(targetId)) {
          errors.push(
            `Permission for ${permission.personaId} references ` +
            `non-existent target: ${targetId}`
          );
        }
      });
    }
  });

  return errors;
}

/**
 * Build a permission graph for visualization
 */
export interface PermissionGraphNode {
  id: string;
  canInvokeAll: boolean;
  targets: string[];
}

export function buildPermissionGraph(): PermissionGraphNode[] {
  return Array.from(invocationPermissions.values()).map(permission => ({
    id: permission.personaId,
    canInvokeAll: permission.canInvokeAll || false,
    targets: permission.canInvoke,
  }));
}
