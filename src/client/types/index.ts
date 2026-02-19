export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'in-progress' | 'auto-review' | 'review' | 'done';
  priority: number;
  assignee?: string; // Who the task is assigned to (email/name)
  persona?: string; // AI persona type for task handling
  pipelineId?: string; // Pipeline this task is using (if any)
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  estimate?: string;
  repo?: string; // GitHub repo (owner/repo format)
  branch?: string; // Git branch name
  comments?: Comment[];
  links?: Link[];
  rating?: TaskRating; // Human feedback/rating for completed work
  activity?: ActivityLog[]; // State change activity log
  model?: string; // Override AI model for this task
  timeoutMs?: number; // Custom timeout in ms for AI worker (default: 320000 dev, 600000 research)
}

export interface ActivityLog {
  id: string;
  taskId: string;
  type: 'status_change' | 'pr_created' | 'pr_merged' | 'pr_closed' | 'assignment_changed' | 'priority_changed' | 'comment_added' | 'link_added';
  description: string;
  actor: string; // Who performed the action
  timestamp: Date;
  metadata?: {
    from?: string;
    to?: string;
    url?: string;
    [key: string]: any;
  };
}

export interface TaskRating {
  id: string;
  taskId: string;
  rating: 'good' | 'needs-improvement' | 'redo';
  comment?: string;
  ratedBy: string;
  ratedAt: Date;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  author: string;
  createdAt: Date;
}

export interface Link {
  id: string;
  taskId: string;
  url: string;
  title: string;
  type: 'pr' | 'attachment' | 'reference';
}

export interface Persona {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  specialties: string[]; // Areas of expertise (e.g., ["TypeScript", "React", "API Design"])
  stats: PersonaStats;
  model?: string; // Default AI model for this persona
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaMemory {
  memory: string;
  tokenCount: number;
  isLarge: boolean;
}

// Structured memory system
export interface MemoryEntry {
  id: string;
  category: 'preference' | 'instruction' | 'context' | 'relationship' | 'learning' | 'reflection';
  content: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  importance: 'high' | 'medium' | 'low';
}

export interface StructuredMemory {
  version: 2;
  personaId: string;
  entries: MemoryEntry[];
  preferences: { [key: string]: string };
  relationships: { [personName: string]: string };
  lastUpdated: string;
}

// Mood system
export type MoodType = 
  | 'happy' | 'confident' | 'focused' | 'tired' 
  | 'frustrated' | 'bored' | 'proud' | 'curious' | 'neutral';

export interface PersonaMood {
  current: MoodType;
  intensity: number;
  emoji: string;
  statusMessage: string;
  affectsResponse: string;
  lastUpdated: Date;
  recentEvents: Array<{
    type: string;
    timestamp: Date;
    impact: number;
    description: string;
  }>;
}

// Soul/Personality system
export interface PersonaSoul {
  version: 1;
  personaId: string;
  name: string;
  emoji: string;
  archetype: string;
  traits: {
    communication: 'formal' | 'casual' | 'technical' | 'friendly' | 'direct';
    approach: 'methodical' | 'creative' | 'pragmatic' | 'thorough' | 'fast';
    style: 'verbose' | 'concise' | 'balanced';
  };
  voicePatterns: string[];
  catchphrases: string[];
  values: string[];
  dislikes: string[];
  teamDynamics: { [personaName: string]: string };
  notes: string;
}

export interface PersonaStats {
  tasksCompleted: number;
  averageCompletionTime: number; // in minutes
  successRate: number; // 0-100 percentage
  lastActiveAt?: Date;
  ratings: {
    total: number;
    good: number;
    needsImprovement: number;
    redo: number;
    averageRating: number; // 1-3 scale (3=good, 2=needs improvement, 1=redo)
  };
}

export interface Filter {
  tags?: string[];
  persona?: string;
  status?: Task['status'];
}

export interface RepoConfig {
  name: string; // "owner/repo"
  defaultBranch: string; // "main" or "master"
}

export interface GitHubConfig {
  repos: (string | RepoConfig)[]; // List of repos — strings for backwards compat, or objects with per-repo settings
  defaultBranch: string; // Fallback default branch for new repos
  branchPrefix: string; // Prefix for feature branches (e.g., "tix/")
  autoLink: boolean; // Auto-link tasks to PRs when created
}

export interface PRStatus {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  url: string;
  checks: {
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
    status: 'queued' | 'in_progress' | 'completed';
  }[];
  reviews: {
    state: 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENTED' | 'DISMISSED';
    reviewer: string;
  }[];
  mergeable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface GitHubAuthStatus {
  authenticated: boolean;
  username?: string;
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
  type: 'task' | 'general' | 'persona';
  taskId?: string; // Only set for task channels
  personaId?: string; // Only set for persona DM channels
  name: string;
  messages: ChatMessage[];
  lastActivity: Date;
}

export interface Report {
  id: string;
  title: string;
  content: string;
  summary?: string;
  tags: string[];
  taskId?: string;
  createdAt: Date;
  updatedAt: Date;
  filename: string;
}

export interface ReportMetadata {
  id: string;
  title: string;
  summary?: string;
  tags: string[];
  taskId?: string;
  createdAt: Date;
  updatedAt: Date;
  filename: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  description?: string;
  repo?: string;
  area: 'frontend' | 'backend' | 'API' | 'infra' | 'general';
  topic: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  lastVerified?: Date;
  filename: string;
}

export interface KnowledgeMetadata {
  id: string;
  title: string;
  description?: string;
  repo?: string;
  area: 'frontend' | 'backend' | 'API' | 'infra' | 'general';
  topic: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  lastVerified?: Date;
  filename: string;
}

export interface KnowledgeSearchResult {
  doc: KnowledgeMetadata;
  score: number;
}