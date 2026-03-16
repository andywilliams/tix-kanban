/**
 * Phase 3 Integration Tests
 */

import { describe, it, beforeEach, expect } from 'vitest';
import {
  registerTrigger,
  registerOrchestrator,
  resolvePersonaInvocation,
  clearAllTriggers,
  getTriggeredPersonas,
  type TriggerEvent,
  type PersonaTrigger,
} from './persona-phase3.js';

describe('Phase 3: Event Triggers', () => {
  beforeEach(() => {
    clearAllTriggers();
  });

  it('should register a trigger and make it retrievable', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'qa-reviewer',
      eventTypes: ['pr_opened'],
      priority: 100,
    };
    await registerTrigger(trigger);
    const subscribers = getTriggeredPersonas('pr_opened');
    expect(subscribers).toHaveLength(1);
    expect(subscribers[0].personaId).toBe('qa-reviewer');
    expect(subscribers[0].priority).toBe(100);
  });

  it('should register a conditional trigger and preserve conditions', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'backend-specialist',
      eventTypes: ['test_failure'],
      conditions: [
        { field: 'tags', operator: 'contains', value: 'backend' },
      ],
      priority: 100,
    };
    await registerTrigger(trigger);
    const subscribers = getTriggeredPersonas('test_failure');
    expect(subscribers).toHaveLength(1);
    expect(subscribers[0].personaId).toBe('backend-specialist');
    expect(subscribers[0].conditions).toEqual([
      { field: 'tags', operator: 'contains', value: 'backend' },
    ]);
  });

  it('should order multiple triggers by priority (highest first)', async () => {
    const high: PersonaTrigger = { personaId: 'security-scanner', eventTypes: ['pr_opened'], priority: 200 };
    const low: PersonaTrigger = { personaId: 'qa-reviewer', eventTypes: ['pr_opened'], priority: 100 };
    await registerTrigger(high);
    await registerTrigger(low);
    const subscribers = getTriggeredPersonas('pr_opened');
    expect(subscribers).toHaveLength(2);
    expect(subscribers[0].personaId).toBe('security-scanner');
    expect(subscribers[0].priority).toBe(200);
    expect(subscribers[1].personaId).toBe('qa-reviewer');
    expect(subscribers[1].priority).toBe(100);
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
