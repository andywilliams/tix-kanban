/**
 * Collaboration Context Management
 */

import { ChatMessage, ChatChannel } from './chat-storage.js';
import Anthropic from '@anthropic-ai/sdk';

const KEEP_LAST_N_MESSAGES = 5;
const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

// Lazy init: only create the client on first use so module load doesn't throw
// if ANTHROPIC_API_KEY is not set in the environment.
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export interface ContextWindow {
  summary?: string;
  recentMessages: ChatMessage[];
  totalMessages: number;
  summarizedCount: number;
}

export async function buildContextWindow(channel: ChatChannel, summariseOlder: boolean = true): Promise<ContextWindow> {
  const messages = channel.messages;
  if (messages.length <= KEEP_LAST_N_MESSAGES) {
    return { recentMessages: messages, totalMessages: messages.length, summarizedCount: 0 };
  }
  const oldMessages = messages.slice(0, -KEEP_LAST_N_MESSAGES);
  const recentMessages = messages.slice(-KEEP_LAST_N_MESSAGES);
  let summary: string | undefined;
  if (summariseOlder && oldMessages.length > 0) {
    summary = await summariseMessages(oldMessages, channel.name);
  }
  return { summary, recentMessages, totalMessages: messages.length, summarizedCount: oldMessages.length };
}

async function summariseMessages(messages: ChatMessage[], channelName: string): Promise<string> {
  const conversationText = messages.map(msg => {
    const timestamp = new Date(msg.createdAt).toISOString();
    return `[${timestamp}] ${msg.author} (${msg.authorType}): ${msg.content}`;
  }).join('\n\n');

  const prompt = `You are summarising a conversation between AI personas collaborating on a task.

Channel: ${channelName}
Messages to summarise: ${messages.length}

Conversation:
${conversationText}

Please provide a concise summary of:
1. What was discussed
2. Key decisions made
3. Current state/progress
4. Any blockers or issues raised

Keep the summary brief (2-3 paragraphs max) but capture all important context.`;

  try {
    const response = await getAnthropicClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.content[0];
    if (content.type === 'text') {
      console.log(`📝 Summarised ${messages.length} messages using Haiku`);
      return content.text;
    }
    return 'Summary generation failed';
  } catch (error) {
    console.error('Error generating summary:', error);
    return `[Failed to generate summary for ${messages.length} messages]`;
  }
}

export function estimateContextTokens(context: ContextWindow): number {
  const summaryTokens = context.summary ? Math.ceil(context.summary.length / 4) : 0;
  const messageTokens = context.recentMessages.reduce((total, msg) => {
    return total + Math.ceil((msg.author.length + msg.content.length) / 4);
  }, 0);
  return summaryTokens + messageTokens;
}
