/**
 * API Endpoints for Persona Conversation Control
 */

import { Request, Response } from 'express';
import {
  pauseConversation,
  resumeConversation,
  getConversationStateWithFallback,
  getGlobalBudgetStatus,
  BUDGET_CAPS,
} from './persona-conversation.js';
import { triggerConversation, runConversationLoop } from './conversation-loop.js';

/**
 * POST /api/conversation/:taskId/start
 * Start a multi-persona conversation for a task
 */
export async function startConversationHandler(req: Request, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { personaIds, maxIterations, budgetCap } = req.body;

    if (!personaIds || !Array.isArray(personaIds) || personaIds.length === 0) {
      res.status(400).json({ error: 'personaIds array required' });
      return;
    }

    const result = await triggerConversation(taskId, personaIds, { maxIterations, budgetCap });

    if (result.error) {
      res.status(400).json(result);
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/conversation/:taskId/pause
 * Pause an active conversation (kill switch)
 */
export async function pauseConversationHandler(req: Request, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { reason } = req.body;

    await pauseConversation(taskId, reason || 'Manual pause');

    res.json({ success: true, message: `Conversation ${taskId} paused` });
  } catch (error) {
    console.error('Error pausing conversation:', error);
    res.status(500).json({ error: (error as Error).message });
  }
}

/**
 * POST /api/conversation/:taskId/resume
 * Resume a paused conversation
 */
export async function resumeConversationHandler(req: Request, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;

    const resumed = await resumeConversation(taskId);

    if (resumed) {
      // Restart the conversation loop
      runConversationLoop(taskId).catch(error => {
        console.error(`Error restarting conversation loop for ${taskId}:`, error);
      });
      res.json({ success: true, message: `Conversation ${taskId} resumed` });
    } else {
      res.status(400).json({ error: 'Could not resume conversation (check budget or status)' });
    }
  } catch (error) {
    console.error('Error resuming conversation:', error);
    res.status(500).json({ error: (error as Error).message });
  }
}

/**
 * GET /api/conversation/:taskId
 * Get conversation state for a task
 */
export async function getConversationStateHandler(req: Request, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;

    // Falls back to disk for completed/terminated conversations no longer in memory
    const state = await getConversationStateWithFallback(taskId);

    if (!state) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(state);
  } catch (error) {
    console.error('Error getting conversation state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/conversation/budget
 * Get global budget status
 */
export async function getBudgetStatusHandler(_req: Request, res: Response): Promise<void> {
  try {
    const status = await getGlobalBudgetStatus();

    res.json({
      ...status,
      caps: BUDGET_CAPS,
      remaining: {
        global: BUDGET_CAPS.globalDaily - status.globalSpent,
        perTicket: BUDGET_CAPS.perTicket,
        perPersona: BUDGET_CAPS.perPersona,
      },
    });
  } catch (error) {
    console.error('Error getting budget status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
