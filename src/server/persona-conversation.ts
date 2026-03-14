/**
 * Persona Conversation Orchestration - Phase 2
 *
 * Production-safe multi-persona dialogue system for ticket collaboration.
 *
 * Features:
 * - Kill switch (pause/resume)
 * - Max iteration limits (default 20 turns per ticket)
 * - Three-tier budget caps (global/ticket/persona)
 * - Circuit breaker (trips at 3x expected spend rate)
 * - Full audit trail
 * - Deadlock detection
 * - Idle timeout
 * - Async event loop
 */

import { readTask, writeTask, withTaskLock, logActivity } from './storage.js';
import { BUDGET_LIMITS, checkAndRecordUsage, getBudgetStatus } from './collaboration-budget.js';

// Configuration constants
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEADLOCK_CHECK_INTERVAL_MS = 120 * 1000; // 120 seconds (must exceed LLM timeout of 90s)
const CIRCUIT_BREAKER_THRESHOLD = 3.0; // 3x expected spend rate

// Budget caps (USD)
export const BUDGET_CAPS = BUDGET_LIMITS;

// Conversation state for a ticket
export interface ConversationState {
  taskId: string;
  status: 'idle' | 'active' | 'paused' | 'completed' | 'failed' | 'budget-exceeded' | 'deadlocked';
  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
  currentIteration: number;
  maxIterations: number;
  lastActivityAt: Date;
  idleTimeoutMs: number;
  participants: string[]; // persona IDs
  waitingOn?: string; // persona ID currently expected to respond
  budgetSpent: number; // USD
  budgetCap: number; // USD (per-ticket cap)
  circuitBreakerTripped: boolean;
  expectedSpendRate: number; // USD per iteration (estimated)
  inLLMCall: boolean; // true when awaiting LLM response (skips deadlock check)
}

// Conversation event for audit trail
export interface ConversationEvent {
  id: string;
  taskId: string;
  timestamp: Date;
  type: 'started' | 'paused' | 'resumed' | 'completed' | 'failed' | 'iteration' | 'persona-response' | 'budget-check' | 'circuit-breaker' | 'deadlock-detected' | 'idle-timeout';
  personaId?: string;
  details: string;
  budgetSpent?: number;
  metadata?: Record<string, any>;
}

// In-memory conversation states (persisted to task.conversationState field)
const activeConversations = new Map<string, ConversationState>();

/**
 * Initialize or retrieve conversation state for a task
 */
export async function initConversation(
  taskId: string,
  participants: string[],
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
  budgetCap: number = BUDGET_CAPS.perTicket
): Promise<ConversationState> {
  return withTaskLock(taskId, async () => {
    const task = await readTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    let state: ConversationState;

    // Terminal statuses that should allow a new conversation to start
    const TERMINAL_STATUSES = ['completed', 'failed', 'budget-exceeded', 'deadlocked'];

    if (task.conversationState) {
      state = deserializeConversationState(task.conversationState);
      
      // If prior conversation had a terminal status, reset to idle to allow new conversation
      if (TERMINAL_STATUSES.includes(state.status)) {
        const previousStatus = state.status;
        console.log(`Prior conversation for ${taskId} had terminal status "${previousStatus}", resetting to idle`);
        state = {
          taskId,
          status: 'idle',
          currentIteration: 0,
          maxIterations,
          lastActivityAt: new Date(),
          idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
          participants,
          budgetSpent: 0,
          budgetCap,
          circuitBreakerTripped: false,
          expectedSpendRate: 0.05,
          inLLMCall: false,
        };
        
        // Persist the reset state to task
        task.conversationState = state;
        await writeTask(task);
        await logConversationEvent({
          taskId,
          type: 'resumed',
          details: `Conversation reset from terminal state "${previousStatus}" and reinitialized`,
          metadata: { previousStatus, participants, maxIterations, budgetCap },
        });
      } else {
        // Apply latest runtime parameters when restoring an active/non-terminal conversation.
        state = {
          ...state,
          participants,
          maxIterations,
          budgetCap,
        };
        task.conversationState = state;
        await writeTask(task);
      }
      
      activeConversations.set(taskId, state);
    } else {
      state = {
        taskId,
        status: 'idle',
        currentIteration: 0,
        maxIterations,
        lastActivityAt: new Date(),
        idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
        participants,
        budgetSpent: 0,
        budgetCap,
        circuitBreakerTripped: false,
        expectedSpendRate: 0.05, // $0.05 per iteration (rough estimate)
        inLLMCall: false,
      };

      task.conversationState = state;
      await writeTask(task);
      activeConversations.set(taskId, state);

      await logConversationEvent({
        taskId,
        type: 'started',
        details: `Conversation initialized with ${participants.length} participants, max ${maxIterations} iterations`,
        metadata: { participants, maxIterations, budgetCap },
      });
    }

    return state;
  });
}

/**
 * Start a conversation (transitions from idle to active)
 */
export async function startConversation(taskId: string): Promise<boolean> {
  return withTaskLock(taskId, async () => {
    const state = activeConversations.get(taskId);
    if (!state) {
      throw new Error(`Conversation state not found for task ${taskId}`);
    }

    if (state.status !== 'idle') {
      console.warn(`Cannot start conversation ${taskId} - current status: ${state.status}`);
      return false;
    }

    // Check global budget
    const budgetStatus = await getBudgetStatus();
    if (budgetStatus.totalCost >= BUDGET_CAPS.globalDaily) {
      state.status = 'budget-exceeded';
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'budget-check',
        details: `Global daily budget exceeded: $${budgetStatus.totalCost.toFixed(2)} / $${BUDGET_CAPS.globalDaily}`,
      });
      return false;
    }

    state.status = 'active';
    state.startedAt = new Date();
    state.lastActivityAt = new Date();

    await persistConversationState(taskId, state, { skipLock: true });
    await logConversationEvent({
      taskId,
      type: 'started',
      details: 'Conversation started',
    });

    return true;
  });
}

/**
 * Pause a conversation (kill switch)
 */
export async function pauseConversation(taskId: string, reason: string = 'Human intervention'): Promise<void> {
  return withTaskLock(taskId, async () => {
    const state = activeConversations.get(taskId);
    if (!state) {
      throw new Error(`Conversation state not found for task ${taskId}`);
    }

    if (state.status !== 'active') {
      console.warn(`Cannot pause conversation ${taskId} - current status: ${state.status}`);
      return;
    }

    state.status = 'paused';
    state.pausedAt = new Date();

    await persistConversationState(taskId, state, { skipLock: true });
    await logConversationEvent({
      taskId,
      type: 'paused',
      details: `Conversation paused: ${reason}`,
    });
  });
}

/**
 * Resume a paused conversation
 */
export async function resumeConversation(taskId: string): Promise<boolean> {
  return withTaskLock(taskId, async () => {
    const state = activeConversations.get(taskId);
    if (!state) {
      throw new Error(`Conversation state not found for task ${taskId}`);
    }

    if (state.status !== 'paused') {
      console.warn(`Cannot resume conversation ${taskId} - current status: ${state.status}`);
      return false;
    }

    // Re-check budgets before resuming
    const budgetStatus = await getBudgetStatus();
    if (budgetStatus.totalCost >= BUDGET_CAPS.globalDaily) {
      state.status = 'budget-exceeded';
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'budget-check',
        details: `Cannot resume - global daily budget exceeded`,
      });
      return false;
    }

    state.status = 'active';
    state.lastActivityAt = new Date();

    await persistConversationState(taskId, state, { skipLock: true });
    await logConversationEvent({
      taskId,
      type: 'resumed',
      details: 'Conversation resumed',
    });

    return true;
  });
}

/**
 * Record a persona response and check for termination conditions
 */
export async function recordPersonaResponse(
  taskId: string,
  personaId: string,
  inputTokens: number,
  outputTokens: number,
  costUSD: number
): Promise<{ shouldContinue: boolean; reason?: string }> {
  return withTaskLock(taskId, async () => {
    const state = activeConversations.get(taskId);
    if (!state) {
      throw new Error(`Conversation state not found for task ${taskId}`);
    }

    // Update budget
    state.budgetSpent += costUSD;
    state.lastActivityAt = new Date();
    state.currentIteration += 1;

    // Record against centralized budget system (global/ticket/persona limits)
    const budgetResult = await checkAndRecordUsage(
      personaId,
      'claude-3-5-sonnet-20241022',
      inputTokens,
      outputTokens,
      taskId
    );
    const tokensUsed = inputTokens + outputTokens;

    await logConversationEvent({
      taskId,
      type: 'persona-response',
      personaId,
      details: `Response recorded: ${tokensUsed} tokens, $${costUSD.toFixed(4)}`,
      budgetSpent: state.budgetSpent,
      metadata: { inputTokens, outputTokens, tokensUsed, costUSD, iteration: state.currentIteration },
    });

    // Check termination conditions (priority order)

    // 1. Human pause (already handled by pauseConversation)
    if (state.status === 'paused') {
      await persistConversationState(taskId, state, { skipLock: true });
      return { shouldContinue: false, reason: 'Paused by human' };
    }

    // 2. Budget exhaustion - centralized budget system
    if (!budgetResult.allowed) {
      state.status = 'budget-exceeded';
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'budget-check',
        personaId,
        details: budgetResult.reason || 'Budget exceeded',
      });
      return { shouldContinue: false, reason: budgetResult.reason || `Budget exceeded for ${personaId}` };
    }

    // 3. Budget exhaustion - per-ticket
    if (state.budgetSpent >= state.budgetCap) {
      state.status = 'budget-exceeded';
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'budget-check',
        details: `Ticket budget exceeded: $${state.budgetSpent.toFixed(2)} / $${state.budgetCap}`,
      });
      return { shouldContinue: false, reason: 'Ticket budget exceeded' };
    }

    // 4. Circuit breaker - detect runaway spending
    const actualSpendRate = state.budgetSpent / Math.max(1, state.currentIteration);
    if (actualSpendRate > state.expectedSpendRate * CIRCUIT_BREAKER_THRESHOLD && state.currentIteration >= 3) {
      state.circuitBreakerTripped = true;
      state.status = 'budget-exceeded';
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'circuit-breaker',
        details: `Circuit breaker tripped: actual rate $${actualSpendRate.toFixed(4)}/iter vs expected $${state.expectedSpendRate.toFixed(4)}/iter (${CIRCUIT_BREAKER_THRESHOLD}x threshold)`,
      });
      return { shouldContinue: false, reason: 'Circuit breaker tripped - spending rate too high' };
    }

    // 5. Max iterations
    if (state.currentIteration >= state.maxIterations) {
      state.status = 'completed';
      state.completedAt = new Date();
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, state, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'completed',
        details: `Max iterations reached: ${state.currentIteration} / ${state.maxIterations}`,
      });
      return { shouldContinue: false, reason: 'Max iterations reached' };
    }

    // Update state
    await persistConversationState(taskId, state, { skipLock: true });

    return { shouldContinue: true };
  });
}

/**
 * Check for idle timeout
 */
export async function checkIdleTimeout(taskId: string): Promise<boolean> {
  const state = activeConversations.get(taskId);
  if (!state || state.status !== 'active') {
    return false;
  }

  const elapsed = Date.now() - state.lastActivityAt.getTime();
  if (elapsed > state.idleTimeoutMs) {
    return withTaskLock(taskId, async () => {
      // Re-check inside the lock: another operation may have advanced activity or changed status
      const lockState = activeConversations.get(taskId);
      if (!lockState || lockState.status !== 'active') {
        return false;
      }
      const elapsedNow = Date.now() - lockState.lastActivityAt.getTime();
      if (elapsedNow <= lockState.idleTimeoutMs) {
        return false; // Activity happened while waiting for the lock
      }
      lockState.status = 'failed';
      lockState.completedAt = new Date();
      activeConversations.delete(taskId); // Clean up memory
      await persistConversationState(taskId, lockState, { skipLock: true });
      await logConversationEvent({
        taskId,
        type: 'idle-timeout',
        details: `Conversation timed out after ${Math.round(elapsedNow / 1000)}s of inactivity`,
      });
      return true;
    });
  }

  return false;
}

/**
 * Detect deadlock (two personas waiting on each other)
 */
export async function detectDeadlock(taskId: string): Promise<boolean> {
  const state = activeConversations.get(taskId);
  if (!state || state.status !== 'active') {
    return false;
  }

  // Skip deadlock check if we're currently in an LLM call
  if (state.inLLMCall) {
    return false;
  }

  // Simple heuristic: if we've had no activity for >120s and we're waiting on someone
  if (state.waitingOn) {
    const elapsed = Date.now() - state.lastActivityAt.getTime();
    if (elapsed > DEADLOCK_CHECK_INTERVAL_MS) {
      return withTaskLock(taskId, async () => {
        // Re-check inside the lock: status or waitingOn may have changed
        const lockState = activeConversations.get(taskId);
        if (!lockState || lockState.status !== 'active' || !lockState.waitingOn) {
          return false;
        }
        const elapsedNow = Date.now() - lockState.lastActivityAt.getTime();
        if (elapsedNow <= DEADLOCK_CHECK_INTERVAL_MS) {
          return false; // Activity happened while waiting for the lock
        }
        lockState.status = 'deadlocked';
        lockState.completedAt = new Date();
        activeConversations.delete(taskId); // Clean up memory
        await persistConversationState(taskId, lockState, { skipLock: true });
        await logConversationEvent({
          taskId,
          type: 'deadlock-detected',
          details: `Deadlock detected: waiting on ${lockState.waitingOn} for ${Math.round(elapsedNow / 1000)}s`,
          metadata: { waitingOn: lockState.waitingOn },
        });
        return true;
      });
    }
  }

  return false;
}

/**
 * Complete a conversation (explicit success)
 */
export async function completeConversation(taskId: string, reason: string = 'Task completed'): Promise<void> {
  return withTaskLock(taskId, async () => {
    const state = activeConversations.get(taskId);
    if (!state) {
      throw new Error(`Conversation state not found for task ${taskId}`);
    }

    state.status = 'completed';
    state.completedAt = new Date();
    activeConversations.delete(taskId); // Clean up memory

    await persistConversationState(taskId, state, { skipLock: true });
    await logConversationEvent({
      taskId,
      type: 'completed',
      details: reason,
    });
  });
}

/**
 * Log a conversation event to the audit trail
 */
async function logConversationEvent(event: Omit<ConversationEvent, 'id' | 'timestamp'>): Promise<void> {
  const fullEvent: ConversationEvent = {
    ...event,
    id: Math.random().toString(36).substr(2, 12),
    timestamp: new Date(),
  };

  // Log to task activity
  await logActivity(
    event.taskId,
    'comment_added', // Using comment_added as the closest match for conversation events
    `[Conversation] ${event.type}: ${fullEvent.details}`,
    'system'
  );

  // Also append to conversation event log file
  // (Implementation detail: could use a separate events file per task)
}

/**
 * Persist conversation state to task
 */
export async function persistConversationState(
  taskId: string,
  state: ConversationState,
  options: { skipLock?: boolean } = {}
): Promise<void> {
  if (!options.skipLock) {
    await withTaskLock(taskId, async () => {
      await persistConversationState(taskId, state, { skipLock: true });
    });
    return;
  }

  const task = await readTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  task.conversationState = state;
  task.updatedAt = new Date();
  await writeTask(task);
}

/**
 * Deserialize conversation state from task storage
 */
function deserializeConversationState(data: any): ConversationState {
  return {
    ...data,
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    pausedAt: data.pausedAt ? new Date(data.pausedAt) : undefined,
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
    lastActivityAt: new Date(data.lastActivityAt),
  };
}

/**
 * Get current conversation state for a task
 */
export function getConversationState(taskId: string): ConversationState | undefined {
  return activeConversations.get(taskId);
}

/**
 * Get conversation state, falling back to disk for completed/terminated conversations.
 * Use in API handlers that need to serve results after the conversation ends.
 */
export async function getConversationStateWithFallback(taskId: string): Promise<ConversationState | undefined> {
  const inMemory = activeConversations.get(taskId);
  if (inMemory) return inMemory;

  // Fall back to disk — completed conversations are removed from activeConversations
  const task = await readTask(taskId);
  if (!task || !task.conversationState) return undefined;

  return deserializeConversationState(task.conversationState);
}

/**
 * Mark conversation as entering LLM call (prevents false deadlock detection)
 */
export function setInLLMCall(taskId: string): void {
  const state = activeConversations.get(taskId);
  if (state) {
    state.inLLMCall = true;
  }
}

/**
 * Mark conversation as exiting LLM call
 */
export function clearInLLMCall(taskId: string): void {
  const state = activeConversations.get(taskId);
  if (state) {
    state.inLLMCall = false;
    state.lastActivityAt = new Date(); // Update activity timestamp
  }
}

/**
 * Get global budget status (from centralized budget storage)
 */
export async function getGlobalBudgetStatus(): Promise<{
  date: string;
  globalSpent: number;
  perPersona: Record<string, number>;
}> {
  const status = await getBudgetStatus();
  const perPersona: Record<string, number> = {};
  Object.entries(status.byPersona).forEach(([personaId, value]) => {
    perPersona[personaId] = value.cost;
  });
  return {
    date: status.date,
    globalSpent: status.totalCost,
    perPersona,
  };
}

/**
 * Background monitor loop - checks for timeouts, deadlocks, etc.
 */
export async function runConversationMonitor(): Promise<void> {
  const tasks = Array.from(activeConversations.keys());

  for (const taskId of tasks) {
    try {
      // Check idle timeout
      const timedOut = await checkIdleTimeout(taskId);
      if (timedOut) {
        console.log(`⏱️ Conversation ${taskId} timed out`);
        continue;
      }

      // Check for deadlock
      const deadlocked = await detectDeadlock(taskId);
      if (deadlocked) {
        console.log(`🔒 Conversation ${taskId} deadlocked`);
      }
    } catch (error) {
      console.error(`Error monitoring conversation ${taskId}:`, error);
    }
  }
}
