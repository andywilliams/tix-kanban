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
import { getUserSettings } from './user-settings.js';

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
  
  // Get user-configured workspace directory
  const settings = await getUserSettings();
  let searchPaths: string[] = [];
  
  if (settings.workspaceDir) {
    // Use user-configured workspace directory
    const workspacePath = settings.workspaceDir.startsWith('~')
      ? path.join(os.homedir(), settings.workspaceDir.slice(1))
      : settings.workspaceDir;
    searchPaths = [path.resolve(workspacePath)];
  } else {
    // Fallback to default search paths
    searchPaths = [
      path.join(os.homedir(), 'repos'),
      path.join(os.homedir(), 'code'),
      path.join(os.homedir(), 'projects'),
    ];
  }
  
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
  context.estimatedTokens = context.repos.length * 100 + 400 + context.knowledge.length * 80 + context.recentStandups.length * 150 + context.recentReports.length * 100;
  
  // Token budgeting: trim sections if over limit
  if (opts.maxTokens && context.estimatedTokens > opts.maxTokens) {
    const ratio = opts.maxTokens / context.estimatedTokens;
    // Proportionally trim arrays while keeping minimums
    if (context.repos.length > 1) context.repos = context.repos.slice(0, Math.max(1, Math.floor(context.repos.length * ratio)));
    if (context.knowledge.length > 1) context.knowledge = context.knowledge.slice(0, Math.max(1, Math.floor(context.knowledge.length * ratio)));
    if (context.recentStandups.length > 1) context.recentStandups = context.recentStandups.slice(0, Math.max(1, Math.floor(context.recentStandups.length * ratio)));
    if (context.recentReports.length > 1) context.recentReports = context.recentReports.slice(0, Math.max(1, Math.floor(context.recentReports.length * ratio)));
    // Recalculate estimated tokens after trimming
    context.estimatedTokens = context.repos.length * 100 + 400 + context.knowledge.length * 80 + context.recentStandups.length * 150 + context.recentReports.length * 100;
  }
  return context;
}

export function renderWorkspaceContext(context: WorkspaceContext, tokenBudget: number = MAX_WORKSPACE_CONTEXT_TOKENS): string {
  const sections: string[] = [];
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
  sections.push('## Board State\n');
  sections.push(`**Total tasks:** ${context.board.totalTasks}`);
  sections.push(`- Backlog: ${context.board.byStatus.backlog}`);
  sections.push(`- In Progress: ${context.board.byStatus['in-progress']}`);
  sections.push(`- Review: ${context.board.byStatus.review}`);
  sections.push(`- Done: ${context.board.byStatus.done}\n`);
  if (context.board.inProgress.length > 0) {
    sections.push('**Currently in progress:**');
    for (const task of context.board.inProgress) sections.push(`- ${task.title} (${task.persona || 'unassigned'})`);
    sections.push('');
  }
  if (context.board.highPriorityBacklog.length > 0) {
    sections.push('**High-priority backlog:**');
    for (const task of context.board.highPriorityBacklog) sections.push(`- ${task.title} (priority ${task.priority})`);
    sections.push('');
  }
  if (context.board.blocked.length > 0) {
    sections.push('**Blocked tasks:**');
    for (const task of context.board.blocked) sections.push(`- ${task.title}${task.reason ? ` — ${task.reason}` : ''}`);
    sections.push('');
  }
  if (context.board.stale.length > 0) {
    sections.push('**Stale tasks (no updates in 7+ days):**');
    for (const task of context.board.stale) sections.push(`- ${task.title} (${task.daysSinceUpdate} days)`);
    sections.push('');
  }
  const fullContent = sections.join('\n');
  const estimatedTokens = Math.ceil(fullContent.length / 4);
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
