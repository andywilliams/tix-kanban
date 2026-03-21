/**
 * Memory Archive System
 * 
 * Stores archived memories separately from active memory.
 * Archives are searchable but not included in active context generation.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MemoryEntry, getStructuredMemory, saveStructuredMemory } from './persona-memory.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');

export interface ArchivedMemory extends MemoryEntry {
  archivedAt: Date;
  archiveReason: 'age' | 'low-importance' | 'manual' | 'curation';
}

export interface MemoryArchive {
  version: 1;
  personaId: string;
  entries: ArchivedMemory[];
  lastUpdated: string;
}

// Ensure persona directory exists
async function ensurePersonaDir(personaId: string): Promise<string> {
  const personaDir = path.join(PERSONAS_DIR, personaId);
  await fs.mkdir(personaDir, { recursive: true });
  return personaDir;
}

// Get archive for a persona
export async function getArchive(personaId: string): Promise<MemoryArchive> {
  try {
    const personaDir = await ensurePersonaDir(personaId);
    const archivePath = path.join(personaDir, 'archive.json');
    const content = await fs.readFile(archivePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Return empty archive
      return {
        version: 1,
        personaId,
        entries: [],
        lastUpdated: new Date().toISOString(),
      };
    }
    throw error;
  }
}

// Save archive
export async function saveArchive(archive: MemoryArchive): Promise<void> {
  const personaDir = await ensurePersonaDir(archive.personaId);
  const archivePath = path.join(personaDir, 'archive.json');
  archive.lastUpdated = new Date().toISOString();
  await fs.writeFile(archivePath, JSON.stringify(archive, null, 2), 'utf8');
}

// Archive a memory entry
export async function archiveMemory(
  personaId: string,
  entry: MemoryEntry,
  reason: ArchivedMemory['archiveReason']
): Promise<void> {
  const archive = await getArchive(personaId);
  
  const archivedEntry: ArchivedMemory = {
    ...entry,
    archivedAt: new Date(),
    archiveReason: reason,
  };
  
  archive.entries.push(archivedEntry);
  await saveArchive(archive);
}

// Archive multiple entries at once
export async function archiveMemories(
  personaId: string,
  entries: MemoryEntry[],
  reason: ArchivedMemory['archiveReason']
): Promise<number> {
  if (entries.length === 0) return 0;
  
  const archive = await getArchive(personaId);
  
  for (const entry of entries) {
    const archivedEntry: ArchivedMemory = {
      ...entry,
      archivedAt: new Date(),
      archiveReason: reason,
    };
    archive.entries.push(archivedEntry);
  }
  
  await saveArchive(archive);
  return entries.length;
}

// Search archived memories
export async function searchArchive(
  personaId: string,
  query: string,
  options: {
    category?: MemoryEntry['category'];
    limit?: number;
  } = {}
): Promise<ArchivedMemory[]> {
  const archive = await getArchive(personaId);
  const queryLower = query.toLowerCase();
  
  let results = archive.entries.filter(entry => {
    if (options.category && entry.category !== options.category) {
      return false;
    }
    return entry.content.toLowerCase().includes(queryLower) ||
           entry.tags.some(tag => tag.toLowerCase().includes(queryLower));
  });
  
  // Sort by archive date (most recent first)
  results.sort((a, b) => 
    new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
  );
  
  return options.limit ? results.slice(0, options.limit) : results;
}

// Get archive statistics
export async function getArchiveStats(personaId: string): Promise<{
  totalEntries: number;
  byCategory: Record<MemoryEntry['category'], number>;
  byReason: Record<ArchivedMemory['archiveReason'], number>;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}> {
  const archive = await getArchive(personaId);
  
  const byCategory: Record<MemoryEntry['category'], number> = {
    preference: 0,
    instruction: 0,
    context: 0,
    relationship: 0,
    learning: 0,
    reflection: 0,
  };
  
  const byReason: Record<ArchivedMemory['archiveReason'], number> = {
    age: 0,
    'low-importance': 0,
    manual: 0,
    curation: 0,
  };
  
  let oldestEntry: Date | null = null;
  let newestEntry: Date | null = null;
  
  for (const entry of archive.entries) {
    byCategory[entry.category]++;
    byReason[entry.archiveReason]++;
    
    const archivedDate = new Date(entry.archivedAt);
    if (!oldestEntry || archivedDate < oldestEntry) {
      oldestEntry = archivedDate;
    }
    if (!newestEntry || archivedDate > newestEntry) {
      newestEntry = archivedDate;
    }
  }
  
  return {
    totalEntries: archive.entries.length,
    byCategory,
    byReason,
    oldestEntry,
    newestEntry,
  };
}

// Restore a memory from archive back to active memory
export async function restoreFromArchive(
  personaId: string,
  archivedEntryId: string
): Promise<MemoryEntry | null> {
  const archive = await getArchive(personaId);
  const index = archive.entries.findIndex(e => e.id === archivedEntryId);
  
  if (index === -1) return null;
  
  const [archivedEntry] = archive.entries.splice(index, 1);
  await saveArchive(archive);
  
  // Return the base MemoryEntry (without archive metadata)
  const { archivedAt, archiveReason, ...memoryEntry } = archivedEntry;
  const entry = memoryEntry as MemoryEntry;
  
  // Add the entry back to active memory
  const memory = await getStructuredMemory(personaId);
  memory.entries.push(entry);
  await saveStructuredMemory(memory);
  
  return entry;
}
