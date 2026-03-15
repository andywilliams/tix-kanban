/**
 * Phase 3 Integration Tests
 */

import { describe, it, beforeEach, expect } from 'vitest';
import {
  registerTrigger,
  registerOrchestrator,
  resolvePersonaInvocation,
  clearAllTriggers,
  type TriggerEvent,
  type PersonaTrigger,
} from './persona-phase3.js';

describe('Phase 3: Event Triggers', () => {
  beforeEach(() => {
    clearAllTriggers();
  });

  it('should register a trigger without throwing', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'qa-reviewer',
      eventTypes: ['pr_opened'],
      priority: 100,
    };
    await expect(registerTrigger(trigger)).resolves.not.toThrow();
  });

  it('should register a conditional trigger without throwing', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'backend-specialist',
      eventTypes: ['test_failure'],
      conditions: [
        { field: 'tags', operator: 'contains', value: 'backend' },
      ],
      priority: 100,
    };
    await expect(registerTrigger(trigger)).resolves.not.toThrow();
  });

  it('should register multiple triggers with different priorities', async () => {
    const high: PersonaTrigger = { personaId: 'security-scanner', eventTypes: ['pr_opened'], priority: 200 };
    const low: PersonaTrigger = { personaId: 'qa-reviewer', eventTypes: ['pr_opened'], priority: 100 };
    await expect(registerTrigger(high)).resolves.not.toThrow();
    await expect(registerTrigger(low)).resolves.not.toThrow();
  });
});

describe('Phase 3: Orchestrator Pattern', () => {
  it('should register orchestrator config without throwing', () => {
    expect(() =>
      registerOrchestrator({
        personaId: 'tech-lead',
        canDelegate: true,
        specialists: [
          { specialty: 'frontend', personaIds: ['react-specialist'] },
          { specialty: 'backend', personaIds: ['api-developer'] },
        ],
      })
    ).not.toThrow();
  });
});

describe('Phase 3: Composable Addressing', () => {
  it('should prioritize human override', async () => {
    const result = await resolvePersonaInvocation('TEST111', {
      humanOverride: 'specific-persona',
      directMention: 'mentioned-persona',
      event: { type: 'pr_opened', taskId: 'TEST111', timestamp: new Date() },
    });
    expect(result.mode).toBe('human-override');
    expect(result.personas).toEqual(['specific-persona']);
    expect(result.parallel).toBe(false);
  });

  it('should fall back to direct mention when no override', async () => {
    const result = await resolvePersonaInvocation('TEST222', {
      directMention: 'mentioned-persona',
      event: { type: 'pr_opened', taskId: 'TEST222', timestamp: new Date() },
    });
    expect(result.mode).toBe('direct-mention');
    expect(result.personas).toEqual(['mentioned-persona']);
  });

  it('should return silence when no invocation method matches', async () => {
    const result = await resolvePersonaInvocation('TEST333', {});
    expect(result.mode).toBe('silence');
    expect(result.personas).toEqual([]);
  });
});
