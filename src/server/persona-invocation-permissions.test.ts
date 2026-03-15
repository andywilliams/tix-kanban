import { describe, it, expect, beforeEach } from 'vitest';
import {
  setInvocationPermissions,
  getInvocationPermissions,
  removeInvocationPermissions,
  checkInvocationPermission,
  enforceInvocationPermission,
  registerActiveInvocation,
  unregisterActiveInvocation,
  getActiveInvocationCount,
  clearActiveInvocations,
  clearAllPermissions,
  validatePermissions,
  buildPermissionGraph,
} from './persona-invocation-permissions.js';

describe('persona-invocation-permissions', () => {
  beforeEach(() => {
    clearAllPermissions();
  });

  describe('permission management', () => {
    it('should set and get permissions', () => {
      const permission = {
        personaId: 'orchestrator',
        canInvoke: ['specialist-a', 'specialist-b'],
      };

      setInvocationPermissions(permission);

      const retrieved = getInvocationPermissions('orchestrator');
      expect(retrieved).toEqual(permission);
    });

    it('should remove permissions', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a'],
      });

      removeInvocationPermissions('orchestrator');

      const retrieved = getInvocationPermissions('orchestrator');
      expect(retrieved).toBeNull();
    });

    it('should return null for non-existent persona', () => {
      const retrieved = getInvocationPermissions('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('permission checking', () => {
    it('should allow explicit permission', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a', 'specialist-b'],
      });

      const result = checkInvocationPermission({
        invoker: 'orchestrator',
        target: 'specialist-a',
      });

      expect(result.allowed).toBe(true);
      expect(result.metadata?.hasExplicitPermission).toBe(true);
    });

    it('should deny when target not in allow list', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a'],
      });

      const result = checkInvocationPermission({
        invoker: 'orchestrator',
        target: 'specialist-b',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed to invoke');
    });

    it('should deny when no permissions configured', () => {
      const result = checkInvocationPermission({
        invoker: 'unknown-persona',
        target: 'specialist-a',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('no invocation permissions configured');
    });

    it('should allow wildcard permissions', () => {
      setInvocationPermissions({
        personaId: 'admin',
        canInvoke: [],
        canInvokeAll: true,
      });

      const result = checkInvocationPermission({
        invoker: 'admin',
        target: 'any-persona',
      });

      expect(result.allowed).toBe(true);
      expect(result.metadata?.hasWildcardPermission).toBe(true);
    });

    it('should deny self-invocation', () => {
      setInvocationPermissions({
        personaId: 'persona-a',
        canInvoke: ['persona-a'], // Explicitly allows self
      });

      const result = checkInvocationPermission({
        invoker: 'persona-a',
        target: 'persona-a',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot invoke themselves');
    });
  });

  describe('concurrent invocation limits', () => {
    it('should enforce max concurrent invocations', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a', 'specialist-b', 'specialist-c'],
        maxConcurrentInvocations: 2,
      });

      // Register 2 active invocations
      registerActiveInvocation('orchestrator', 'specialist-a');
      registerActiveInvocation('orchestrator', 'specialist-b');

      // Third should be denied
      const result = checkInvocationPermission({
        invoker: 'orchestrator',
        target: 'specialist-c',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('reached max concurrent invocations');
    });

    it('should allow invocation after unregistering', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a', 'specialist-b'],
        maxConcurrentInvocations: 1,
      });

      // Register active invocation
      registerActiveInvocation('orchestrator', 'specialist-a');

      // Second should be denied
      let result = checkInvocationPermission({
        invoker: 'orchestrator',
        target: 'specialist-b',
      });
      expect(result.allowed).toBe(false);

      // Unregister first
      unregisterActiveInvocation('orchestrator', 'specialist-a');

      // Now second should be allowed
      result = checkInvocationPermission({
        invoker: 'orchestrator',
        target: 'specialist-b',
      });
      expect(result.allowed).toBe(true);
    });

    it('should track active invocation count', () => {
      registerActiveInvocation('orchestrator', 'specialist-a');
      registerActiveInvocation('orchestrator', 'specialist-b');

      const count = getActiveInvocationCount('orchestrator');
      expect(count).toBe(2);
    });

    it('should clear all active invocations for a persona', () => {
      registerActiveInvocation('orchestrator', 'specialist-a');
      registerActiveInvocation('orchestrator', 'specialist-b');

      clearActiveInvocations('orchestrator');

      const count = getActiveInvocationCount('orchestrator');
      expect(count).toBe(0);
    });
  });

  describe('enforceInvocationPermission', () => {
    it('should not throw when permission granted', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a'],
      });

      expect(() => {
        enforceInvocationPermission({
          invoker: 'orchestrator',
          target: 'specialist-a',
        });
      }).not.toThrow();
    });

    it('should throw when permission denied', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a'],
      });

      expect(() => {
        enforceInvocationPermission({
          invoker: 'orchestrator',
          target: 'specialist-b',
        });
      }).toThrow('Invocation denied');
    });
  });

  describe('validation', () => {
    it('should validate that persona IDs exist', () => {
      const permissions = [
        {
          personaId: 'orchestrator',
          canInvoke: ['specialist-a', 'specialist-b'],
        },
      ];

      const validIds = new Set(['orchestrator', 'specialist-a']);

      const errors = validatePermissions(permissions, validIds);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('specialist-b');
    });

    it('should validate invoker exists', () => {
      const permissions = [
        {
          personaId: 'non-existent',
          canInvoke: ['specialist-a'],
        },
      ];

      const validIds = new Set(['specialist-a']);

      const errors = validatePermissions(permissions, validIds);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('non-existent');
    });

    it('should skip target validation for wildcard permissions', () => {
      const permissions = [
        {
          personaId: 'admin',
          canInvoke: [],
          canInvokeAll: true,
        },
      ];

      const validIds = new Set(['admin']);

      const errors = validatePermissions(permissions, validIds);

      expect(errors).toHaveLength(0);
    });
  });

  describe('permission graph', () => {
    it('should build permission graph', () => {
      setInvocationPermissions({
        personaId: 'orchestrator',
        canInvoke: ['specialist-a', 'specialist-b'],
      });

      setInvocationPermissions({
        personaId: 'admin',
        canInvoke: [],
        canInvokeAll: true,
      });

      const graph = buildPermissionGraph();

      expect(graph).toHaveLength(2);
      expect(graph).toContainEqual({
        id: 'orchestrator',
        canInvokeAll: false,
        targets: ['specialist-a', 'specialist-b'],
      });
      expect(graph).toContainEqual({
        id: 'admin',
        canInvokeAll: true,
        targets: [],
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty allow list', () => {
      setInvocationPermissions({
        personaId: 'restricted',
        canInvoke: [],
      });

      const result = checkInvocationPermission({
        invoker: 'restricted',
        target: 'any-persona',
      });

      expect(result.allowed).toBe(false);
    });

    it('should handle multiple active invocations with same target', () => {
      registerActiveInvocation('orchestrator', 'specialist-a');
      registerActiveInvocation('orchestrator', 'specialist-a'); // Duplicate

      const count = getActiveInvocationCount('orchestrator');
      // Set should deduplicate, so count should be 1
      expect(count).toBe(1);
    });

    it('should handle unregistering non-existent invocation', () => {
      expect(() => {
        unregisterActiveInvocation('orchestrator', 'specialist-a');
      }).not.toThrow();
    });
  });
});
