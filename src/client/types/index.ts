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
  agentActivity?: AgentActivity; // Live agent working status
  testSuites?: TestSuiteLink[]; // Linked apix test suites as acceptance criteria
  testStatus?: TestSuiteStatus; // Aggregated test status
  conversationState?: ConversationState; // Phase 2: Multi-persona collaboration state
  newComment?: Comment; // Used for atomic comment append in updateTask (not persisted)
}

export interface ConversationState {
  taskId: string;
  status: 'idle' | 'active' | 'paused' | 'completed' | 'failed' | 'budget-exceeded' | 'deadlocked';
  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
  currentIteration: number;
  maxIterations: number;
  lastActivityAt: Date;
  idleTimeoutMs: number;
  participants: string[]; // persona IDs
  waitingOn?: string; // persona ID currently expected to respond
  budgetSpent: number; // USD
  budgetCap: number; // USD (per-ticket cap)
  circuitBreakerTripped: boolean;
  expectedSpendRate: number; // USD per iteration (estimated)
}

export interface TestSuiteLink {
  id: string;
  path: string; // Path to apix test YAML (relative to repo root or absolute)
  repo?: string; // GitHub repo (owner/repo) if different from task repo
  addedAt: Date;
  addedBy: string;
}

export interface TestSuiteResult {
  suiteId: string;
  path: string;
  passed: number;
  failed: number;
  errors: number;
  duration_ms: number;
  timestamp: string;
  commitSha?: string;
}

export interface TestSuiteStatus {
  overall: 'passing' | 'failing' | 'error' | 'not-run';
  lastRun?: string;
  results?: TestSuiteResult[];
}

export interface AgentActivity {
  personaId: string;
  personaName: string;
  personaEmoji: string;
  status: 'working' | 'idle';
  startedAt: Date;
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
  triggers?: PersonaTriggers; // Phase 3: Event-driven activation
  providers?: string[]; // Allowed provider names – security boundary
  skills?: string[]; // Capabilities this persona can perform
  budgetCap?: { perTask?: number; perDay?: number }; // Token budget caps
  // Phase 3: Orchestrator pattern
  orchestrator?: boolean; // Can delegate to other personas
  canDelegate?: boolean; // Alias for orchestrator
  specialists?: Array<{ specialty: string; personaIds: string[] }>; // Specialist mappings
  delegationRules?: Array<{
    condition: { field: string; operator: 'equals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan'; value: any };
    action: 'delegate' | 'parallel' | 'sequential';
    targetPersonas: string[];
  }>;
  // Phase 4: Persona invocation permissions
  invocations?: InvocationConfig;
  createdAt: Date;
  updatedAt: Date;
}

// Phase 4: Persona collaboration - invocation permissions
export interface InvocationConfig {
  /** List of persona IDs this persona can invoke */
  allow?: string[];
  /** If true, can invoke any persona */
  allowAll?: boolean;
  /** Maximum concurrent invocations */
  maxConcurrent?: number;
}

export interface PersonaTriggerConfig {
  enabled?: boolean;
  priority?: number;
}

export interface PersonaTriggers {
  onPROpened?: boolean | PersonaTriggerConfig;
  onPRMerged?: boolean | PersonaTriggerConfig;
  onPRClosed?: boolean | PersonaTriggerConfig;
  onPRReviewRequested?: boolean | PersonaTriggerConfig;
  onCIPassed?: boolean | PersonaTriggerConfig;
  onTestFailure?: boolean | PersonaTriggerConfig;
  onTestSuccess?: boolean | PersonaTriggerConfig;
  onStatusChange?: boolean | PersonaTriggerConfig;
  onTaskCreated?: boolean | PersonaTriggerConfig;
  onTaskStarted?: boolean | PersonaTriggerConfig;
  onAssignmentChanged?: boolean | PersonaTriggerConfig;
  onPriorityChanged?: boolean | PersonaTriggerConfig;
  onCommentAdded?: boolean | PersonaTriggerConfig;
  onLinkAdded?: boolean; // boolean only — config objects not supported for this trigger
  onDueDateApproaching?: boolean | PersonaTriggerConfig;
  // Phase 3: Event trigger conditions
  conditions?: Array<{
    field: string;
    operator: 'equals' | 'contains' | 'matches' | 'greaterThan' | 'lessThan';
    value: any;
  }>;
  priority?: number; // Higher priority personas respond first in parallel
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

// Achievement system
export interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'milestone' | 'streak' | 'quality' | 'special' | 'social';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  unlockedAt?: Date;
}

export interface PersonaAchievements {
  personaId: string;
  unlocked: Achievement[];
  progress: { [achievementId: string]: number };
  totalPoints: number;
  rank: string;
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

// Chat types
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
  speakingPersona?: string; // Persona currently holding the floor (turn-taking lock)
  speakingSince?: Date; // When the current speaker acquired the lock
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

// Agent Memory types
export interface AgentMemoryEntry {
  id: string;
  category: 'preferences' | 'context' | 'instructions' | 'relationships';
  content: string;
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
  source: 'explicit' | 'inferred' | 'feedback';
  importance: number;
}

export interface AgentMemory {
  personaId: string;
  userId: string;
  entries: AgentMemoryEntry[];
  lastInteraction: Date;
  interactionCount: number;
}

// Agent Soul/Personality types
export interface PersonalityTrait {
  name: string;
  intensity: number;
  description: string;
}

export interface CommunicationStyle {
  formality: 'casual' | 'balanced' | 'formal';
  verbosity: 'concise' | 'moderate' | 'detailed';
  emoji: boolean;
  humor: 'none' | 'occasional' | 'frequent';
  technicalDepth: 'simple' | 'moderate' | 'deep';
}

export interface TeamRelationship {
  personaId: string;
  relationship: 'collaborator' | 'mentor' | 'mentee' | 'peer' | 'specialist';
  dynamicNote: string;
}

export interface AgentSoul {
  personaId: string;
  corePurpose: string;
  values: string[];
  expertise: string[];
  traits: PersonalityTrait[];
  communicationStyle: CommunicationStyle;
  quirks: string[];
  catchphrases: string[];
  teamRole: string;
  relationships: TeamRelationship[];
  alwaysDo: string[];
  neverDo: string[];
  greetings: string[];
  acknowledgments: string[];
  uncertainResponses: string[];
  createdAt: Date;
  updatedAt: Date;
}
