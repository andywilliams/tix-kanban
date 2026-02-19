import fs from 'fs';
import path from 'path';
import os from 'os';

const CHAT_DIR = path.join(os.homedir(), '.tix-kanban', 'chat');

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
  type: 'task' | 'general' | 'persona';
  taskId?: string; // Only set for task channels
  personaId?: string; // Only set for persona DM channels
  name: string;
  messages: ChatMessage[];
  lastActivity: Date;
}

// Initialize chat storage
export function initializeChatStorage(): void {
  if (!fs.existsSync(CHAT_DIR)) {
    fs.mkdirSync(CHAT_DIR, { recursive: true });
  }
}

// Get channel file path
function getChannelFilePath(channelId: string): string {
  return path.join(CHAT_DIR, `${channelId}.json`);
}

// Load channel from disk
export async function getChannel(channelId: string): Promise<ChatChannel | null> {
  const filePath = getChannelFilePath(channelId);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const channel = JSON.parse(data);
    
    // Convert date strings back to Date objects
    channel.lastActivity = new Date(channel.lastActivity);
    channel.messages.forEach((msg: any) => {
      msg.createdAt = new Date(msg.createdAt);
    });
    
    return channel;
  } catch (error) {
    console.error(`Error loading chat channel ${channelId}:`, error);
    return null;
  }
}

// Save channel to disk
async function saveChannel(channel: ChatChannel): Promise<void> {
  const filePath = getChannelFilePath(channel.id);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(channel, null, 2));
  } catch (error) {
    console.error(`Error saving chat channel ${channel.id}:`, error);
    throw error;
  }
}

// Create or get a channel
export async function createOrGetChannel(channelId: string, type: 'task' | 'general' | 'persona', taskId?: string, name?: string, personaId?: string): Promise<ChatChannel> {
  let channel = await getChannel(channelId);
  
  if (!channel) {
    let defaultName = 'General';
    if (type === 'task') defaultName = `Task ${taskId}`;
    if (type === 'persona') defaultName = `Persona ${personaId}`;
    
    channel = {
      id: channelId,
      type,
      taskId: type === 'task' ? taskId : undefined,
      personaId: type === 'persona' ? personaId : undefined,
      name: name || defaultName,
      messages: [],
      lastActivity: new Date(),
    };
    await saveChannel(channel);
  }
  
  return channel;
}

// Add message to channel
export async function addMessage(channelId: string, author: string, authorType: 'human' | 'persona', content: string, replyTo?: string): Promise<ChatMessage> {
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
  
  channel.messages.push(message);
  channel.lastActivity = new Date();
  
  await saveChannel(channel);
  return message;
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
  if (!fs.existsSync(CHAT_DIR)) {
    return [];
  }
  
  const files = fs.readdirSync(CHAT_DIR).filter(file => file.endsWith('.json'));
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

// Delete old messages (for cleanup)
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