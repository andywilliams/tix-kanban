/**
 * Memory Reinforcement System
 * 
 * Tracks memory usage and boosts importance based on:
 * - Recall frequency (how often a memory is retrieved)
 * - Success/failure outcomes
 * - Recency of use
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { MemoryEntry, getStructuredMemory, saveStructuredMemory } from './persona-memory.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PERSONAS_DIR = path.join(STORAGE_DIR, 'personas');

export interface MemoryUsageStats {
  memoryId: string;
  recallCount: number;
  lastRecalled: Date;
  successCount: number;  // Times memory led to successful outcome
  failureCount: number;  // Times memory led to failed outcome
  importanceBoosts: number;  // Number of times importance was boosted
}

export interface ReinforcementData {
  version: 1;
  personaId: string;
  usage: { [memoryId: string]: MemoryUsageStats };
  lastUpdated: string;
}

// Ensure persona directory exists
async function ensurePersonaDir(personaId: string): Promise<string> {
  const personaDir = path.join(PERSONAS_DIR, personaId);
  await fs.mkdir(personaDir, { recursive: true });
  return personaDir;
}

// Get reinforcement data
export async function getReinforcementData(personaId: string): Promise<ReinforcementData> {
  try {
    const personaDir = await ensurePersonaDir(personaId);
    const reinforcementPath = path.join(personaDir, 'reinforcement.json');
    const content = await fs.readFile(reinforcementPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        version: 1,
        personaId,
        usage: {},
        lastUpdated: new Date().toISOString(),
      };
    }
    throw error;
  }
}

// Save reinforcement data
async function saveReinforcementData(data: ReinforcementData): Promise<void> {
  const personaDir = await ensurePersonaDir(data.personaId);
  const reinforcementPath = path.join(personaDir, 'reinforcement.json');
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(reinforcementPath, JSON.stringify(data, null, 2), 'utf8');
}

// Record multiple memory recalls at once
export async function recordMemoryRecalls(
  personaId: string,
  memoryIds: string[]
): Promise<void> {
  if (memoryIds.length === 0) return;
  
  const data = await getReinforcementData(personaId);
  const now = new Date();
  
  for (const memoryId of memoryIds) {
    if (!data.usage[memoryId]) {
      data.usage[memoryId] = {
        memoryId,
        recallCount: 0,
        lastRecalled: now,
        successCount: 0,
        failureCount: 0,
        importanceBoosts: 0,
      };
    }
    
    const stats = data.usage[memoryId];
    stats.recallCount++;
    stats.lastRecalled = now;
  }
  
  await saveReinforcementData(data);
  
  // Check each memory for importance boosts
  for (const memoryId of memoryIds) {
    await checkForImportanceBoost(personaId, memoryId);
  }
}

// Record task outcome (success or failure)
export async function recordTaskOutcome(
  personaId: string,
  memoryIds: string[],
  success: boolean
): Promise<void> {
  if (memoryIds.length === 0) return;
  
  const data = await getReinforcementData(personaId);
  
  for (const memoryId of memoryIds) {
    if (!data.usage[memoryId]) {
      data.usage[memoryId] = {
        memoryId,
        recallCount: 0,
        lastRecalled: new Date(),
        successCount: 0,
        failureCount: 0,
        importanceBoosts: 0,
      };
    }
    
    if (success) {
      data.usage[memoryId].successCount++;
    } else {
      data.usage[memoryId].failureCount++;
    }
  }
  
  await saveReinforcementData(data);
}

// Check if a memory should get an importance boost
async function checkForImportanceBoost(
  personaId: string,
  memoryId: string,
  _stats: MemoryUsageStats // Kept for API compatibility but ignored to avoid stale data
): Promise<void> {
  // Re-read stats from disk to avoid race condition with concurrent calls
  // The caller's stats object may be stale (e.g., importanceBoosts=0) while another
  // concurrent call already updated it, causing double-boosts
  const data = await getReinforcementData(personaId);
  const stats = data.usage[memoryId];
  
  if (!stats) return;
  
  // Boost thresholds:
  // - 5+ recalls: first boost (low -> medium)
  // - 10+ recalls: second boost (medium -> high)
  // - 20+ recalls: additional boosts (already high, no-op but counts)
  
  let shouldBoost = false;
  
  if (stats.recallCount >= 20 && stats.importanceBoosts < 3) {
    shouldBoost = true;
  } else if (stats.recallCount >= 10 && stats.importanceBoosts < 2) {
    shouldBoost = true;
  } else if (stats.recallCount >= 5 && stats.importanceBoosts < 1) {
    shouldBoost = true;
  }
  
  if (!shouldBoost) return;
  
  // Boost the memory importance
  const memory = await getStructuredMemory(personaId);
  const entry = memory.entries.find(e => e.id === memoryId);
  
  if (!entry) return;
  
  // Skip if already at max importance to avoid redundant I/O
  if (entry.importance === 'high') {
    // Still update boost count but don't rewrite memory file
    const reinforcementData = await getReinforcementData(personaId);
    reinforcementData.usage[memoryId].importanceBoosts++;
    await saveReinforcementData(reinforcementData);
    return;
  }
  
  // Boost importance: low -> medium -> high
  if (entry.importance === 'low') {
    entry.importance = 'medium';
  } else if (entry.importance === 'medium') {
    entry.importance = 'high';
  }
  
  await saveStructuredMemory(memory);
  
  // Update boost count
  const reinforcementData = await getReinforcementData(personaId);
  reinforcementData.usage[memoryId].importanceBoosts++;
  await saveReinforcementData(reinforcementData);
}

// Get memories that should be flagged for review (high failure rate)
export async function getFlaggedMemories(
  personaId: string,
  minFailures: number = 3
): Promise<Array<{ memoryId: string; stats: MemoryUsageStats }>> {
  const data = await getReinforcementData(personaId);
  
  const flagged: Array<{ memoryId: string; stats: MemoryUsageStats }> = [];
  
  for (const [memoryId, stats] of Object.entries(data.usage)) {
    // Flag if failures > successes AND failures >= minFailures
    if (stats.failureCount >= minFailures && 
        stats.failureCount > stats.successCount) {
      flagged.push({ memoryId, stats });
    }
  }
  
  // Sort by failure rate (descending)
  flagged.sort((a, b) => b.stats.failureCount - a.stats.failureCount);
  
  return flagged;
}

// Get reinforcement statistics
export async function getReinforcementStats(personaId: string): Promise<{
  totalTrackedMemories: number;
  totalRecalls: number;
  totalSuccesses: number;
  totalFailures: number;
  totalBoosts: number;
  topRecalledMemories: Array<{ memoryId: string; recallCount: number }>;
  recentlyUsed: Array<{ memoryId: string; lastRecalled: Date }>;
}> {
  const data = await getReinforcementData(personaId);
  
  let totalRecalls = 0;
  let totalSuccesses = 0;
  let totalFailures = 0;
  let totalBoosts = 0;
  
  const allStats = Object.values(data.usage);
  
  for (const stats of allStats) {
    totalRecalls += stats.recallCount;
    totalSuccesses += stats.successCount;
    totalFailures += stats.failureCount;
    totalBoosts += stats.importanceBoosts;
  }
  
  // Top 10 most recalled
  const topRecalled = [...allStats]
    .sort((a, b) => b.recallCount - a.recallCount)
    .slice(0, 10)
    .map(s => ({ memoryId: s.memoryId, recallCount: s.recallCount }));
  
  // Recently used (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentlyUsed = allStats
    .filter(s => new Date(s.lastRecalled) > sevenDaysAgo)
    .sort((a, b) => new Date(b.lastRecalled).getTime() - new Date(a.lastRecalled).getTime())
    .slice(0, 10)
    .map(s => ({ memoryId: s.memoryId, lastRecalled: new Date(s.lastRecalled) }));
  
  return {
    totalTrackedMemories: allStats.length,
    totalRecalls,
    totalSuccesses,
    totalFailures,
    totalBoosts,
    topRecalledMemories: topRecalled,
    recentlyUsed,
  };
}
