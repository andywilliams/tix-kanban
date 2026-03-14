/**
 * Conversation Event Loop - Phase 2
 *
 * Async orchestration of multi-persona conversations on tickets.
 *
 * Features:
 * - Non-blocking persona execution
 * - Turn-based coordination
 * - Automatic termination on safety limits
 * - Integration with conversation state machine
 */

import { Task } from '../client/types/index.js';
import { spawn } from 'child_process';
import { readTask, withTaskLock } from './storage.js';
import { getMessages, addMessage } from './chat-storage.js';
import { getPersona } from './persona-storage.js';
import { buildConversationContext, estimateTokens } from './conversation-context.js';
import {
  initConversation,
  startConversation,
  recordPersonaResponse,
  checkIdleTimeout,
  detectDeadlock,
  completeConversation,
  getConversationState,
  setInLLMCall,
  clearInLLMCall,
  persistConversationState,
  BUDGET_CAPS,
} from './persona-conversation.js';

/**
 * Start a multi-persona conversation for a ticket
 */
async function startTicketConversation(
  taskId: string,
  participantIds: string[],
  options: {
    maxIterations?: number;
    budgetCap?: number;
    idleTimeoutMs?: number;
  } = {}
): Promise<{ started: boolean; reason?: string }> {
  try {
    // Initialize conversation state
    await initConversation(
      taskId,
      participantIds,
      options.maxIterations,
      options.budgetCap
    );

    // Start the conversation
    const started = await startConversation(taskId);

    if (!started) {
      return { started: false, reason: 'Failed to start (check budget or status)' };
    }

    // Kick off the event loop in the background
    runConversationLoop(taskId).catch(error => {
      console.error(`Conversation loop error for ${taskId}:`, error);
    });

    return { started: true };
  } catch (error) {
    console.error(`Failed to start ticket conversation for ${taskId}:`, error);
    return { started: false, reason: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Main conversation loop (runs async until termination)
 */
export async function runConversationLoop(taskId: string): Promise<void> {
  console.log(`🔄 Starting conversation loop for task ${taskId}`);

  while (true) {
    const state = getConversationState(taskId);

    if (!state) {
      console.log(`⚠️ Conversation state not found for ${taskId}, terminating loop`);
      break;
    }

    // Check termination conditions
    if (state.status !== 'active') {
      console.log(`🛑 Conversation ${taskId} terminated: status = ${state.status}`);
      break;
    }

    // Check for idle timeout
    const timedOut = await checkIdleTimeout(taskId);
    if (timedOut) {
      console.log(`⏱️ Conversation ${taskId} timed out`);
      break;
    }

    // Check for deadlock
    const deadlocked = await detectDeadlock(taskId);
    if (deadlocked) {
      console.log(`🔒 Conversation ${taskId} deadlocked`);
      break;
    }

    // Select next persona to speak
    const nextPersonaId = selectNextSpeaker(state);

    if (!nextPersonaId) {
      console.log(`✅ Conversation ${taskId} complete (no more speakers)`);
      await completeConversation(taskId, 'All participants finished');
      break;
    }

    // Attempt to execute persona turn
    const success = await executePersonaTurn(taskId, nextPersonaId);

    // After turn completes, check if conversation was terminated (e.g., budget exceeded, max iterations)
    // Re-fetch state to get the updated status from recordPersonaResponse
    const currentState = getConversationState(taskId);
    if (!currentState || currentState.status !== 'active') {
      console.log(`🛑 Conversation ${taskId} terminated during turn: status = ${currentState?.status}`);
      break;
    }

    if (!success) {
      console.log(`⚠️ Persona ${nextPersonaId} failed to execute turn, stopping loop`);
      break;
    }

    // Update waitingOn for next iteration (round-robin) - set to the NEXT person expected to speak
    // Calculate the person after nextPersonaId in the round-robin
    const currentIndex = state.participants.indexOf(nextPersonaId);
    const nextWaitingOnIndex = (currentIndex + 1) % state.participants.length;
    const nextWaitingOn = state.participants[nextWaitingOnIndex];

    // Persist state with lock to avoid race condition with background monitor
    await withTaskLock(taskId, async () => {
      const lockState = getConversationState(taskId);
      if (lockState && lockState.status === 'active') {
        lockState.waitingOn = nextWaitingOn;
        await persistConversationState(taskId, lockState);
      }
    });

    // Small delay to prevent tight loops
    await sleep(1000);
  }

  console.log(`✅ Conversation loop finished for task ${taskId}`);
}

/**
 * Select the next persona to speak (round-robin for now, can be enhanced)
 */
function selectNextSpeaker(state: any): string | null {
  if (!state.participants || state.participants.length === 0) {
    return null;
  }

  // If waitingOn is set, that IS the next speaker (the loop already advanced it)
  if (state.waitingOn && state.participants.includes(state.waitingOn)) {
    return state.waitingOn;
  }

  // No waitingOn set yet — start with the first participant
  return state.participants[0];
}

/**
 * Execute a single persona turn
 */
async function executePersonaTurn(taskId: string, personaId: string): Promise<boolean> {
  try {
    // Simplified turn-taking for Phase 2 (Phase 1 turn-taking will be integrated when merged)
    // For now, we rely on the conversation state's waitingOn field

    console.log(`🎤 ${personaId} starting turn for task ${taskId}`);

    try {
      // Load task
      const task = await readTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Load persona
      const persona = await getPersona(personaId);
      if (!persona) {
        throw new Error(`Persona ${personaId} not found`);
      }

      // Get conversation messages
      const channelId = `task-${taskId}`;
      const messages = await getMessages(channelId, 50);

      // Build context
      const { summary, recentMessages, fullContext, estimatedTokens } = await buildConversationContext(
        messages,
        task.description
      );

      console.log(`📊 Context for ${personaId}: ${estimatedTokens} tokens, ${recentMessages.length} recent messages`);

      // Generate persona response (mark as in LLM call to prevent false deadlock detection)
      setInLLMCall(taskId);
      let response;
      try {
        response = await generatePersonaResponse(
          persona,
          task,
          fullContext || summary,
          recentMessages
        );
      } finally {
        clearInLLMCall(taskId);
      }

      if (!response || response.text.trim().length === 0) {
        console.log(`⚠️ ${personaId} generated empty response`);
        return false;
      }

      // Post message
      await addMessage(
        channelId,
        persona.name,
        'persona',
        response.text
      );

      // Record response and check for termination
      const { shouldContinue, reason } = await recordPersonaResponse(
        taskId,
        personaId,
        response.tokensUsed,
        response.costUSD
      );

      if (!shouldContinue) {
        console.log(`🛑 Conversation ${taskId} terminating: ${reason}`);
        return false;
      }

      console.log(`✅ ${personaId} completed turn for ${taskId}`);
      return true;

    } catch (innerError) {
      console.error(`Error during persona turn:`, innerError);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error executing turn for ${personaId} on ${taskId}:`, error);
    return false;
  }
}

/**
 * Generate a response from a persona (placeholder - integrate with actual AI)
 */
async function generatePersonaResponse(
  persona: any,
  task: Task,
  conversationSummary: string,
  recentMessages: any[]
): Promise<{ text: string; tokensUsed: number; costUSD: number }> {
  // Build prompt
  const prompt = buildPersonaPrompt(persona, task, conversationSummary, recentMessages);

  // Call AI (using Claude CLI for now)
  const response = await callClaude(prompt, 90000); // 90s timeout

  // Estimate tokens and cost
  const tokensUsed = estimateTokens(prompt + response);
  const costUSD = estimateCost(tokensUsed);

  return {
    text: response,
    tokensUsed,
    costUSD,
  };
}

/**
 * Build prompt for a persona
 * Note: conversationSummary (fullContext) already contains task description, summary of older messages,
 * and recent messages. We don't need to add them again.
 */
function buildPersonaPrompt(
  persona: any,
  _task: Task, // Kept for signature compatibility - task info is in conversationSummary
  conversationSummary: string,
  _recentMessages: any[] // Kept for signature compatibility - already in conversationSummary
): string {
  const parts: string[] = [];

  parts.push(`# Persona: ${persona.name} (${persona.emoji})`);
  parts.push(`${persona.description}`);
  parts.push('');
  
  if (persona.prompt) {
    parts.push('## Your Instructions');
    parts.push(persona.prompt);
    parts.push('');
  }

  // Full context already includes task description, summary of older messages, and recent messages
  if (conversationSummary) {
    parts.push('## Conversation Context');
    parts.push(conversationSummary);
    parts.push('');
  }

  parts.push('## Your Turn');
  parts.push('Respond naturally as your persona. Focus on making progress on the task.');
  parts.push('Keep your response concise (1-3 sentences typically).');
  parts.push('If you believe the task is complete or you have nothing to add, say "DONE".');
  parts.push('');
  parts.push('Your response:');

  return parts.join('\n');
}

/**
 * Call Claude CLI
 */
function callClaude(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const claude = spawn('claude', ['-p', '-', '--max-turns', '1'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    claude.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    claude.on('close', (code: number | null) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude call failed: ${stderr || 'No output'}`));
      }
    });

    claude.on('error', (err: Error) => {
      reject(err);
    });

    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

/**
 * Estimate cost (rough approximation for Sonnet)
 */
function estimateCost(tokens: number): number {
  // Sonnet 3.5: $3/1M input, $15/1M output
  // Rough average: $9/1M tokens
  return (tokens / 1_000_000) * 9.0;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Trigger conversation for a ticket (exposed API endpoint)
 */
export async function triggerConversation(
  taskId: string,
  personaIds?: string[],
  options?: { maxIterations?: number; budgetCap?: number }
): Promise<any> {
  const task = await readTask(taskId);

  if (!task) {
    return { error: 'Task not found' };
  }

  // Default participants: assignee/persona if set, otherwise all relevant personas
  let participants = personaIds;

  if (!participants && task.persona) {
    participants = [task.persona];
  }

  if (!participants || participants.length === 0) {
    return { error: 'No participants specified' };
  }

  const result = await startTicketConversation(taskId, participants, {
    maxIterations: options?.maxIterations ?? 20,
    budgetCap: options?.budgetCap ?? BUDGET_CAPS.perTicket,
  });

  return result;
}
