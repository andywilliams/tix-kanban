/**
 * Phase 3 Unit Tests
 *
 * Tests that rely on task storage (emitEvent, startParallelExecution,
 * orchestrateTask) are marked todo and must be run as integration tests
 * against a real storage backend.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerTrigger,
  clearAllTriggers,
  registerOrchestrator,
  resolvePersonaInvocation,
  type TriggerEvent,
  type PersonaTrigger,
} from './persona-phase3.js';
import { getTriggeredPersonas } from './event-triggers.js';
import { isOrchestrator } from './orchestrator.js';

describe('Phase 3: Event Triggers', () => {
  beforeEach(() => {
    clearAllTriggers();
  });

  it('should register a persona and make it retrievable by event type', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'qa-reviewer',
      eventTypes: ['pr_opened'],
      priority: 100,
    };

    await registerTrigger(trigger);

    const subscribers = getTriggeredPersonas('pr_opened');
    assert.strictEqual(subscribers.length, 1);
    assert.strictEqual(subscribers[0].personaId, 'qa-reviewer');
  });

  it('should register a trigger with conditions without throwing', async () => {
    const trigger: PersonaTrigger = {
      personaId: 'backend-specialist',
      eventTypes: ['test_failure'],
      conditions: [
        { field: 'tags', operator: 'contains', value: 'backend' }
      ],
      priority: 100,
    };

    await assert.doesNotReject(() => registerTrigger(trigger));

    const subscribers = getTriggeredPersonas('test_failure');
    assert.strictEqual(subscribers.length, 1);
    assert.strictEqual(subscribers[0].personaId, 'backend-specialist');
    assert.strictEqual(subscribers[0].conditions?.length, 1);
  });

  it('should return subscribers in priority order (highest first)', async () => {
    const highPriority: PersonaTrigger = {
      personaId: 'security-scanner',
      eventTypes: ['pr_opened'],
      priority: 200,
    };

    const lowPriority: PersonaTrigger = {
      personaId: 'qa-reviewer',
      eventTypes: ['pr_opened'],
      priority: 100,
    };

    await registerTrigger(lowPriority);
    await registerTrigger(highPriority);

    const subscribers = getTriggeredPersonas('pr_opened');
    assert.strictEqual(subscribers.length, 2);
    assert.strictEqual(subscribers[0].personaId, 'security-scanner');
    assert.strictEqual(subscribers[1].personaId, 'qa-reviewer');
  });

  it('should emit event and return matching personas (integration, requires storage)', { todo: true }, async () => {
    // Requires real task storage — run as an integration test.
  });
});

describe('Phase 3: Parallel Execution', () => {
  it('should start parallel execution (integration, requires storage)', { todo: true }, async () => {
    // Requires getTask() from storage — run as an integration test.
  });

  it('should merge changes from multiple personas (integration, requires storage)', { todo: true }, async () => {
    // Requires full parallel execution pipeline — run as an integration test.
  });

  it('should handle conflicts with last-write-wins (integration, requires storage)', { todo: true }, async () => {
    // Requires full parallel execution pipeline — run as an integration test.
  });
});

describe('Phase 3: Orchestrator Pattern', () => {
  it('should register orchestrator config and be recognised as orchestrator', () => {
    registerOrchestrator({
      personaId: 'tech-lead',
      canDelegate: true,
      specialists: [
        { specialty: 'frontend', personaIds: ['react-specialist'] },
        { specialty: 'backend', personaIds: ['api-developer'] },
      ],
    });

    assert.strictEqual(isOrchestrator('tech-lead'), true);
    assert.strictEqual(isOrchestrator('qa-reviewer'), false);
  });

  it('should create orchestrated task with subtasks (integration, requires storage)', { todo: true }, async () => {
    // Requires getTask() / updateTask() from storage — run as an integration test.
  });

  it('should auto-assign specialists (integration, requires storage)', { todo: true }, async () => {
    // Requires storage — run as an integration test.
  });
});

describe('Phase 3: Composable Addressing', () => {
  it('should prioritize human override', async () => {
    const result = await resolvePersonaInvocation('TEST111', {
      humanOverride: 'specific-persona',
      directMention: 'mentioned-persona',
      event: { type: 'pr_opened', taskId: 'TEST111', timestamp: new Date() },
    });

    assert.strictEqual(result.mode, 'human-override');
    assert.deepStrictEqual(result.personas, ['specific-persona']);
    assert.strictEqual(result.parallel, false);
  });

  it('should fall back to direct mention when no override', async () => {
    const result = await resolvePersonaInvocation('TEST222', {
      directMention: 'mentioned-persona',
      event: { type: 'pr_opened', taskId: 'TEST222', timestamp: new Date() },
    });

    assert.strictEqual(result.mode, 'direct-mention');
    assert.deepStrictEqual(result.personas, ['mentioned-persona']);
  });

  it('should use event trigger when no override or mention (integration, requires storage)', { todo: true }, async () => {
    // emitEvent() requires task storage — run as an integration test.
  });

  it('should return silence when no invocation method matches', async () => {
    const result = await resolvePersonaInvocation('TEST333', {});

    assert.strictEqual(result.mode, 'silence');
    assert.deepStrictEqual(result.personas, []);
  });
});
