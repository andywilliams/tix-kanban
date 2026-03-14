/**
 * Conversation Context Builder - Phase 2
 *
 * Manages context window for persona conversations:
 * - Keeps last 5 messages verbatim
 * - Summarizes older messages using Haiku
 * - ~8K tokens/turn budget
 */

import { ChatMessage } from './chat-storage.js';
import { spawn } from 'child_process';

const VERBATIM_MESSAGE_COUNT = 5;
const MAX_CONTEXT_TOKENS = 8000; // Approximate token budget per turn

/**
 * Build context for a persona in a conversation
 * Returns: { summary: string, recentMessages: ChatMessage[] }
 */
export async function buildConversationContext(
  allMessages: ChatMessage[],
  taskDescription: string
): Promise<{ summary: string; recentMessages: ChatMessage[]; estimatedTokens: number }> {
  // Trim task description to fit within token budget
  const trimmedDescription = trimContextToFit(taskDescription, MAX_CONTEXT_TOKENS);

  if (allMessages.length === 0) {
    return {
      summary: '',
      recentMessages: [],
      estimatedTokens: estimateTokens(trimmedDescription),
    };
  }

  // Split messages: last VERBATIM_MESSAGE_COUNT stay verbatim, rest get summarized
  const recentMessages = allMessages.slice(-VERBATIM_MESSAGE_COUNT);
  const olderMessages = allMessages.slice(0, -VERBATIM_MESSAGE_COUNT);

  let summary = '';

  if (olderMessages.length > 0) {
    // Summarize older messages using Haiku
    summary = await summarizeMessages(olderMessages);
  }

  // Build full context
  const fullContext = buildFullContext(trimmedDescription, summary, recentMessages);

  // Trim context if it exceeds token budget
  const trimmedContext = trimContextToFit(fullContext, MAX_CONTEXT_TOKENS);
  const estimatedTokens = estimateTokens(trimmedContext);

  return {
    summary,
    recentMessages,
    fullContext: trimmedContext,
    estimatedTokens,
  };
}

/**
 * Summarize a list of messages using Haiku (cheap, fast model)
 */
async function summarizeMessages(messages: ChatMessage[]): Promise<string> {
  if (messages.length === 0) return '';

  const messagesText = messages
    .map(m => `${m.authorType === 'persona' ? '🤖' : '👤'} ${m.author}: ${m.content}`)
    .join('\n');

  const prompt = `Summarize this conversation concisely. Focus on key decisions, action items, and important context. Keep it under 200 words.

Conversation:
${messagesText}

Summary:`;

  try {
    const summary = await callHaiku(prompt, 60000); // 60s timeout
    return summary.trim();
  } catch (error) {
    console.error('Failed to summarize messages with Haiku:', error);
    // Fallback: truncate to first/last few messages
    const first = messages.slice(0, 2);
    const last = messages.slice(-2);
    return `Earlier discussion (${messages.length} messages). First: "${first[0]?.content.substring(0, 100)}..." Last: "${last[last.length - 1]?.content.substring(0, 100)}..."`;
  }
}

/**
 * Call Haiku model via Claude CLI
 */
function callHaiku(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const claude = spawn('claude', ['-p', '-', '--model', 'haiku', '--max-turns', '1'], {
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
        reject(new Error(`Haiku call failed: ${stderr || 'No output'}`));
      }
    });

    claude.on('error', (err: Error) => {
      reject(err);
    });

    // Write prompt to stdin and close
    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

/**
 * Build full context string for a persona
 */
function buildFullContext(
  taskDescription: string,
  summary: string,
  recentMessages: ChatMessage[]
): string {
  const parts: string[] = [];

  parts.push('## Task Description');
  parts.push(taskDescription);
  parts.push('');

  if (summary) {
    parts.push('## Conversation Summary (Earlier Messages)');
    parts.push(summary);
    parts.push('');
  }

  if (recentMessages.length > 0) {
    parts.push('## Recent Messages');
    recentMessages.forEach(msg => {
      const author = msg.authorType === 'persona' ? `${msg.author} (AI)` : msg.author;
      parts.push(`${author}: ${msg.content}`);
    });
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim context to fit within token budget
 */
export function trimContextToFit(
  context: string,
  maxTokens: number = MAX_CONTEXT_TOKENS
): string {
  const estimatedTokens = estimateTokens(context);

  if (estimatedTokens <= maxTokens) {
    return context;
  }

  // Trim from the middle (keep beginning and end)
  const targetChars = maxTokens * 4;
  const keepStart = Math.floor(targetChars * 0.4); // 40% from start
  const keepEnd = Math.floor(targetChars * 0.4); // 40% from end
  
  const start = context.substring(0, keepStart);
  const end = context.substring(context.length - keepEnd);

  return `${start}\n\n... [${Math.floor((context.length - targetChars) / 4)} tokens omitted] ...\n\n${end}`;
}
