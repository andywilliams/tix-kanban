/**
 * Server-Sent Events (SSE) streaming for chat responses
 * 
 * Provides real-time token-by-token streaming of AI responses
 * to eliminate the "waiting for nothing" UX problem.
 */

import { Response } from 'express';

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
