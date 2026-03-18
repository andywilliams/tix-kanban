/**
 * Server-Sent Events (SSE) streaming for chat responses
 * 
 * Provides real-time token-by-token streaming of AI responses
 * to eliminate the "waiting for nothing" UX problem.
 */

import { Response } from 'express';
import { Persona } from '../client/types/index.js';

export interface StreamEvent {
  event: 'thinking' | 'token' | 'done' | 'error';
  data: any;
}

/**
 * Send an SSE event to the client
 */
export function sendSSE(res: Response, event: StreamEvent): void {
  const { event: eventType, data } = event;
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
}

/**
 * Initialize SSE connection with proper headers
 */
export function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send initial comment to establish connection
  res.write(': SSE connection established\n\n');
}

/**
 * Generate AI response with streaming support
 * Emits tokens as they arrive from the LLM
 */
export async function generateAIResponseStreaming(
  prompt: string,
  persona: Persona,
  onToken: (token: string) => void,
  timeoutMs: number = 90000
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const { spawn } = await import('child_process');

      // Use spawn to pipe prompt via stdin
      const claude = spawn('claude', ['-p', '-', '--max-turns', '3'], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs
      });

      let fullResponse = '';
      let buffer = '';

      // Process stdout data in chunks (streaming tokens)
      claude.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        fullResponse += chunk;
        
        // Buffer and emit tokens in reasonable chunks (not character-by-character)
        buffer += chunk;
        
        // Emit when we have a reasonable chunk (word boundary or punctuation)
        if (buffer.length >= 10 || /[\s.,!?;:]$/.test(buffer)) {
          onToken(buffer);
          buffer = '';
        }
      });

      let stderr = '';
      claude.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      claude.on('close', (code: number | null) => {
        // Emit any remaining buffered content
        if (buffer.length > 0) {
          onToken(buffer);
        }

        if (stderr) {
          console.error(`Persona ${persona.name} stderr:`, stderr.substring(0, 200));
        }

        const response = fullResponse.trim();
        if (response && response.length > 0) {
          resolve(response);
        } else {
          console.warn(`Claude Code returned empty/failed (code ${code}) for ${persona.name}`);
          reject(new Error('Empty response from AI'));
        }
      });

      claude.on('error', (err: Error) => {
        console.error(`Claude Code spawn failed for ${persona.name}:`, err.message);
        reject(err);
      });

      // Write prompt to stdin and close it
      claude.stdin.write(prompt);
      claude.stdin.end();

    } catch (error) {
      console.error(`Claude Code failed for ${persona.name}:`, error);
      reject(error);
    }
  });
}
