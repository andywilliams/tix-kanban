import { db } from '../db/index.js';
import { sessions, messages, compactions, personas } from '../db/schema.js';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { encoding_for_model, Tiktoken } from 'tiktoken';
import Anthropic from '@anthropic-ai/sdk';

// Default context window size (tokens)
const DEFAULT_CONTEXT_LIMIT = 100000;
// Trigger compaction at 80% of context limit
const COMPACTION_THRESHOLD = 0.8;
// Keep most recent N messages verbatim during compaction
const MESSAGES_TO_KEEP_VERBATIM = 20;

// Tiktoken encoder instance (lazy-loaded)
let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

/**
 * Count tokens in a text string using tiktoken
 */
export function countTokens(text: string): number {
  try {
    const enc = getEncoder();
    return enc.encode(text).length;
  } catch (error) {
    console.error('Error counting tokens:', error);
    // Fallback: rough estimate (4 chars per token)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Get or create a session for a persona
 * Uses upsert pattern to avoid race conditions (TOCTOU)
 */
export async function getOrCreateSession(personaId: string): Promise<string> {
  // Note: Persona validation is handled elsewhere (file-system based)
  // Try to find existing session first
  const existingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.personaId, personaId))
    .limit(1);

  if (existingSessions.length > 0) {
    return existingSessions[0].id;
  }

  // Use upsert to atomically create if not exists (avoids race condition)
  // Generate deterministic ID based on personaId to ensure consistency
  const sessionId = `sess_${personaId}_${Date.now()}`;
  
  await db
    .insert(sessions)
    .values({
      id: sessionId,
      personaId,
      tokenCount: 0,
      compactionCount: 0,
    })
    .onConflictDoNothing({
      target: sessions.personaId,
    });

  // Fetch the session (either newly created or existing from concurrent insert)
  const createdSession = await db
    .select()
    .from(sessions)
    .where(eq(sessions.personaId, personaId))
    .limit(1);

  return createdSession[0].id;
}

/**
 * Add a message to a session
 */
export async function addMessage(
  sessionId: string,
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: string,
  metadata?: Record<string, any>
): Promise<void> {
  const tokenCount = countTokens(content);
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await db.insert(messages).values({
    id: messageId,
    sessionId,
    role,
    content,
    tokenCount,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
  });

  // Update session token count
  const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (session.length > 0) {
    const newTokenCount = (session[0].tokenCount || 0) + tokenCount;
    await db
      .update(sessions)
      .set({ 
        tokenCount: newTokenCount,
        updatedAt: new Date()
      })
      .where(eq(sessions.id, sessionId));

    // Check if compaction is needed
    if (newTokenCount > DEFAULT_CONTEXT_LIMIT * COMPACTION_THRESHOLD) {
      console.log(`⚠️  Session ${sessionId} approaching context limit (${newTokenCount}/${DEFAULT_CONTEXT_LIMIT}). Triggering compaction.`);
      await compactSession(sessionId);
    }
  }
}

/**
 * Get session history (messages)
 */
export async function getSessionHistory(sessionId: string, limit?: number): Promise<Array<{
  id: string;
  role: string;
  content: string;
  tokenCount: number | null;
  createdAt: Date | null;
  metadata?: Record<string, any>;
}>> {
  const query = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt));

  const allMessages = limit ? await query.limit(limit) : await query;

  // Reverse to get chronological order (oldest first) for display
  const chronologicallyOrdered = [...allMessages].reverse();

  return chronologicallyOrdered.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    tokenCount: msg.tokenCount,
    createdAt: msg.createdAt,
    metadata: msg.metadataJson ? JSON.parse(msg.metadataJson) : undefined,
  }));
}

/**
 * Compact a session by summarizing old messages
 */
export async function compactSession(sessionId: string): Promise<void> {
  const allMessages = await getSessionHistory(sessionId);
  
  if (allMessages.length <= MESSAGES_TO_KEEP_VERBATIM) {
    console.log(`Session ${sessionId} has ${allMessages.length} messages, no compaction needed.`);
    return;
  }

  // Split messages: old ones to summarize, recent ones to keep
  const messagesToSummarize = allMessages.slice(0, -MESSAGES_TO_KEEP_VERBATIM);
  const messagesToKeep = allMessages.slice(-MESSAGES_TO_KEEP_VERBATIM);

  // Build summary prompt
  const conversationText = messagesToSummarize
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n');

  const summaryPrompt = `Summarize the key decisions, outcomes, and context from these messages. Focus on what's important for maintaining conversational continuity. Be concise but preserve critical details.\n\n${conversationText}`;

  try {
    // Use Claude API to generate summary
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: summaryPrompt,
        },
      ],
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Build full content with prefix (same as what's stored in DB)
    const fullContent = `[COMPACTED HISTORY — ${messagesToSummarize.length} messages]\n\n${summary}`;
    const summaryTokenCount = countTokens(fullContent);

    // Calculate tokens freed
    const tokensFreed = messagesToSummarize.reduce((sum, m) => sum + (m.tokenCount || 0), 0) - summaryTokenCount;

    // Create summary message - set createdAt just before the oldest kept message
    // to ensure it sorts correctly (before recent messages in asc order)
    const summaryMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const oldestKeptMessageCreatedAt = messagesToKeep[0]?.createdAt || new Date();
    const summaryCreatedAt = new Date(oldestKeptMessageCreatedAt.getTime() - 1000);
    
    await db.insert(messages).values({
      id: summaryMessageId,
      sessionId,
      role: 'system',
      content: `[COMPACTED HISTORY — ${messagesToSummarize.length} messages]\n\n${summary}`,
      tokenCount: summaryTokenCount,
      createdAt: summaryCreatedAt,
      metadataJson: JSON.stringify({ 
        compacted: true,
        originalMessageCount: messagesToSummarize.length,
        tokensFreed 
      }),
    });

    // Delete old messages
    const messageIdsToDelete = messagesToSummarize.map(m => m.id);
    for (const msgId of messageIdsToDelete) {
      await db.delete(messages).where(eq(messages.id, msgId));
    }

    // Create compaction record
    const compactionId = `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(compactions).values({
      id: compactionId,
      sessionId,
      summary,
      messagesCompacted: messagesToSummarize.length,
      tokensFreed,
    });

    // Update session stats
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length > 0) {
      const newTokenCount = (session[0].tokenCount || 0) - tokensFreed;
      const newCompactionCount = (session[0].compactionCount || 0) + 1;
      await db
        .update(sessions)
        .set({
          tokenCount: newTokenCount,
          compactionCount: newCompactionCount,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
    }

    console.log(`✅ Session ${sessionId} compacted: ${messagesToSummarize.length} messages → summary (freed ${tokensFreed} tokens)`);
  } catch (error) {
    console.error(`Failed to compact session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * Reset a session (clear all messages)
 */
export async function resetSession(sessionId: string): Promise<void> {
  // Delete all messages
  await db.delete(messages).where(eq(messages.sessionId, sessionId));
  
  // Delete all compactions
  await db.delete(compactions).where(eq(compactions.sessionId, sessionId));

  // Reset session stats
  await db
    .update(sessions)
    .set({
      tokenCount: 0,
      compactionCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  console.log(`✅ Session ${sessionId} reset`);
}

/**
 * Get session stats
 */
export async function getSessionStats(sessionId: string): Promise<{
  tokenCount: number;
  messageCount: number;
  compactionCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}> {
  const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (session.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Use COUNT query instead of fetching all rows
  const [{ count: messageCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));

  return {
    tokenCount: session[0].tokenCount || 0,
    messageCount: messageCount || 0,
    compactionCount: session[0].compactionCount || 0,
    createdAt: session[0].createdAt,
    updatedAt: session[0].updatedAt,
  };
}

/**
 * Build conversation history for AI invocation
 * Returns an array of message objects suitable for passing to Claude
 */
export async function buildConversationHistory(sessionId: string): Promise<Array<{
  role: 'user' | 'assistant' | 'system';
  content: string;
}>> {
  const history = await getSessionHistory(sessionId);
  
  // Convert to Claude message format
  // Preserve 'system' role for compacted summaries, map others appropriately
  return history.map(msg => {
    if (msg.role === 'system') {
      return { role: 'system' as const, content: msg.content };
    }
    return {
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.content,
    };
  });
}
