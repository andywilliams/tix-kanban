export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStage[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStage {
  id: string;
  name: string;
  persona: string; // Persona ID that handles this stage
  action: PipelineAction;
  autoAdvance: boolean; // Whether to auto-advance after completion
  maxRetryAttempts: number; // Default 3
  conditions?: PipelineCondition[]; // Optional conditions for stage entry
}

export interface PipelineAction {
  type: 'work' | 'review' | 'test' | 'deploy' | 'custom';
  description: string;
  prompt?: string; // Custom prompt for the persona at this stage
  requiredTags?: string[]; // Tags that must be present on task
  outputRequirements?: string[]; // What this stage should produce (e.g., ["PR", "tests", "documentation"])
}

export interface PipelineCondition {
  type: 'task_has_tag' | 'task_priority_above' | 'previous_stage_success' | 'custom';
  value: string | number;
}

export interface TaskPipelineState {
  taskId: string;
  pipelineId: string;
  currentStageId: string;
  stageAttempts: Record<string, number>; // stageId -> attempt count
  stageHistory: TaskStageHistory[];
  isStuck: boolean; // True if stage exceeded max retry attempts
  stuckReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskStageHistory {
  stageId: string;
  persona: string;
  startedAt: Date;
  completedAt?: Date;
  result: 'success' | 'failure' | 'rejected' | 'timeout';
  feedback?: string; // Comments from reviewer or error messages
  attempt: number; // Which attempt this was (1, 2, 3, etc.)
  outputs?: TaskStageOutput[]; // What was produced at this stage
}

export interface TaskStageOutput {
  type: 'comment' | 'link' | 'file' | 'tag';
  content: string;
  metadata?: Record<string, any>;
}

// Built-in pipeline templates
export const PIPELINE_TEMPLATES: Omit<Pipeline, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: "Standard Development",
    description: "Developer → QA Engineer → Security Reviewer → Human Review",
    isActive: true,
    stages: [
      {
        id: "dev",
        name: "Development",
        persona: "general-developer",
        autoAdvance: true,
        maxRetryAttempts: 3,
        action: {
          type: "work",
          description: "Implement the feature or fix described in the task",
          outputRequirements: ["PR", "tests"]
        }
      },
      {
        id: "qa",
        name: "Quality Assurance",
        persona: "qa-engineer",
        autoAdvance: false, // QA needs to explicitly approve
        maxRetryAttempts: 2,
        action: {
          type: "review",
          description: "Review the implementation for quality, test coverage, and functionality",
          outputRequirements: ["approval", "test_results"]
        }
      },
      {
        id: "security",
        name: "Security Review",
        persona: "security-reviewer",
        autoAdvance: false,
        maxRetryAttempts: 2,
        action: {
          type: "review",
          description: "Review for security vulnerabilities and compliance",
          outputRequirements: ["security_approval"]
        }
      }
    ]
  },
  {
    name: "Documentation Only",
    description: "Tech Writer → Review",
    isActive: true,
    stages: [
      {
        id: "writing",
        name: "Technical Writing",
        persona: "tech-writer",
        autoAdvance: true,
        maxRetryAttempts: 3,
        action: {
          type: "work",
          description: "Write comprehensive documentation",
          outputRequirements: ["documentation"]
        }
      }
    ]
  },
  {
    name: "Bug Fix Pipeline",
    description: "Bug Fixer → QA Testing → Deploy",
    isActive: true,
    stages: [
      {
        id: "debug",
        name: "Debug & Fix",
        persona: "bug-fixer",
        autoAdvance: true,
        maxRetryAttempts: 3,
        action: {
          type: "work",
          description: "Investigate and fix the reported bug",
          outputRequirements: ["PR", "root_cause_analysis"]
        }
      },
      {
        id: "test",
        name: "Bug Verification",
        persona: "qa-engineer",
        autoAdvance: false,
        maxRetryAttempts: 2,
        action: {
          type: "test",
          description: "Verify the bug is fixed and no regressions introduced",
          outputRequirements: ["test_confirmation"]
        }
      }
    ]
  }
];