/**
 * Direct Execution Service
 * 
 * Handles direct action execution without creating formal tickets
 * Spawns sub-agents to do work and reports back in chat
 */

import { spawn } from 'child_process';
import { Persona } from '../client/types/index.js';
import { addMessage } from './chat-storage.js';
import { IntentResult } from './intent-detection.js';

export interface ExecutionResult {
  success: boolean;
  prUrl?: string;
  message: string;
  error?: string;
  ticketOffered?: boolean;
}

interface ExecutionStatus {
  sessionId: string;
  status: 'spawned' | 'working' | 'done' | 'error';
  message: string;
  prUrl?: string;
}

/**
 * Execute a task directly via sub-agent
 * 
 * @param persona - The persona requesting execution
 * @param channelId - Chat channel to report status in
 * @param intent - Detected intent with task details
 * @param model - Model to use (M2.5 for simple, Sonnet for complex)
 * @returns Execution result with PR link and status
 */
export async function executeDirectly(
  persona: Persona,
  channelId: string,
  intent: IntentResult,
  model?: 'M2.5' | 'sonnet'
): Promise<ExecutionResult> {
  const { extractedTask } = intent;
  
  if (!extractedTask || !extractedTask.description) {
    return {
      success: false,
      message: 'Could not extract task details from request',
      error: 'Missing task description'
    };
  }

  try {
    // Post "spawning" status
    await postExecutionStatus(channelId, persona.name, {
      sessionId: 'pending',
      status: 'spawned',
      message: `🚀 Spawning sub-agent to handle: "${extractedTask.title || extractedTask.description.substring(0, 50)}..."`
    });

    // Determine complexity and choose model - use caller-supplied model if provided, otherwise determine
    const selectedModel = model || determineModel(extractedTask.description);
    
    // Build the task prompt for the sub-agent
    const taskPrompt = buildSubAgentPrompt(extractedTask, persona);
    
    // Spawn the sub-agent
    const result = await spawnSubAgent(taskPrompt, selectedModel);
    
    if (result.success && result.prUrl) {
      // Post success with PR link
      await postExecutionStatus(channelId, persona.name, {
        sessionId: result.sessionId || 'completed',
        status: 'done',
        message: `✅ Done! PR created: ${result.prUrl}`,
        prUrl: result.prUrl
      });
      
      // Offer to create ticket retrospectively
      await addMessage(
        channelId,
        persona.name,
        'persona',
        `Want me to create a ticket to track this? Just say "yes, create ticket" and I'll add it to the board.`
      );
      
      return {
        success: true,
        prUrl: result.prUrl,
        message: `Work completed and PR opened: ${result.prUrl}`,
        ticketOffered: true
      };
    } else {
      // Post error
      await postExecutionStatus(channelId, persona.name, {
        sessionId: result.sessionId || 'error',
        status: 'error',
        message: `❌ Something went wrong: ${result.error || 'Unknown error'}`
      });
      
      return {
        success: false,
        message: 'Execution failed',
        error: result.error
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    
    await postExecutionStatus(channelId, persona.name, {
      sessionId: 'error',
      status: 'error',
      message: `❌ Execution failed: ${errorMsg}`
    });
    
    return {
      success: false,
      message: 'Failed to execute',
      error: errorMsg
    };
  }
}

/**
 * Determine which model to use based on task complexity
 */
function determineModel(description: string): 'M2.5' | 'sonnet' {
  // Indicators of complexity that need Sonnet
  const complexIndicators = [
    /refactor|architecture|design|pattern/i,
    /multiple.*files?|across.*files?/i,
    /integrate|integration|orchestrat/i,
    /security|auth|permission/i,
    /migrate|migration|upgrade/i,
  ];
  
  const isComplex = complexIndicators.some(pattern => pattern.test(description));
  
  // Check word count (longer descriptions usually mean more complex)
  const wordCount = description.split(/\s+/).length;
  
  if (isComplex || wordCount > 100) {
    return 'sonnet';
  }
  
  return 'M2.5';
}

/**
 * Build the prompt for the sub-agent
 */
function buildSubAgentPrompt(
  task: IntentResult['extractedTask'],
  persona: Persona
): string {
  const title = task?.title || 'Direct execution task';
  const description = task?.description || '';
  const tags = task?.tags?.join(', ') || 'none';
  
  return `# Direct Execution Task

Requested by: ${persona.name}

## Task
**Title:** ${title}
**Description:**
${description}

**Tags:** ${tags}

## Instructions
1. Implement the requested changes
2. Test your changes
3. Open a pull request
4. Report the PR URL

## Important
- This is a direct execution (no formal ticket)
- Keep it focused and simple
- If the request is too vague or complex, explain what's needed and exit
- Include clear commit messages

Complete the task and report back with the PR URL.`;
}

/**
 * Spawn a sub-agent to execute the task
 */
async function spawnSubAgent(
  prompt: string,
  model: 'M2.5' | 'sonnet'
): Promise<{ success: boolean; prUrl?: string; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      // Use sessions_spawn via the OpenClaw API
      // For now, use claude CLI with --print mode
      const modelArg = model === 'sonnet' ? 'claude-sonnet-4-6' : 'deepseek/deepseek-chat';
      
      const child = spawn('claude', [
        '-p', '-',
        '--model', modelArg,
        '--max-turns', '20',
        '--print'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 1200000 // 20 min timeout
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      
      child.on('close', (code: number | null) => {
        if (code === 0 && stdout) {
          // Extract PR URL from output
          const prMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
          
          if (prMatch) {
            resolve({
              success: true,
              prUrl: prMatch[0],
              sessionId: 'completed'
            });
          } else {
            // No PR found - might have explained why it couldn't proceed
            resolve({
              success: false,
              error: 'No PR was created. Check output for explanation.'
            });
          }
        } else {
          resolve({
            success: false,
            error: stderr || 'Sub-agent failed'
          });
        }
      });
      
      child.on('error', (err: Error) => {
        resolve({
          success: false,
          error: `Failed to spawn: ${err.message}`
        });
      });
      
      // Write prompt to stdin
      child.stdin.write(prompt);
      child.stdin.end();
      
    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

/**
 * Post execution status to chat channel
 */
async function postExecutionStatus(
  channelId: string,
  personaName: string,
  status: ExecutionStatus
): Promise<void> {
  try {
    await addMessage(
      channelId,
      personaName,
      'persona',
      status.message
    );
  } catch (error) {
    console.error('Failed to post execution status:', error);
  }
}

/**
 * Handle ticket creation request after direct execution
 */
export async function createRetrospectiveTicket(
  channelId: string,
  personaName: string,
  task: IntentResult['extractedTask'],
  prUrl?: string
): Promise<{ ticketId: string; message: string }> {
  // Import task creation from storage
  const { createTask } = await import('./storage.js');
  
  const title = task?.title || 'Retrospective ticket';
  const description = task?.description || '';
  const tags = task?.tags || [];
  
  // Add PR link to description if available
  const fullDescription = prUrl 
    ? `${description}\n\n**PR:** ${prUrl}`
    : description;
  
  const ticket = await createTask({
    title,
    description: fullDescription,
    status: 'done', // Already completed
    priority: 400,
    tags,
  }, personaName);
  
  const message = `📋 Created retrospective ticket: **${ticket.title}** (ID: ${ticket.id}) — Status: done`;
  
  await addMessage(
    channelId,
    personaName,
    'persona',
    message
  );
  
  return {
    ticketId: ticket.id,
    message
  };
}
