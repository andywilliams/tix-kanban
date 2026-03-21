/**
 * Memory Decay System
 * 
 * Automatically archives old memories based on importance and age:
 * - Low importance: 30 days
 * - Medium importance: 90 days
 * - High importance: never (persists indefinitely)
 */

import { getStructuredMemory, saveStructuredMemory, MemoryEntry } from './persona-memory.js';
import { archiveMemories } from './memory-archive.js';
import { getReinforcementData } from './memory-reinforcement.js';
import { deleteEmbedding } from './memory/index.js';

// Decay thresholds in days
const DECAY_THRESHOLDS = {
  low: 30,
  medium: 90,
  high: Infinity,  // Never decay
};

export interface DecayResult {
  personaId: string;
  evaluated: number;
  archived: number;
  archivedByImportance: {
    low: number;
    medium: number;
    high: number;
  };
}

/**
 * Run decay process for a single persona
 */
export async function decayPersonaMemories(personaId: string): Promise<DecayResult> {
  const memory = await getStructuredMemory(personaId);
  const reinforcement = await getReinforcementData(personaId);
  
  const now = Date.now();
  const toArchive: MemoryEntry[] = [];
  const archivedByImportance = { low: 0, medium: 0, high: 0 };
  
  for (const entry of memory.entries) {
    const ageInDays = (now - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const threshold = DECAY_THRESHOLDS[entry.importance];
    
    // Check if memory has been recently used (last 7 days)
    const usage = reinforcement.usage[entry.id];
    const recentlyUsed = usage && 
      (now - new Date(usage.lastRecalled).getTime()) < 7 * 24 * 60 * 60 * 1000;
    
    // Don't archive if recently used, regardless of age
    if (recentlyUsed) continue;
    
    // Archive if older than threshold
    if (ageInDays > threshold) {
      toArchive.push(entry);
      archivedByImportance[entry.importance]++;
    }
  }
  
  // Remove archived entries from active memory
  if (toArchive.length > 0) {
    const archivedIds = new Set(toArchive.map(e => e.id));
    memory.entries = memory.entries.filter(e => !archivedIds.has(e.id));
    await saveStructuredMemory(memory);
    
    // Move to archive
    await archiveMemories(personaId, toArchive, 'age');
    
    // Clean up embeddings
    for (const entry of toArchive) {
      try {
        await deleteEmbedding(personaId, entry.id);
      } catch (err) {
        console.warn(`[Decay] Failed to delete embedding for entry ${entry.id}:`, err);
      }
    }
  }
  
  return {
    personaId,
    evaluated: memory.entries.length + toArchive.length,
    archived: toArchive.length,
    archivedByImportance,
  };
}

/**
 * Run decay process for all personas
 */
export async function decayAllMemories(personaIds: string[]): Promise<DecayResult[]> {
  const results: DecayResult[] = [];
  
  for (const personaId of personaIds) {
    try {
      const result = await decayPersonaMemories(personaId);
      results.push(result);
    } catch (error) {
      console.error(`[Decay] Failed to decay memories for persona ${personaId}:`, error);
      results.push({
        personaId,
        evaluated: 0,
        archived: 0,
        archivedByImportance: { low: 0, medium: 0, high: 0 },
      });
    }
  }
  
  return results;
}

/**
 * Get decay preview (what would be archived without actually doing it)
 */
export async function previewDecay(personaId: string): Promise<{
  wouldArchive: MemoryEntry[];
  byImportance: {
    low: number;
    medium: number;
    high: number;
  };
}> {
  const memory = await getStructuredMemory(personaId);
  const reinforcement = await getReinforcementData(personaId);
  
  const now = Date.now();
  const wouldArchive: MemoryEntry[] = [];
  const byImportance = { low: 0, medium: 0, high: 0 };
  
  for (const entry of memory.entries) {
    const ageInDays = (now - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const threshold = DECAY_THRESHOLDS[entry.importance];
    
    const usage = reinforcement.usage[entry.id];
    const recentlyUsed = usage && 
      (now - new Date(usage.lastRecalled).getTime()) < 7 * 24 * 60 * 60 * 1000;
    
    if (recentlyUsed) continue;
    
    if (ageInDays > threshold) {
      wouldArchive.push(entry);
      byImportance[entry.importance]++;
    }
  }
  
  return { wouldArchive, byImportance };
}

/**
 * Manually archive specific memories
 */
export async function manualArchive(
  personaId: string,
  memoryIds: string[]
): Promise<number> {
  const memory = await getStructuredMemory(personaId);
  
  const toArchive = memory.entries.filter(e => memoryIds.includes(e.id));
  
  if (toArchive.length === 0) return 0;
  
  // Remove from active memory
  const archivedIds = new Set(memoryIds);
  memory.entries = memory.entries.filter(e => !archivedIds.has(e.id));
  await saveStructuredMemory(memory);
  
  // Move to archive
  await archiveMemories(personaId, toArchive, 'manual');
  
  // Clean up embeddings
  for (const entry of toArchive) {
    try {
      await deleteEmbedding(personaId, entry.id);
    } catch (err) {
      console.warn(`[Decay] Failed to delete embedding for entry ${entry.id}:`, err);
    }
  }
  
  return toArchive.length;
}
