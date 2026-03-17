/**
 * Project Memory System - Shared knowledge base for all personas
 * 
 * NOTE: Scaffolded for future integration. Functions are used by chat-tools.ts when wired in.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { estimateTokens } from './token-budget.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const PROJECT_MEMORY_PATH = path.join(STORAGE_DIR, 'project-memory.json');

// Module-level promise chain to serialize write operations
let writeChain: Promise<any> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeChain;
  let resolveNext!: (value: T) => void;
  writeChain = new Promise<T>(resolve => { resolveNext = resolve; });
  try {
    await prev;
    return await fn();
  } finally {
    resolveNext(undefined as T);
  }
}


export type ProjectMemoryCategory = 'architecture' | 'convention' | 'lesson' | 'process' | 'decision' | 'context';

export interface ProjectMemoryEntry {
  id: string; category: ProjectMemoryCategory; content: string; keywords: string[];
  source: string; importance: number; createdAt: string; updatedAt: string; mergedCount?: number;
}

export interface ProjectMemory { version: number; entries: ProjectMemoryEntry[]; lastUpdated: string; }

async function ensureStorageDir(): Promise<void> { await fs.mkdir(STORAGE_DIR, { recursive: true }); }

export async function getProjectMemory(): Promise<ProjectMemory> {
  try { return JSON.parse(await fs.readFile(PROJECT_MEMORY_PATH, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [], lastUpdated: new Date().toISOString() }; throw error; }
}

async function saveProjectMemory(memory: ProjectMemory): Promise<void> {
  await ensureStorageDir(); memory.lastUpdated = new Date().toISOString();
  await fs.writeFile(PROJECT_MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

function generateId(): string { return `proj_mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function extractKeywords(content: string): string[] {
  const common = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','as','is','was','are','were','be','been','being','have','has','had','do','does','did','will','would','should','could','can','may','might','must','shall','this','that','these','those','we','use','using','when','always']);
  const words = content.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !common.has(w));
  const counts = new Map<string, number>(); for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).slice(0, 5).map(([w]) => w);
}

export async function addProjectMemoryEntry(category: ProjectMemoryCategory, content: string, source: string, importance: number = 5): Promise<ProjectMemoryEntry> {
  return withWriteLock(async () => {
    const memory = await getProjectMemory(); const lower = content.toLowerCase();
    // Bidirectional match: exact match OR existing includes new OR new includes existing (fixes false positives)
    const existing = memory.entries.find(e => e.category === category && (
      e.content.toLowerCase() === lower || 
      e.content.toLowerCase().includes(lower.slice(0, 50)) ||
      lower.includes(e.content.toLowerCase().slice(0, 50))
    ));
    if (existing) { 
      existing.content = content; 
      existing.importance = Math.max(existing.importance, importance); 
      existing.updatedAt = new Date().toISOString(); 
      existing.mergedCount = (existing.mergedCount || 1) + 1; 
      // Recalculate keywords after merging (fixes stale keywords issue)
      existing.keywords = extractKeywords(content);
      await saveProjectMemory(memory); 
      return existing; 
    }
    const entry: ProjectMemoryEntry = { id: generateId(), category, content, keywords: extractKeywords(content), source, importance, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mergedCount: 1 };
    memory.entries.push(entry); await saveProjectMemory(memory); return entry;
  });
}

export async function removeProjectMemoryEntry(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const memory = await getProjectMemory(); const before = memory.entries.length;
    memory.entries = memory.entries.filter(e => e.id !== id);
    if (memory.entries.length < before) { await saveProjectMemory(memory); return true; } return false;
  });
}

export async function updateProjectMemoryEntry(id: string, updates: Partial<Pick<ProjectMemoryEntry, 'content'|'category'|'importance'>>): Promise<ProjectMemoryEntry|null> {
  return withWriteLock(async () => {
    const memory = await getProjectMemory(); const entry = memory.entries.find(e => e.id === id); if (!entry) return null;
    if (updates.content !== undefined) { entry.content = updates.content; entry.keywords = extractKeywords(updates.content); }
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.importance !== undefined) entry.importance = updates.importance;
    entry.updatedAt = new Date().toISOString(); await saveProjectMemory(memory); return entry;
  });
}

export async function searchProjectMemory(query: string, options: {category?: ProjectMemoryCategory; minImportance?: number; limit?: number} = {}): Promise<ProjectMemoryEntry[]> {
  const memory = await getProjectMemory(); const lower = query.toLowerCase();
  let results = memory.entries.filter(e => (!options.category || e.category === options.category) && (!options.minImportance || e.importance >= options.minImportance) && (e.content.toLowerCase().includes(lower) || e.keywords.some(k => k.includes(lower))));
  results.sort((a,b) => a.importance !== b.importance ? b.importance - a.importance : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return options.limit ? results.slice(0, options.limit) : results;
}

export async function getRelevantProjectMemory(context: string, maxEntries: number = 10): Promise<ProjectMemoryEntry[]> {
  const memory = await getProjectMemory(); const lower = context.toLowerCase(); const words = lower.split(/\s+/).filter(w => w.length > 3);
  const scored = memory.entries.map(entry => {
    let score = 0; const content = entry.content.toLowerCase();
    let hasMatch = false;
    for (const k of entry.keywords) if (lower.includes(k)) { score += 3; hasMatch = true; }
    for (const w of words) if (content.includes(w)) { score += 1; hasMatch = true; }
    // Only add importance bonus when there's keyword/word match (fixes relevance filter)
    if (hasMatch) score += entry.importance / 2;
    const days = (Date.now() - new Date(entry.createdAt).getTime()) / (1000*60*60*24);
    // Only apply recency bonus if there's a keyword/word match (fixes recency leak)
    if (hasMatch && days < 30) score += 1;
    return { entry, score };
  });
  return scored.filter(s => s.score > 0).sort((a,b) => b.score - a.score).slice(0, maxEntries).map(s => s.entry);
}

export async function renderProjectMemory(maxTokens: number = 3000, contextQuery?: string): Promise<string> {
  const entries = contextQuery ? await getRelevantProjectMemory(contextQuery, 20) : (await getProjectMemory()).entries.sort((a,b) => b.importance - a.importance).slice(0, 20);
  if (entries.length === 0) return '';
  let out = '## Project Memory\n\nShared knowledge across all personas:\n\n';
  const byCat = new Map<ProjectMemoryCategory, ProjectMemoryEntry[]>();
  for (const e of entries) { if (!byCat.has(e.category)) byCat.set(e.category, []); byCat.get(e.category)!.push(e); }
  const labels: Record<ProjectMemoryCategory, string> = { architecture: '🏗️  Architecture & Design', convention: '📏 Conventions & Standards', lesson: '💡 Lessons Learned', process: '⚙️  Process & Workflow', decision: '🎯 Key Decisions', context: '📝 General Context' };
  for (const [cat, ents] of byCat) { out += `### ${labels[cat]}\n\n`; for (const e of ents) out += `- ${e.importance >= 8 ? '⚠️ ' : ''}${e.content} _(ID: ${e.id})_\n`; out += '\n'; }
  const tokens = estimateTokens(out); if (tokens > maxTokens) out = out.slice(0, maxTokens * 4) + '\n... (truncated)';
  return out;
}

export async function getProjectMemoryStats(): Promise<{totalEntries: number; byCategory: Record<ProjectMemoryCategory, number>; avgImportance: number; topKeywords: string[]}> {
  const memory = await getProjectMemory(); const byCat: Record<ProjectMemoryCategory, number> = {architecture:0, convention:0, lesson:0, process:0, decision:0, context:0};
  let totalImp = 0; const kwCounts = new Map<string, number>();
  for (const e of memory.entries) { byCat[e.category]++; totalImp += e.importance; for (const k of e.keywords) kwCounts.set(k, (kwCounts.get(k)||0)+1); }
  const topKw = Array.from(kwCounts.entries()).sort((a,b) => b[1]-a[1]).slice(0, 10).map(([k]) => k);
  return { totalEntries: memory.entries.length, byCategory: byCat, avgImportance: memory.entries.length > 0 ? totalImp / memory.entries.length : 0, topKeywords: topKw };
}
