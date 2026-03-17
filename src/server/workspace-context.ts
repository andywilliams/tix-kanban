/**
 * Workspace Context System
 * 
 * Provides rich workspace awareness to personas including:
 * - Repo registry with auto-discovery
 * - Board state summary
 * - Knowledge base access
 * - Reports & history
 * - Token-budgeted context assembly
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getAllTasks } from './storage.js';
import { getAllStandupEntries, StandupEntry } from './standup-storage.js';
import { getAllReports } from './reports-storage.js';
import { searchKnowledgeDocs, getAllKnowledgeDocs, KnowledgeMetadata } from './knowledge-storage.js';
import { Persona, Task } from '../client/types/index.js';
import { estimateTokens } from './token-budget.js';

// Token budget limits
const MAX_WORKSPACE_CONTEXT_TOKENS = 2000;

export interface RepoInfo {
  name: string;
  path: string;
  description?: string;
  techStack?: string[];
  keyFiles?: string[];
  packageJson?: any;
  readme?: string;
}

export interface BoardSummary {
  totalTasks: number;
  byStatus: {
    backlog: number;
    'in-progress': number;
    'auto-review': number;
    review: number;
    done: number;
  };
  byPersona: Record<string, number>;
  inProgress: Array<{
    id: string;
    title: string;
    persona?: string;
    priority: number;
  }>;
  blocked: Array<{
    id: string;
    title: string;
    reason?: string;
  }>;
  stale: Array<{
    id: string;
    title: string;
    daysSinceUpdate: number;
  }>;
  recentCompletions: Array<{
    id: string;
    title: string;
    completedAt: Date;
  }>;
  highPriorityBacklog: Array<{
    id: string;
    title: string;
    priority: number;
  }>;
}

export interface WorkspaceContext {
  repos: RepoInfo[];
  board: BoardSummary;
  knowledge: KnowledgeMetadata[];
  recentStandups: StandupEntry[];
  recentReports: any[];
  estimatedTokens: number;
}

export async function discoverRepos(): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];
  const searchPaths = [
    path.join(os.homedir(), 'repos'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'projects'),
  ];
  for (const searchPath of searchPaths) {
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const repoPath = path.join(searchPath, entry.name);
        try {
          await fs.access(path.join(repoPath, '.git'));
          const info = await loadRepoInfo(entry.name, repoPath);
          repos.push(info);
        } catch {}
      }
    } catch {}
  }
  return repos;
}

async function loadRepoInfo(name: string, repoPath: string): Promise<RepoInfo> {
  const info: RepoInfo = { name, path: repoPath };
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8'));
    info.packageJson = pkg;
    info.description = pkg.description;
    const deps = {...pkg.dependencies, ...pkg.devDependencies};
    const techStack: string[] = [];
    if (deps.react) techStack.push('React');
    if (deps.express) techStack.push('Express');
    if (deps['@anthropic-ai/sdk']) techStack.push('Anthropic SDK');
    if (deps.typescript) techStack.push('TypeScript');
    if (deps.vite) techStack.push('Vite');
    if (pkg.type === 'module') techStack.push('ESM');
    info.techStack = techStack;
  } catch {}
  try {
    const readme = await fs.readFile(path.join(repoPath, 'README.md'), 'utf-8');
    info.readme = readme.split('\n\n')[0].replace(/^#+ /, '').trim();
  } catch {}
  try {
    const entries = await fs.readdir(repoPath);
    const keyFiles: string[] = [];
    if (entries.includes('ARCHITECTURE.md')) keyFiles.push('ARCHITECTURE.md');
    if (entries.includes('API.md')) keyFiles.push('API.md');
    if (entries.includes('API-REFERENCE.md')) keyFiles.push('API-REFERENCE.md');
    if (entries.includes('docs')) keyFiles.push('docs/');
    if (entries.includes('.github')) keyFiles.push('.github/workflows/');
    info.keyFiles = keyFiles;
  } catch {}
  return info;
}

export async function getBoardSummary(): Promise<BoardSummary> {
  const tasks = await getAllTasks();
  const summary: BoardSummary = {
    totalTasks: tasks.length,
    byStatus: { backlog: 0, 'in-progress': 0, 'auto-review': 0, review: 0, done: 0 },
    byPersona: {},
    inProgress: [],
    blocked: [],
    stale: [],
    recentCompletions: [],
    highPriorityBacklog: [],
  };
  const now = Date.now();
  for (const task of tasks) {
    const status = task.status as keyof typeof summary.byStatus;
    if (status in summary.byStatus) summary.byStatus[status]++;
    if (task.persona) summary.byPersona[task.persona] = (summary.byPersona[task.persona] || 0) + 1;
    if (task.status === 'in-progress') summary.inProgress.push({ id: task.id, title: task.title, persona: task.persona, priority: task.priority ?? 500 });
    if (task.tags?.some(t => t.toLowerCase().includes('blocked')) || task.description?.toLowerCase().includes('blocker')) {
      summary.blocked.push({ id: task.id, title: task.title, reason: task.description?.match(/blocker:?\s*(.+)/i)?.[1] });
    }
    if (task.status !== 'done') {
      const daysSinceUpdate = (now - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate >= 7) summary.stale.push({ id: task.id, title: task.title, daysSinceUpdate: Math.floor(daysSinceUpdate) });
    }
    if (task.status === 'done' && (now - new Date(task.updatedAt).getTime()) / (1000 * 60 * 60 * 24) <= 7) {
      summary.recentCompletions.push({ id: task.id, title: task.title, completedAt: new Date(task.updatedAt) });
    }
    if (task.status === 'backlog' && (task.priority ?? 500) < 300) {
      summary.highPriorityBacklog.push({ id: task.id, title: task.title, priority: task.priority ?? 500 });
    }
  }
  summary.inProgress.sort((a, b) => a.priority - b.priority).splice(5);
  summary.highPriorityBacklog.sort((a, b) => a.priority - b.priority).splice(5);
  summary.recentCompletions.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime()).splice(5);
  summary.stale.sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate).splice(5);
  summary.blocked.splice(5);
  return summary;
}

export async function buildWorkspaceContext(options?: {
  includeRepos?: boolean;
  includeBoard?: boolean;
  includeKnowledge?: boolean;
  includeHistory?: boolean;
  knowledgeQuery?: string;
  maxTokens?: number;
}): Promise<WorkspaceContext> {
  const opts = { includeRepos: true, includeBoard: true, includeKnowledge: true, includeHistory: true, maxTokens: MAX_WORKSPACE_CONTEXT_TOKENS, ...options };
  const context: WorkspaceContext = {
    repos: [],
    board: { totalTasks: 0, byStatus: { backlog: 0, 'in-progress': 0, 'auto-review': 0, review: 0, done: 0 }, byPersona: {}, inProgress: [], blocked: [], stale: [], recentCompletions: [], highPriorityBacklog: [] },
    knowledge: [],
    recentStandups: [],
    recentReports: [],
    estimatedTokens: 0,
  };
  if (opts.includeRepos) context.repos = await discoverRepos();
  if (opts.includeBoard) context.board = await getBoardSummary();
  if (opts.includeKnowledge) {
    if (opts.knowledgeQuery) {
      const results = await searchKnowledgeDocs({ keywords: opts.knowledgeQuery, limit: 10 });
      context.knowledge = results.map(r => r.doc);
    } else {
      context.knowledge = (await getAllKnowledgeDocs()).slice(0, 10);
    }
  }
  if (opts.includeHistory) {
    context.recentStandups = (await getAllStandupEntries()).slice(0, 3);
    try { context.recentReports = (await getAllReports()).slice(0, 3); } catch {}
  }
  context.estimatedTokens = context.repos.length * 100 + 400;
  
  // Token budgeting: trim repos if over limit (only repos are rendered)
  if (opts.maxTokens && context.estimatedTokens > opts.maxTokens) {
    const ratio = opts.maxTokens / context.estimatedTokens;
    // Trim repos while keeping minimum
    if (context.repos.length > 1) context.repos = context.repos.slice(0, Math.max(1, Math.floor(context.repos.length * ratio)));
    // Recalculate estimated tokens after trimming
    context.estimatedTokens = context.repos.length * 100 + 400;
  }
  return context;
}

export function renderWorkspaceContext(context: WorkspaceContext, tokenBudget: number = MAX_WORKSPACE_CONTEXT_TOKENS): string {
  const sections: string[] = [];
  // Note: Board state is provided separately via buildFilteredBoardContext - don't duplicate it here
  if (context.repos.length > 0) {
    sections.push('## Workspace Repositories\n');
    for (const repo of context.repos.slice(0, 5)) {
      sections.push(`### ${repo.name}`);
      if (repo.description) sections.push(repo.description);
      if (repo.techStack?.length) sections.push(`Tech: ${repo.techStack.join(', ')}`);
      if (repo.keyFiles?.length) sections.push(`Key files: ${repo.keyFiles.join(', ')}`);
      sections.push('');
    }
  }

  const fullContent = sections.join('\n');
  const estimatedTokens = estimateTokens(fullContent);
  return estimatedTokens > tokenBudget ? fullContent.substring(0, tokenBudget * 4) + '\n\n_[Context truncated to fit token budget]_' : fullContent;
}

let _cachedContext: WorkspaceContext | null = null;
let _cacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getCachedWorkspaceContext(forceRefresh: boolean = false): Promise<WorkspaceContext> {
  const now = Date.now();
  if (!forceRefresh && _cachedContext && (now - _cacheTime) < CACHE_TTL_MS) return _cachedContext;
  _cachedContext = await buildWorkspaceContext();
  _cacheTime = now;
  return _cachedContext;
}

export function invalidateWorkspaceCache(): void {
  _cachedContext = null;
  _cacheTime = 0;
}
