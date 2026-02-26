/**
 * Chat Summarizer
 *
 * Generates running summaries of long conversations to provide
 * personas with conversation background without consuming tokens
 * on every old message.
 *
 * Summaries capture:
 * - Key decisions made
 * - Action items / tasks created
 * - Important context established
 * - Topics discussed
 */

import { getChannel, updateChannelSummary, ChatMessage } from './chat-storage.js';

// Summary update interval: regenerate summary every N new messages
const SUMMARY_UPDATE_INTERVAL = 20;
// Minimum messages before generating a summary
const MIN_MESSAGES_FOR_SUMMARY = 50;

/**
 * Check if a channel needs its summary updated and update if so.
 * Call this after adding messages to a channel.
 */
export async function maybeUpdateSummary(channelId: string): Promise<void> {
  try {
    const channel = await getChannel(channelId);
    if (!channel) return;

    const messageCount = channel.messages.length;

    // Don't summarize short conversations
    if (messageCount < MIN_MESSAGES_FOR_SUMMARY) return;

    // Check if we need to update (every SUMMARY_UPDATE_INTERVAL messages)
    const lastSummaryAt = channel.summaryUpdatedAt
      ? new Date(channel.summaryUpdatedAt).getTime()
      : 0;

    // Count messages since last summary
    const messagesSinceSummary = channel.messages.filter(
      m => new Date(m.createdAt).getTime() > lastSummaryAt
    ).length;

    if (messagesSinceSummary < SUMMARY_UPDATE_INTERVAL && channel.summary) {
      return; // Summary is recent enough
    }

    // Generate new summary
    const summary = generateConversationSummary(channel.messages);
    await updateChannelSummary(channelId, summary);

    console.log(`📋 Updated conversation summary for channel ${channelId} (${messageCount} messages)`);
  } catch (error) {
    console.error(`Failed to update summary for channel ${channelId}:`, error);
  }
}

/**
 * Generate a conversation summary from messages.
 * Uses heuristics to extract key points without requiring AI.
 */
function generateConversationSummary(messages: ChatMessage[]): string {
  const parts: string[] = [];

  // Identify participants
  const participants = new Set<string>();
  const personaParticipants = new Set<string>();
  for (const msg of messages) {
    if (msg.authorType === 'human') {
      participants.add(msg.author);
    } else {
      personaParticipants.add(msg.author);
    }
  }

  parts.push(`**Participants:** ${[...participants].join(', ')} with ${[...personaParticipants].join(', ')}`);
  parts.push(`**Messages:** ${messages.length}`);

  // Extract topics discussed (based on frequency of significant words)
  const topics = extractTopics(messages);
  if (topics.length > 0) {
    parts.push(`**Topics discussed:** ${topics.join(', ')}`);
  }

  // Find task creation events
  const taskMentions = messages.filter(m =>
    m.content.includes('Ticket created:') || m.content.includes('create_task')
  );
  if (taskMentions.length > 0) {
    parts.push(`**Tasks created:** ${taskMentions.length}`);
    // Extract task titles from creation confirmations
    const taskTitles: string[] = [];
    for (const msg of taskMentions) {
      const titleMatch = msg.content.match(/\*\*Ticket created:\*\*\s*(.+?)(?:\s*\(ID:|$)/);
      if (titleMatch) {
        taskTitles.push(titleMatch[1].trim());
      }
    }
    if (taskTitles.length > 0) {
      parts.push(`  - ${taskTitles.slice(-5).join('\n  - ')}`);
    }
  }

  // Find "remember" commands (decisions/preferences established)
  const rememberMsgs = messages.filter(m =>
    m.content.toLowerCase().includes("i'll remember") ||
    m.content.toLowerCase().includes('saved to your') ||
    m.content.toLowerCase().includes('noted for our')
  );
  if (rememberMsgs.length > 0) {
    parts.push(`**Preferences/instructions established:** ${rememberMsgs.length}`);
  }

  // Find questions asked (messages ending with ?)
  const questions = messages.filter(m =>
    m.authorType === 'human' && m.content.trim().endsWith('?')
  );
  if (questions.length > 0) {
    // Show last few questions as they indicate conversation direction
    const recentQuestions = questions.slice(-3).map(q => q.content.trim().substring(0, 80));
    parts.push(`**Recent questions:**\n  - ${recentQuestions.join('\n  - ')}`);
  }

  // Determine conversation timespan
  if (messages.length > 0) {
    const first = new Date(messages[0].createdAt);
    const last = new Date(messages[messages.length - 1].createdAt);
    const firstStr = first.toLocaleDateString();
    const lastStr = last.toLocaleDateString();
    if (firstStr === lastStr) {
      parts.push(`**Date:** ${firstStr}`);
    } else {
      parts.push(`**Period:** ${firstStr} - ${lastStr}`);
    }
  }

  return parts.join('\n');
}

/**
 * Extract likely topics from messages using word frequency analysis
 */
function extractTopics(messages: ChatMessage[]): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do',
    'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'i', 'you', 'we', 'they', 'he', 'she', 'it', 'that', 'this', 'these',
    'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'not', 'no', 'yes', 'can', 'just', 'also', 'very', 'really', 'like',
    'know', 'think', 'want', 'need', 'get', 'make', 'going', 'see',
    'look', 'help', 'here', 'there', 'right', 'good', 'well', 'now',
    'way', 'its', 'let', 'sure', 'thanks', 'okay', 'yeah', 'hey',
    'something', 'thing', 'much', 'more', 'some', 'any', 'other',
  ]);

  const wordCounts = new Map<string, number>();

  for (const msg of messages) {
    if (msg.authorType !== 'human') continue; // Focus on user messages for topic extraction

    const words = msg.content.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  // Sort by frequency, take top topics
  const sorted = [...wordCounts.entries()]
    .filter(([_, count]) => count >= 3) // Must appear at least 3 times
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  return sorted;
}

/**
 * Get the conversation summary for context building.
 * Returns formatted summary suitable for inclusion in AI prompts.
 */
export async function getConversationBackground(channelId: string): Promise<string> {
  try {
    const channel = await getChannel(channelId);
    if (!channel || !channel.summary) return '';

    return `## Conversation Background\n${channel.summary}`;
  } catch (error) {
    return '';
  }
}
