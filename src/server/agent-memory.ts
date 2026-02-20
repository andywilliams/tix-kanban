/**
 * Agent Memory System
 * 
 * Per-user, per-agent persistent memory with categories:
 * - preferences: User's preferred ways of working
 * - context: Project/domain knowledge
 * - instructions: Explicit user instructions ("always do X")
 * - relationships: How this agent relates to user and other agents
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const MEMORY_DIR = path.join(STORAGE_DIR, 'agent-memories');

export interface MemoryEntry {
  id: string;
  category: 'preferences' | 'context' | 'instructions' | 'relationships';
  content: string;
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
  source: 'explicit' | 'inferred' | 'feedback';
  importance: number; // 1-10, higher = more important
}

export interface AgentMemory {
  personaId: string;
  userId: string;
  entries: MemoryEntry[];
  lastInteraction: Date;
  interactionCount: number;
}

// Ensure directories exist
async function ensureDirectories(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

// Get memory file path for a user-persona pair
function getMemoryPath(personaId: string, userId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
  return path.join(MEMORY_DIR, personaId, `${safeUserId}.json`);
}

// Get or create agent memory
export async function getAgentMemory(personaId: string, userId: string = 'default'): Promise<AgentMemory> {
  await ensureDirectories();
  const memoryPath = getMemoryPath(personaId, userId);
  
  try {
    const data = await fs.readFile(memoryPath, 'utf8');
    const memory = JSON.parse(data);
    memory.lastInteraction = new Date(memory.lastInteraction);
    memory.entries = memory.entries.map((e: any) => ({
      ...e,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt)
    }));
    return memory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        personaId,
        userId,
        entries: [],
        lastInteraction: new Date(),
        interactionCount: 0
      };
    }
    throw error;
  }
}

// Save agent memory
async function saveAgentMemory(memory: AgentMemory): Promise<void> {
  await ensureDirectories();
  const personaDir = path.join(MEMORY_DIR, memory.personaId);
  await fs.mkdir(personaDir, { recursive: true });
  
  const memoryPath = getMemoryPath(memory.personaId, memory.userId);
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2));
}

// Add a memory entry
export async function addMemoryEntry(
  personaId: string,
  userId: string,
  entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>
): Promise<MemoryEntry> {
  const memory = await getAgentMemory(personaId, userId);
  
  const newEntry: MemoryEntry = {
    ...entry,
    id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  memory.entries.push(newEntry);
  memory.lastInteraction = new Date();
  memory.interactionCount++;
  
  await saveAgentMemory(memory);
  return newEntry;
}

// Update a memory entry
export async function updateMemoryEntry(
  personaId: string,
  userId: string,
  entryId: string,
  updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>
): Promise<MemoryEntry | null> {
  const memory = await getAgentMemory(personaId, userId);
  const entry = memory.entries.find(e => e.id === entryId);
  
  if (!entry) return null;
  
  Object.assign(entry, updates, { updatedAt: new Date() });
  await saveAgentMemory(memory);
  return entry;
}

// Delete a memory entry. Accepts an optional pre-loaded memory to avoid redundant file reads.
export async function deleteMemoryEntry(
  personaId: string,
  userId: string,
  entryId: string,
  preloadedMemory?: AgentMemory
): Promise<boolean> {
  const memory = preloadedMemory ?? await getAgentMemory(personaId, userId);
  const index = memory.entries.findIndex(e => e.id === entryId);

  if (index === -1) return false;

  memory.entries.splice(index, 1);
  await saveAgentMemory(memory);
  return true;
}

// Search memories by relevance
export async function searchMemories(
  personaId: string,
  userId: string,
  query: string,
  options: {
    category?: MemoryEntry['category'];
    limit?: number;
    minImportance?: number;
  } = {}
): Promise<MemoryEntry[]> {
  const memory = await getAgentMemory(personaId, userId);
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  let results = memory.entries.filter(entry => {
    if (options.category && entry.category !== options.category) return false;
    if (options.minImportance && entry.importance < options.minImportance) return false;
    return true;
  });
  
  // Score and sort by relevance
  const scored = results.map(entry => {
    let score = 0;
    const contentLower = entry.content.toLowerCase();
    const keywordsLower = entry.keywords.map(k => k.toLowerCase());
    
    // Direct keyword match
    for (const kw of keywordsLower) {
      if (queryWords.some(qw => kw.includes(qw) || qw.includes(kw))) {
        score += 10;
      }
    }
    
    // Content match
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        score += 5;
      }
    }
    
    // Full query match
    if (contentLower.includes(queryLower)) {
      score += 20;
    }
    
    // Importance boost
    score += entry.importance;
    
    // Recency boost (entries from last 7 days get bonus)
    const daysSinceUpdate = (Date.now() - entry.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate < 7) {
      score += (7 - daysSinceUpdate);
    }
    
    return { entry, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored
    .filter(s => s.score > 0)
    .slice(0, options.limit || 10)
    .map(s => s.entry);
}

// Get memories by category
export async function getMemoriesByCategory(
  personaId: string,
  userId: string,
  category: MemoryEntry['category']
): Promise<MemoryEntry[]> {
  const memory = await getAgentMemory(personaId, userId);
  return memory.entries
    .filter(e => e.category === category)
    .sort((a, b) => b.importance - a.importance);
}

// Parse "remember" commands from messages
export function parseRememberCommand(content: string): {
  isRemember: boolean;
  category: MemoryEntry['category'];
  content: string;
  keywords: string[];
} | null {
  // Patterns like:
  // "@Developer, remember that I prefer TypeScript"
  // "@PM, note that our sprints are 2 weeks"
  // "remember: always use tabs not spaces"
  
  const rememberPatterns = [
    /(?:remember|note|keep in mind|don't forget)[\s:]+(?:that\s+)?(.+)/i,
    /(?:i\s+(?:always|prefer|like|want|need)|my preference is)\s+(.+)/i,
    /(?:we|our team)\s+(?:use|prefer|follow|have)\s+(.+)/i
  ];
  
  for (const pattern of rememberPatterns) {
    const match = content.match(pattern);
    if (match) {
      const text = match[1].trim();
      
      // Determine category based on content
      let category: MemoryEntry['category'] = 'context';
      
      if (/prefer|like|want|style|format/i.test(text)) {
        category = 'preferences';
      } else if (/always|never|must|should|rule/i.test(text)) {
        category = 'instructions';
      } else if (/team|work with|collaborate|relationship/i.test(text)) {
        category = 'relationships';
      }
      
      // Extract keywords
      const keywords = extractKeywords(text);
      
      return {
        isRemember: true,
        category,
        content: text,
        keywords
      };
    }
  }
  
  return null;
}

// Extract keywords from text
function extractKeywords(text: string): string[] {
  // Remove common words and extract significant terms
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'i', 'you', 'we', 'they', 'he', 'she', 'it', 'that', 'this', 'these',
    'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Return unique words
  return [...new Set(words)];
}

// Build context from memories for AI prompt
export async function buildMemoryContext(
  personaId: string,
  userId: string,
  currentQuery?: string
): Promise<string> {
  const memory = await getAgentMemory(personaId, userId);
  
  if (memory.entries.length === 0) {
    return '';
  }
  
  const sections: string[] = [];
  
  // Instructions (always include, highest priority)
  const instructions = memory.entries
    .filter(e => e.category === 'instructions')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);
  
  if (instructions.length > 0) {
    sections.push('## User Instructions\n' + 
      instructions.map(e => `- ${e.content}`).join('\n'));
  }
  
  // Preferences
  const preferences = memory.entries
    .filter(e => e.category === 'preferences')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);
  
  if (preferences.length > 0) {
    sections.push('## User Preferences\n' + 
      preferences.map(e => `- ${e.content}`).join('\n'));
  }
  
  // Context relevant to query
  if (currentQuery) {
    const relevant = await searchMemories(personaId, userId, currentQuery, {
      category: 'context',
      limit: 3,
      minImportance: 3
    });
    
    if (relevant.length > 0) {
      sections.push('## Relevant Context\n' + 
        relevant.map(e => `- ${e.content}`).join('\n'));
    }
  }
  
  // Relationship context
  const relationships = memory.entries
    .filter(e => e.category === 'relationships')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);
  
  if (relationships.length > 0) {
    sections.push('## Working Relationship\n' + 
      relationships.map(e => `- ${e.content}`).join('\n'));
  }
  
  return sections.join('\n\n');
}

// Record an interaction (for tracking)
export async function recordInteraction(
  personaId: string,
  userId: string
): Promise<void> {
  const memory = await getAgentMemory(personaId, userId);
  memory.lastInteraction = new Date();
  memory.interactionCount++;
  await saveAgentMemory(memory);
}

// Get all memories for a persona (across all users, for admin)
export async function getAllPersonaMemories(personaId: string): Promise<AgentMemory[]> {
  await ensureDirectories();
  const personaDir = path.join(MEMORY_DIR, personaId);
  
  try {
    const files = await fs.readdir(personaDir);
    const memories: AgentMemory[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await fs.readFile(path.join(personaDir, file), 'utf8');
        const memory = JSON.parse(data);
        memory.lastInteraction = new Date(memory.lastInteraction);
        memory.entries = memory.entries.map((e: any) => ({
          ...e,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt)
        }));
        memories.push(memory);
      }
    }
    
    return memories;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Clear all memories for a user-persona pair
export async function clearMemories(personaId: string, userId: string): Promise<void> {
  const memoryPath = getMemoryPath(personaId, userId);
  try {
    await fs.unlink(memoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
