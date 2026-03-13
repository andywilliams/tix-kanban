/**
 * Chat Storage System
 *
 * Manages chat channels and messages with:
 * - Automatic archiving of old messages
 * - Lazy loading support (metadata vs full messages)
 * - Channel summaries for long conversations
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CHAT_DIR = path.join(os.homedir(), '.tix-kanban', 'chat');
const ARCHIVE_DIR = path.join(CHAT_DIR, 'archives');

// Max messages in a live channel before triggering archiving
const MAX_LIVE_MESSAGES = 200;
// Default age (in days) for archiving old messages
const DEFAULT_ARCHIVE_DAYS = 30;

// Per-channel write lock to prevent concurrent read-modify-write races
const channelLocks = new Map<string, Promise<void>>();

function withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const prev = channelLocks.get(channelId) || Promise.resolve();
  const next = prev.then(fn, fn); // Run fn after previous completes (even on error)
  // Store the void version so the chain continues
  channelLocks.set(channelId, next.then(() => {}, () => {}));
  return next;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  author: string;
  authorType: 'human' | 'persona';
  content: string;
  mentions: string[]; // Array of persona names that were @mentioned
  createdAt: Date;
  replyTo?: string; // ID of message this is replying to
}

export interface ChatChannel {
  id: string;
  type: 'task' | 'general' | 'persona' | 'direct';
  taskId?: string; // Only set for task channels
  personaId?: string; // Only set for persona DM or direct persona chats
  name: string;
  messages: ChatMessage[];
  lastActivity: Date;
  summary?: string; // Running summary of older conversation
  summaryUpdatedAt?: Date;
  totalMessageCount?: number; // Includes archived messages
  speakingPersona?: string; // Persona currently holding the floor (turn-taking lock)
  speakingSince?: Date; // When the current speaker acquired the lock
}

export interface ChatChannelMeta {
  id: string;
  type: 'task' | 'general' | 'persona' | 'direct';
  taskId?: string;
  personaId?: string;
  name: string;
  lastActivity: Date;
  messageCount: number;
  totalMessageCount: number;
  summary?: string;
  summaryUpdatedAt?: Date;
}

// Initialize chat storage
export async function initializeChatStorage(): Promise<void> {
  await fs.mkdir(CHAT_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
}

// Get channel file path
function getChannelFilePath(channelId: string): string {
  return path.join(CHAT_DIR, `${channelId}.json`);
}

// Get archive file path for a given month
function getArchiveFilePath(channelId: string, yearMonth: string): string {
  return path.join(ARCHIVE_DIR, `${channelId}-archive-${yearMonth}.json`);
}

// Load channel from disk
export async function getChannel(channelId: string): Promise<ChatChannel | null> {
  const filePath = getChannelFilePath(channelId);

  try {
    const data = await fs.readFile(filePath, 'utf8');
    const channel = JSON.parse(data);

    // Convert date strings back to Date objects
    channel.lastActivity = new Date(channel.lastActivity);
    channel.messages.forEach((msg: any) => {
      msg.createdAt = new Date(msg.createdAt);
    });
    if (channel.summaryUpdatedAt) {
      channel.summaryUpdatedAt = new Date(channel.summaryUpdatedAt);
    }

    return channel;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`Error loading chat channel ${channelId}:`, error);
    return null;
  }
}

// Get channel metadata without loading all messages
export async function getChannelMeta(channelId: string): Promise<ChatChannelMeta | null> {
  const channel = await getChannel(channelId);
  if (!channel) return null;

  return {
    id: channel.id,
    type: channel.type,
    taskId: channel.taskId,
    personaId: channel.personaId,
    name: channel.name,
    lastActivity: channel.lastActivity,
    messageCount: channel.messages.length,
    totalMessageCount: channel.totalMessageCount || channel.messages.length,
    summary: channel.summary,
    summaryUpdatedAt: channel.summaryUpdatedAt,
  };
}

// Save channel to disk
async function saveChannel(channel: ChatChannel): Promise<void> {
  const filePath = getChannelFilePath(channel.id);

  try {
    await fs.writeFile(filePath, JSON.stringify(channel, null, 2));
  } catch (error) {
    console.error(`Error saving chat channel ${channel.id}:`, error);
    throw error;
  }
}

// Create or get a channel
export async function createOrGetChannel(channelId: string, type: 'task' | 'general' | 'persona' | 'direct', taskId?: string, name?: string, personaId?: string): Promise<ChatChannel> {
  let channel = await getChannel(channelId);

  if (!channel) {
    let defaultName = name;
    if (!defaultName) {
      if (type === 'general') defaultName = 'General';
      else if (type === 'task') defaultName = `Task ${taskId}`;
      else if (type === 'persona') defaultName = `Persona ${personaId}`;
      else if (type === 'direct') defaultName = `Chat with ${personaId || 'Persona'}`;
    }

    channel = {
      id: channelId,
      type,
      taskId,
      personaId,
      name: defaultName!,
      messages: [],
      lastActivity: new Date(),
      totalMessageCount: 0,
    };
    await saveChannel(channel);
  }

  return channel;
}

// Add message to channel (with auto-archive when needed)
// Uses per-channel locking to prevent concurrent read-modify-write races.
export function addMessage(channelId: string, author: string, authorType: 'human' | 'persona', content: string, replyTo?: string): Promise<ChatMessage> {
  return withChannelLock(channelId, async () => {
    let channel = await getChannel(channelId);

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Extract @mentions from content
    const mentions = extractMentions(content);

    const message: ChatMessage = {
      id: Math.random().toString(36).substr(2, 12),
      channelId,
      author,
      authorType,
      content,
      mentions,
      createdAt: new Date(),
      replyTo,
    };

    // Increment total count before push so the fallback to messages.length is accurate
    channel.totalMessageCount = (channel.totalMessageCount || channel.messages.length) + 1;
    channel.messages.push(message);
    channel.lastActivity = new Date();

    // Auto-archive if channel has too many live messages
    if (channel.messages.length > MAX_LIVE_MESSAGES) {
      await archiveOldMessages(channel);
    }

    await saveChannel(channel);
    return message;
  });
}

// Get messages for a channel (with pagination)
export async function getMessages(channelId: string, limit: number = 50, before?: string): Promise<ChatMessage[]> {
  const channel = await getChannel(channelId);

  if (!channel) {
    return [];
  }

  let messages = [...channel.messages];

  // If before is specified, filter to messages before that ID
  if (before) {
    const beforeIndex = messages.findIndex(msg => msg.id === before);
    if (beforeIndex > 0) {
      messages = messages.slice(0, beforeIndex);
    }
  }

  // Sort by creation time (newest first) and limit
  return messages
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .reverse(); // Reverse to get chronological order
}

// Get all channels with recent activity
export async function getAllChannels(): Promise<ChatChannel[]> {
  let files: string[];
  try {
    files = (await fs.readdir(CHAT_DIR)).filter(file => file.endsWith('.json'));
  } catch {
    return [];
  }
  const channels: ChatChannel[] = [];

  for (const file of files) {
    const channelId = file.replace('.json', '');
    const channel = await getChannel(channelId);
    if (channel) {
      channels.push(channel);
    }
  }

  // Sort by last activity (most recent first)
  return channels.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
}

// Extract @mentions from message content
function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }

  return [...new Set(mentions)]; // Remove duplicates
}

// Archive old messages from a channel to monthly archive files
async function archiveOldMessages(channel: ChatChannel): Promise<number> {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DEFAULT_ARCHIVE_DAYS);

  // Separate messages into keep and archive
  const toKeep: ChatMessage[] = [];
  const toArchive: ChatMessage[] = [];

  for (const msg of channel.messages) {
    const msgDate = new Date(msg.createdAt);
    if (msgDate < cutoffDate) {
      toArchive.push(msg);
    } else {
      toKeep.push(msg);
    }
  }

  // Ensure we keep at least MAX_LIVE_MESSAGES/2 most recent messages
  if (toKeep.length < MAX_LIVE_MESSAGES / 2 && toArchive.length > 0) {
    // Move some back from archive to keep
    const needed = Math.floor(MAX_LIVE_MESSAGES / 2) - toKeep.length;
    const movedBack = toArchive.splice(-needed);
    toKeep.unshift(...movedBack);
  }

  if (toArchive.length === 0) {
    return 0;
  }

  // Group archived messages by month
  const byMonth = new Map<string, ChatMessage[]>();
  for (const msg of toArchive) {
    const d = new Date(msg.createdAt);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(yearMonth)) byMonth.set(yearMonth, []);
    byMonth.get(yearMonth)!.push(msg);
  }

  // Write to archive files (append to existing)
  for (const [yearMonth, messages] of byMonth.entries()) {
    const archivePath = getArchiveFilePath(channel.id, yearMonth);
    let existing: ChatMessage[] = [];
    try {
      const data = await fs.readFile(archivePath, 'utf8');
      existing = JSON.parse(data);
    } catch {
      // No existing archive
    }
    existing.push(...messages);
    await fs.writeFile(archivePath, JSON.stringify(existing, null, 2));
  }

  // Update channel
  channel.messages = toKeep;

  console.log(`📦 Archived ${toArchive.length} messages from channel ${channel.id}`);
  return toArchive.length;
}

// Get archived messages for a channel (specific month)
export async function getArchivedMessages(channelId: string, yearMonth: string): Promise<ChatMessage[]> {
  const archivePath = getArchiveFilePath(channelId, yearMonth);
  try {
    const data = await fs.readFile(archivePath, 'utf8');
    const messages = JSON.parse(data);
    return messages.map((msg: any) => ({
      ...msg,
      createdAt: new Date(msg.createdAt),
    }));
  } catch {
    return [];
  }
}

// List available archive months for a channel
export async function getArchiveMonths(channelId: string): Promise<string[]> {
  try {
    const files = await fs.readdir(ARCHIVE_DIR);
    const prefix = `${channelId}-archive-`;
    return files
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .map(f => f.replace(prefix, '').replace('.json', ''))
      .sort();
  } catch {
    return [];
  }
}

// Delete old messages (for cleanup) — kept for backward compat
export async function deleteOldMessages(channelId: string, olderThanDays: number): Promise<number> {
  const channel = await getChannel(channelId);

  if (!channel) {
    return 0;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const originalCount = channel.messages.length;
  channel.messages = channel.messages.filter(msg => new Date(msg.createdAt) >= cutoffDate);

  if (channel.messages.length !== originalCount) {
    await saveChannel(channel);
  }

  return originalCount - channel.messages.length;
}

// Update channel conversation summary
export async function updateChannelSummary(channelId: string, summary: string): Promise<void> {
  const channel = await getChannel(channelId);
  if (!channel) return;

  channel.summary = summary;
  channel.summaryUpdatedAt = new Date();
  await saveChannel(channel);
}

// Get channel summary if available
export async function getChannelSummary(channelId: string): Promise<string | undefined> {
  const channel = await getChannel(channelId);
  return channel?.summary;
}

// Run archiving across all channels (call periodically or on startup)
export async function runArchiveMaintenance(): Promise<{ channelsProcessed: number; totalArchived: number }> {
  let channelsProcessed = 0;
  let totalArchived = 0;

  try {
    const files = (await fs.readdir(CHAT_DIR)).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const channelId = file.replace('.json', '');
      const channel = await getChannel(channelId);
      if (!channel) continue;

      if (channel.messages.length > MAX_LIVE_MESSAGES) {
        const archived = await archiveOldMessages(channel);
        if (archived > 0) {
          await saveChannel(channel);
          totalArchived += archived;
          channelsProcessed++;
        }
      }
    }
  } catch (error) {
    console.error('Archive maintenance failed:', error);
  }

  if (totalArchived > 0) {
    console.log(`📦 Archive maintenance: processed ${channelsProcessed} channels, archived ${totalArchived} messages`);
  }

  return { channelsProcessed, totalArchived };
}

// Turn-taking mechanism for persona conversations

const TURN_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - auto-release if persona doesn't respond

/**
 * Attempt to acquire the speaking turn for a persona in a channel.
 * Returns true if acquired, false if another persona is currently speaking.
 */
export async function acquireSpeakingTurn(channelId: string, personaId: string): Promise<boolean> {
  return withChannelLock(channelId, async () => {
    const channel = await getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Check if someone else is speaking
    if (channel.speakingPersona && channel.speakingPersona !== personaId) {
      // Check if their turn has timed out
      const speakingSince = channel.speakingSince ? new Date(channel.speakingSince) : null;
      if (speakingSince) {
        const elapsed = Date.now() - speakingSince.getTime();
        if (elapsed < TURN_TIMEOUT_MS) {
          console.log(`🚫 ${personaId} cannot speak - ${channel.speakingPersona} has the floor`);
          return false;
        }
        console.log(`⏱️ ${channel.speakingPersona}'s turn timed out, allowing ${personaId} to speak`);
      } else {
        // speakingPersona is set but speakingSince is missing - deny turn
        // This prevents turn lock bypass
        console.log(`🚫 ${personaId} cannot speak - ${channel.speakingPersona} has the floor (no speakingSince)`);
        return false;
      }
    }

    // Acquire the turn
    channel.speakingPersona = personaId;
    channel.speakingSince = new Date();
    await saveChannel(channel);
    console.log(`🎤 ${personaId} acquired speaking turn in ${channelId}`);
    return true;
  });
}

/**
 * Release the speaking turn for a persona in a channel.
 */
export async function releaseSpeakingTurn(channelId: string, personaId: string): Promise<void> {
  return withChannelLock(channelId, async () => {
    const channel = await getChannel(channelId);
    if (!channel) {
      return; // Channel doesn't exist, nothing to release
    }

    // Only release if this persona currently has the turn
    if (channel.speakingPersona === personaId) {
      channel.speakingPersona = undefined;
      channel.speakingSince = undefined;
      await saveChannel(channel);
      console.log(`✅ ${personaId} released speaking turn in ${channelId}`);
    }
  });
}
