/**
 * Chat Tool System
 * 
 * Provides tool definitions and execution for personas to take actions during conversation.
 * Uses Claude's tool_use API to let personas create tasks, read files, search code, etc.
 */

import { Persona, Task } from '../client/types/index.js';
import { createTask, updateTask as storageUpdateTask, getAllTasks, getTask, addCommentToTask } from './storage.js';
import { addMessage } from './chat-storage.js';
import { getUserSettings } from './user-settings.js';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Tool definition for Claude's tool_use API
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Get tools available to a specific persona
 */
export function getPersonaTools(persona: Persona): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Board tools - available to PM, Developer, QA, Code Reviewer
  if (['product-manager', 'developer', 'qa', 'code-reviewer'].includes(persona.id)) {
    tools.push(
      TOOL_DEFINITIONS.createTask,
      TOOL_DEFINITIONS.updateTask,
      TOOL_DEFINITIONS.listTasks,
      TOOL_DEFINITIONS.getTask,
      TOOL_DEFINITIONS.addComment
    );
  }

  // Codebase tools - available to Developer, Code Reviewer, Tech Writer, PM
  if (['developer', 'code-reviewer', 'tech-writer', 'product-manager'].includes(persona.id)) {
    tools.push(
      TOOL_DEFINITIONS.readFile,
      TOOL_DEFINITIONS.listFiles,
      TOOL_DEFINITIONS.searchCode
    );
  }

  return tools;
}

/**
 * Tool definitions using Claude's tool_use schema
 */
const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  createTask: {
    name: 'createTask',
    description: 'Create a new task on the kanban board. Use this when the user asks you to create a ticket or add work to the board.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short, descriptive title for the task'
        },
        description: {
          type: 'string',
          description: 'Detailed description including acceptance criteria, technical notes, dependencies'
        },
        priority: {
          type: 'number',
          description: 'Priority level: 100=critical, 200=high, 300=medium, 400=normal, 500=low',
          enum: [100, 200, 300, 400, 500]
        },
        assignee: {
          type: 'string',
          description: 'Persona ID to assign the task to (e.g., "developer", "qa", "tech-writer")'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags/labels for categorization (e.g., ["api", "backend", "bug"])'
        },
        repo: {
          type: 'string',
          description: 'Repository name if task is repo-specific (e.g., "tix-kanban", "em-transactions-api")'
        }
      },
      required: ['title', 'description']
    }
  },

  updateTask: {
    name: 'updateTask',
    description: 'Update an existing task. Use this to change status, priority, assignee, or other task fields.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to update'
        },
        fields: {
          type: 'object',
          description: 'Fields to update (status, priority, assignee, title, description, tags, etc.)',
          properties: {
            status: {
              type: 'string',
              enum: ['backlog', 'in-progress', 'review', 'auto-review', 'done', 'archived']
            },
            priority: {
              type: 'number',
              enum: [100, 200, 300, 400, 500]
            },
            assignee: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            tags: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      },
      required: ['taskId', 'fields']
    }
  },

  listTasks: {
    name: 'listTasks',
    description: 'List tasks from the kanban board with optional filtering. Use this to check task status, find work, or answer questions about the board.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['backlog', 'in-progress', 'review', 'auto-review', 'done', 'archived']
        },
        assignee: {
          type: 'string',
          description: 'Filter by assigned persona ID'
        },
        repo: {
          type: 'string',
          description: 'Filter by repository name'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (tasks must have ALL specified tags)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 20)'
        }
      }
    }
  },

  getTask: {
    name: 'getTask',
    description: 'Get full details of a specific task by ID. Use this when you need complete task information.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to retrieve'
        }
      },
      required: ['taskId']
    }
  },

  addComment: {
    name: 'addComment',
    description: 'Add a comment to a task. Use this to provide updates, ask questions, or collaborate on a task.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to comment on'
        },
        body: {
          type: 'string',
          description: 'The comment text (supports markdown)'
        }
      },
      required: ['taskId', 'body']
    }
  },

  readFile: {
    name: 'readFile',
    description: 'Read the contents of a file from a repository. Use this to review code, check implementations, or understand existing functionality.',
    input_schema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name (e.g., "tix-kanban")'
        },
        path: {
          type: 'string',
          description: 'File path relative to repository root (e.g., "src/server/storage.ts")'
        }
      },
      required: ['repo', 'path']
    }
  },

  listFiles: {
    name: 'listFiles',
    description: 'List files in a directory from a repository. Use this to explore code structure, find relevant files, or understand organization.',
    input_schema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name'
        },
        path: {
          type: 'string',
          description: 'Directory path relative to repository root (use "." for root)'
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list files recursively (default: false)'
        }
      },
      required: ['repo', 'path']
    }
  },

  searchCode: {
    name: 'searchCode',
    description: 'Search for code patterns or text across a repository. Use this to find function definitions, usage examples, or specific patterns.',
    input_schema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository name to search in'
        },
        query: {
          type: 'string',
          description: 'Search query (supports regex patterns)'
        },
        filePattern: {
          type: 'string',
          description: 'Optional file pattern to limit search (e.g., "*.ts", "src/**/*.tsx")'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        }
      },
      required: ['repo', 'query']
    }
  }
};

/**
 * Execute a tool call
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  persona: Persona
): Promise<ToolResult> {
  try {
    // Check if persona has access to this tool
    const personaTools = getPersonaTools(persona);
    if (!personaTools.some(t => t.name === toolName)) {
      return {
        success: false,
        content: '',
        error: `Persona ${persona.name} does not have access to tool: ${toolName}`
      };
    }

    // Execute the appropriate tool
    switch (toolName) {
      case 'createTask':
        return await executeCreateTask(toolInput, persona);
      case 'updateTask':
        return await executeUpdateTask(toolInput, persona);
      case 'listTasks':
        return await executeListTasks(toolInput);
      case 'getTask':
        return await executeGetTask(toolInput);
      case 'addComment':
        return await executeAddComment(toolInput, persona);
      case 'readFile':
        return await executeReadFile(toolInput);
      case 'listFiles':
        return await executeListFiles(toolInput);
      case 'searchCode':
        return await executeSearchCode(toolInput);
      default:
        return {
          success: false,
          content: '',
          error: `Unknown tool: ${toolName}`
        };
    }
  } catch (error) {
    console.error(`Tool execution failed: ${toolName}`, error);
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Tool execution implementations
 */

async function executeCreateTask(input: any, persona: Persona): Promise<ToolResult> {
  const task = await createTask({
    title: input.title,
    description: input.description || '',
    status: 'backlog',
    priority: input.priority || 400,
    assignee: input.assignee,
    persona: input.assignee,
    tags: input.labels || [],
    repo: input.repo
  }, persona.name);

  const content = `Created task: ${task.title} (ID: ${task.id})
Status: ${task.status}
Priority: P${task.priority}${task.assignee ? `\nAssigned to: ${task.assignee}` : ''}${task.tags.length > 0 ? `\nTags: ${task.tags.join(', ')}` : ''}`;

  return { success: true, content };
}

async function executeUpdateTask(input: any, persona: Persona): Promise<ToolResult> {
  const task = await getTask(input.taskId);
  if (!task) {
    return { success: false, content: '', error: `Task not found: ${input.taskId}` };
  }

  await storageUpdateTask(input.taskId, input.fields, persona.name);

  const updatedFields = Object.keys(input.fields).join(', ');
  const content = `Updated task ${input.taskId}: ${updatedFields}`;

  return { success: true, content };
}

async function executeListTasks(input: any): Promise<ToolResult> {
  let tasks = await getAllTasks();

  // Apply filters
  if (input.status) {
    tasks = tasks.filter(t => t.status === input.status);
  }
  if (input.assignee) {
    tasks = tasks.filter(t => t.assignee === input.assignee || t.persona === input.assignee);
  }
  if (input.repo) {
    tasks = tasks.filter(t => t.repo === input.repo);
  }
  if (input.tags && input.tags.length > 0) {
    tasks = tasks.filter(t => input.tags.every((tag: string) => t.tags.includes(tag)));
  }

  // Apply limit
  const limit = input.limit || 20;
  tasks = tasks.slice(0, limit);

  if (tasks.length === 0) {
    return { success: true, content: 'No tasks found matching the filters.' };
  }

  const content = tasks.map(t => 
    `- ${t.id}: ${t.title} [${t.status}]${t.assignee ? ` → ${t.assignee}` : ''} P${t.priority}`
  ).join('\n');

  return { success: true, content: `Found ${tasks.length} tasks:\n${content}` };
}

async function executeGetTask(input: any): Promise<ToolResult> {
  const task = await getTask(input.taskId);
  if (!task) {
    return { success: false, content: '', error: `Task not found: ${input.taskId}` };
  }

  const content = formatTaskDetails(task);
  return { success: true, content };
}

async function executeAddComment(input: any, persona: Persona): Promise<ToolResult> {
  const task = await getTask(input.taskId);
  if (!task) {
    return { success: false, content: '', error: `Task not found: ${input.taskId}` };
  }

  // Add comment to task channel
  const channelId = `task-${input.taskId}`;
  await addMessage(channelId, persona.name, 'persona', input.body);

  // Persist comment to task
  await addCommentToTask(input.taskId, input.body, persona.name);

  return { success: true, content: `Added comment to task ${input.taskId}` };
}

async function executeReadFile(input: any): Promise<ToolResult> {
  const repoPath = await resolveRepoPath(input.repo);
  if (!repoPath) {
    return { success: false, content: '', error: `Repository not found: ${input.repo}` };
  }

  const filePath = path.join(repoPath, input.path);
  
  // Path traversal check: resolve to absolute path and verify it stays within repo
  const resolvedPath = path.resolve(filePath);
  const resolvedRepoPath = path.resolve(repoPath);
  if (!resolvedPath.startsWith(resolvedRepoPath + path.sep) && resolvedPath !== resolvedRepoPath) {
    return { success: false, content: '', error: 'Path traversal attempt detected' };
  }
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    // Limit output to 5000 chars to avoid overwhelming context
    const truncated = content.length > 5000 
      ? content.substring(0, 5000) + '\n\n[... truncated, file is longer ...]'
      : content;
    
    return { 
      success: true, 
      content: `File: ${input.path}\n\`\`\`\n${truncated}\n\`\`\`` 
    };
  } catch (error) {
    return { 
      success: false, 
      content: '', 
      error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

async function executeListFiles(input: any): Promise<ToolResult> {
  const repoPath = await resolveRepoPath(input.repo);
  if (!repoPath) {
    return { success: false, content: '', error: `Repository not found: ${input.repo}` };
  }

  const dirPath = path.join(repoPath, input.path);
  
  // Path traversal check: verify path stays within repo
  const resolvedPath = path.resolve(dirPath);
  const resolvedRepoPath = path.resolve(repoPath);
  if (!resolvedPath.startsWith(resolvedRepoPath + path.sep) && resolvedPath !== resolvedRepoPath) {
    return { success: false, content: '', error: 'Path traversal attempt detected' };
  }
  
  try {
    if (input.recursive) {
      // Use find for recursive listing - spawn with args array to prevent injection
      const { stdout } = await execFileAsync('find', [dirPath, '-type', 'f'], { maxBuffer: 1024 * 1024 });
      const files = stdout.trim().split('\n')
        .map(f => path.relative(repoPath, f))
        .filter(f => !f.startsWith('.git/') && !f.startsWith('node_modules/'))
        .slice(0, 100); // Limit to 100 files
      
      return { 
        success: true, 
        content: `Found ${files.length} files in ${input.path}:\n${files.join('\n')}${files.length === 100 ? '\n[... truncated at 100 files ...]' : ''}` 
      };
    } else {
      // Non-recursive: just list directory
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const formatted = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);
      
      return { 
        success: true, 
        content: `Contents of ${input.path}:\n${formatted.join('\n')}` 
      };
    }
  } catch (error) {
    return { 
      success: false, 
      content: '', 
      error: `Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

async function executeSearchCode(input: any): Promise<ToolResult> {
  const repoPath = await resolveRepoPath(input.repo);
  if (!repoPath) {
    return { success: false, content: '', error: `Repository not found: ${input.repo}` };
  }

  try {
    const limit = input.limit || 10;
    const filePattern = input.filePattern || '*';
    
    // Use grep for searching - spawn with args array to prevent injection
    // Use -F for fixed-string mode, no regex escaping needed
    const { stdout } = await execFileAsync('grep', ['-rn', '-F', input.query, repoPath, `--include=${filePattern}`], { maxBuffer: 1024 * 1024 });
    
    if (!stdout.trim()) {
      return { success: true, content: `No matches found for: ${input.query}` };
    }

    // Format results (file:line:content) and limit
    const results = stdout.trim().split('\n').slice(0, limit).map(line => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        const [, filePath, lineNum, content] = match;
        const relPath = path.relative(repoPath, filePath);
        return `${relPath}:${lineNum} → ${content.trim()}`;
      }
      return line;
    });

    return { 
      success: true, 
      content: `Found ${results.length} matches:\n${results.join('\n')}` 
    };
  } catch (error: any) {
    // Grep returns exit code 1 if no matches found
    if (error.code === 1) {
      return { success: true, content: `No matches found for: ${input.query}` };
    }
    return { 
      success: false, 
      content: '', 
      error: `Search failed: ${error.message}` 
    };
  }
}

/**
 * Helper: Resolve repository name to filesystem path
 */
async function resolveRepoPath(repoName: string): Promise<string | null> {
  // Validate repoName to prevent path traversal attacks
  if (!repoName || typeof repoName !== 'string') {
    return null;
  }
  
  // Check for path traversal sequences
  if (repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
    return null;
  }

  // Check for Windows drive letters (e.g., "C:", "D:")
  if (/^[a-z]:$/i.test(repoName)) {
    return null;
  }

  const settings = await getUserSettings();
  
  // Check if repo is in repoPaths mapping
  if (settings.repoPaths && settings.repoPaths[repoName]) {
    return settings.repoPaths[repoName];
  }

  // Fallback: check in workspaceDir
  if (settings.workspaceDir) {
    const workspacePath = settings.workspaceDir.startsWith('~') 
      ? path.join(process.env.HOME || '', settings.workspaceDir.slice(1))
      : settings.workspaceDir;
    
    const repoPath = path.join(workspacePath, repoName);
    
    // Validate resolved path stays within workspace
    const resolvedPath = path.resolve(repoPath);
    const resolvedWorkspace = path.resolve(workspacePath);
    if (!resolvedPath.startsWith(resolvedWorkspace + path.sep) && resolvedPath !== resolvedWorkspace) {
      return null; // Path traversal detected
    }
    
    try {
      const stat = await fs.stat(repoPath);
      if (stat.isDirectory()) {
        return repoPath;
      }
    } catch {
      // Not found in workspace
    }
  }

  return null;
}

/**
 * Helper: Format task details for display
 */
function formatTaskDetails(task: Task): string {
  const lines = [
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: P${task.priority}`,
  ];

  if (task.assignee) lines.push(`Assignee: ${task.assignee}`);
  if (task.repo) lines.push(`Repository: ${task.repo}`);
  if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(', ')}`);
  if (task.description) {
    lines.push('');
    lines.push('Description:');
    lines.push(task.description);
  }

  return lines.join('\n');
}
