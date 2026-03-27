import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFile as execFileCallback, spawn } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);

// Base directory for forge workspaces
const FORGE_WORKSPACES_DIR = path.join(os.homedir(), '.forge', 'workspaces');

export interface WorkspaceInfo {
  path: string;
  branch: string;
  taskId: string;
  repoPath: string;
}

/**
 * Ensure the workspaces directory exists
 */
async function ensureWorkspacesDir(): Promise<void> {
  await fs.mkdir(FORGE_WORKSPACES_DIR, { recursive: true });
}

/**
 * Get the workspace path for a specific task
 */
export function getWorkspacePath(taskId: string): string {
  return path.join(FORGE_WORKSPACES_DIR, taskId);
}

/**
 * Check if a workspace already exists for a task
 * @internal - Not currently used, reserved for future workspace management features
 */
export async function workspaceExists(taskId: string): Promise<boolean> {
  const workspacePath = getWorkspacePath(taskId);
  return existsSync(workspacePath);
}

/**
 * Get workspace info if it exists
 * 
 * @param taskId - The task ID
 * @param mainRepoPath - Optional path to the main repository (if known)
 */
export async function getWorkspaceInfo(taskId: string, mainRepoPath?: string): Promise<WorkspaceInfo | null> {
  const workspacePath = getWorkspacePath(taskId);
  
  if (!existsSync(workspacePath)) {
    return null;
  }

  try {
    // Get current branch name
    const { stdout: branch } = await execFile('git', ['branch', '--show-current'], {
      cwd: workspacePath,
    });

    return {
      path: workspacePath,
      branch: branch.trim(),
      taskId,
      repoPath: mainRepoPath ?? workspacePath,
    };
  } catch {
    return null;
  }
}

/**
 * List all existing workspaces
 * @internal - Not currently used, reserved for future workspace management features
 */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  await ensureWorkspacesDir();
  const workspaces: WorkspaceInfo[] = [];

  try {
    const entries = await fs.readdir(FORGE_WORKSPACES_DIR, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const workspaceInfo = await getWorkspaceInfo(entry.name);
        if (workspaceInfo) {
          workspaces.push(workspaceInfo);
        }
      }
    }
  } catch (error) {
    console.error('Failed to list workspaces:', error);
  }

  return workspaces;
}

/**
 * Get the main repository path from a task's repo string
 * 
 * @param repo - GitHub repo in format "owner/repo" or local path
 * @param workspaceDir - Optional workspace directory to resolve against
 * @returns Resolved local path to the repo
 */
export async function resolveRepoPath(repo: string, workspaceDir?: string): Promise<string> {
  // If it's already an absolute path, use it
  if (path.isAbsolute(repo)) {
    return repo;
  }

  // If it contains a slash, treat it as owner/repo format
  if (repo.includes('/')) {
    const [owner, repoName] = repo.split('/');
    
    // First try to find it in common locations
    const candidates = [
      // Workspace directory + owner/repo
      workspaceDir ? path.join(workspaceDir, owner, repoName) : null,
      // Workspace directory + repoName
      workspaceDir ? path.join(workspaceDir, repoName) : null,
      // ~/repos/repo
      path.join(os.homedir(), 'repos', repoName),
      // ~/dev/repo
      path.join(os.homedir(), 'dev', repoName),
      // ~/code/repo
      path.join(os.homedir(), 'code', repoName),
      // ~/.tix-kanban/repos/repo
      path.join(os.homedir(), '.tix-kanban', 'repos', repoName),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }

    // Fall back to workspaceDir/repoName or just the repo name
    if (workspaceDir) {
      return path.join(workspaceDir, repoName);
    }
    return path.join(os.homedir(), 'repos', repoName);
  }

  // Single word - treat as repo name
  return workspaceDir 
    ? path.join(workspaceDir, repo)
    : path.join(os.homedir(), 'repos', repo);
}

/**
 * Create an isolated workspace for a task using git worktree
 * 
 * @param taskId - The task ID (e.g., "MN687BEK130CQI")
 * @param repoPath - Local path to the main repository
 * @returns WorkspaceInfo with path and branch details
 */
export async function createWorkspace(taskId: string, repoPath: string): Promise<WorkspaceInfo> {
  await ensureWorkspacesDir();
  
  const workspacePath = getWorkspacePath(taskId);
  const branchName = `feature/${taskId}-worktree`;
  
  // Prune stale git worktree metadata from the main repo
  console.log(`[workspace] Pruning stale worktree metadata`);
  await execFile('git', ['worktree', 'prune'], { cwd: repoPath });
  
  // Check if workspace directory already exists and clean it up FIRST
  // This must happen before branch deletion because git refuses to delete a branch
  // that's currently checked out in a worktree (even with -D)
  if (existsSync(workspacePath)) {
    console.log(`[workspace] Workspace already exists for task ${taskId}: ${workspacePath}`);
    const info = await getWorkspaceInfo(taskId, repoPath);
    if (info) {
      // Refresh from origin to ensure we have latest changes
      console.log(`[workspace] Refreshing existing workspace from origin`);
      try {
        await execFile('git', ['fetch', 'origin'], { cwd: workspacePath });
        
        // Detect the actual default branch dynamically
        let mainBranch = 'main';
        try {
          const { stdout: remoteRef } = await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
            cwd: repoPath,
          }).catch(() => ({ stdout: '' }));
          
          if (remoteRef) {
            mainBranch = remoteRef.replace('refs/remotes/origin/', '').trim();
          }
        } catch {
          console.log(`[workspace] Could not determine default branch, using 'main'`);
        }
        
        await execFile('git', ['reset', '--hard', `origin/${mainBranch}`], { cwd: workspacePath });
      } catch (err) {
        console.log(`[workspace] Could not refresh workspace, using existing: ${err}`);
      }
      return info;
    }

    // Clean up incomplete workspace: remove worktree first, then directory
    console.log(`[workspace] Cleaning up incomplete workspace for ${taskId}`);
    try {
      await execFile('git', ['worktree', 'remove', '--force', workspacePath], { cwd: repoPath });
    } catch {
      // Ignore - may not be a valid worktree
      console.log(`[workspace] Could not remove worktree, proceeding with directory cleanup`);
    }
    await fs.rm(workspacePath, { recursive: true, force: true });
  }

  // Now safe to delete orphaned branch (worktree is already removed)
  const { stdout: branchList } = await execFile('git', ['branch', '--list', branchName], { cwd: repoPath });
  if (branchList.trim()) {
    console.log(`[workspace] Deleting orphaned branch ${branchName}`);
    try {
      await execFile('git', ['branch', '-D', branchName], { cwd: repoPath });
    } catch {
      // Ignore - branch may not exist or already deleted
      console.log(`[workspace] Could not delete branch ${branchName}, may not exist`);
    }
  } else {
    console.log(`[workspace] Branch ${branchName} does not exist, proceeding`);
  }

  // Verify main repo exists and has .git
  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found at: ${repoPath}`);
  }
  
  if (!existsSync(path.join(repoPath, '.git'))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  try {
    // Get the default branch name (usually main or master) without touching the working directory
    console.log(`[workspace] Determining main branch in ${repoPath}`);
    
    // Fetch latest refs from origin (non-destructive - doesn't modify working tree)
    console.log(`[workspace] Fetching latest refs from origin`);
    await execFile('git', ['fetch', 'origin'], { cwd: repoPath, timeout: 60000 });
    
    // Get the default branch name from origin
    let mainBranch = 'main';
    try {
      const { stdout: remoteRef } = await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoPath,
      }).catch(() => ({ stdout: '' }));
      
      if (remoteRef) {
        mainBranch = remoteRef.replace('refs/remotes/origin/', '').trim();
      }
    } catch {
      // Default to main if we can't determine
      console.log(`[workspace] Could not determine default branch, using 'main'`);
    }

    // Create the worktree directly from the remote ref (no checkout/pull needed on main repo)
    console.log(`[workspace] Creating worktree at ${workspacePath} with branch ${branchName} from origin/${mainBranch}`);
    await execFile('git', ['worktree', 'add', workspacePath, '-b', branchName, `origin/${mainBranch}`], {
      cwd: repoPath,
    });

    console.log(`[workspace] Created worktree for task ${taskId} at ${workspacePath}`);

    return {
      path: workspacePath,
      branch: branchName,
      taskId,
      repoPath,
    };
  } catch (error) {
    // Clean up on failure
    if (existsSync(workspacePath)) {
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

/**
 * Clean up a workspace after the PR is opened
 * 
 * @param taskId - The task ID
 * @param keepBranch - Whether to keep the branch (default: false)
 * @param repoPath - Optional path to the main repository (needed for branch deletion after worktree removal)
 */
export async function cleanupWorkspace(
  taskId: string, 
  keepBranch: boolean = false,
  repoPath?: string
): Promise<void> {
  const workspacePath = getWorkspacePath(taskId);
  
  if (!existsSync(workspacePath)) {
    console.log(`[workspace] No workspace to clean up for task ${taskId}`);
    return;
  }

  try {
    // Get branch name before removing worktree
    let branchName: string;
    try {
      const { stdout } = await execFile('git', ['branch', '--show-current'], {
        cwd: workspacePath,
      });
      branchName = stdout.trim();
    } catch {
      branchName = `feature/${taskId}-worktree`;
    }

    // Remove the worktree (cwd must be main repo, not workspace)
    console.log(`[workspace] Removing worktree at ${workspacePath}`);
    await execFile('git', ['worktree', 'remove', workspacePath, '--force'], { cwd: repoPath });

    // Optionally delete the branch
    if (!keepBranch) {
      try {
        // Use repoPath for branch deletion since workspacePath no longer exists after worktree remove
        const branchDeleteCwd = repoPath || workspacePath;
        console.log(`[workspace] Deleting branch ${branchName} from ${branchDeleteCwd}`);
        await execFile('git', ['branch', '-d', branchName], { cwd: branchDeleteCwd }).catch(() => {
          // Try force delete if regular delete failed
          return execFile('git', ['branch', '-D', branchName], { cwd: branchDeleteCwd });
        });
      } catch (branchError) {
        console.warn(`[workspace] Could not delete branch ${branchName}:`, branchError);
      }
    }

    console.log(`[workspace] Cleaned up workspace for task ${taskId}`);
  } catch (error) {
    console.error(`[workspace] Failed to clean up workspace for ${taskId}:`, error);
    // Don't throw - cleanup failures shouldn't block the workflow
  }
}

/**
 * Ensure the main repository is clean (no uncommitted changes, on main branch)
 * @internal - Not currently used, reserved for future workspace management features
 * @param repoPath - Local path to the repository
 */
export async function ensureMainRepoClean(repoPath: string): Promise<void> {
  if (!existsSync(repoPath)) {
    console.warn(`[workspace] Repository not found at: ${repoPath}`);
    return;
  }

  try {
    // Check for uncommitted changes
    const { stdout: status } = await execFile('git', ['status', '--porcelain'], {
      cwd: repoPath,
    });

    if (status.trim()) {
      console.log(`[workspace] Stashing uncommitted changes in ${repoPath}`);
      await execFile('git', ['stash', 'push', '-m', 'Auto-stash by tix-kanban worker'], {
        cwd: repoPath,
      });
    }

    // Get the default branch
    let mainBranch = 'main';
    try {
      const { stdout: remoteRef } = await execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoPath,
      }).catch(() => ({ stdout: '' }));
      
      if (remoteRef) {
        mainBranch = remoteRef.replace('refs/remotes/origin/', '').trim();
      }
    } catch {
      // Default to main
    }

    // Check current branch
    const { stdout: currentBranch } = await execFile('git', ['branch', '--show-current'], {
      cwd: repoPath,
    });

    if (currentBranch.trim() !== mainBranch) {
      console.log(`[workspace] Checking out ${mainBranch} in ${repoPath}`);
      await execFile('git', ['checkout', mainBranch], { cwd: repoPath });
    }

    // Pull latest
    try {
      await execFile('git', ['pull', 'origin', mainBranch], { cwd: repoPath, timeout: 60000 });
    } catch {
      // May fail if no remote or up to date
    }

    console.log(`[workspace] Main repo ${repoPath} is clean`);
  } catch (error) {
    console.error(`[workspace] Failed to ensure main repo is clean:`, error);
  }
}

/**
 * Execute git commands in a workspace with proper error handling
 * @internal - Not currently used, reserved for future workspace management features
 */
export async function gitPush(
  workspacePath: string, 
  upstream: boolean = true
): Promise<void> {
  const args = upstream 
    ? ['push', '-u', 'origin', 'HEAD']
    : ['push'];
    
  await execFile('git', args, { cwd: workspacePath });
}

/**
 * Get the remote URL for a repository
 * @internal - Not currently used, reserved for future workspace management features
 */
export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], {
      cwd: repoPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Sync a reviewer's workspace by ensuring the target repo is available
 * and the correct PR branch is checked out.
 *
 * Unlike createWorkspace (which creates a fresh worktree from main),
 * this fetches the latest and checks out the specific PR branch so
 * reviewers see exactly the code under review.
 *
 * @param workspacePath - Path to the existing workspace (from createWorkspace)
 * @param branch - The PR branch name to check out
 * @returns true if sync succeeded, false otherwise
 */
export async function syncReviewerWorkspace(
  workspacePath: string,
  branch: string,
): Promise<boolean> {
  if (!existsSync(workspacePath)) {
    console.error(`[workspace] Reviewer workspace does not exist: ${workspacePath}`);
    return false;
  }

  try {
    // Fetch latest refs so the PR branch is available locally
    console.log(`[workspace] Fetching latest refs for reviewer workspace`);
    await execFile('git', ['fetch', 'origin'], {
      cwd: workspacePath,
      timeout: 60000,
    });

    // Check if the branch exists on the remote
    const { stdout: remoteBranches } = await execFile(
      'git',
      ['ls-remote', '--heads', 'origin', branch],
      { cwd: workspacePath, timeout: 15000 }
    );

    if (!remoteBranches.trim()) {
      console.error(`[workspace] Branch '${branch}' does not exist on remote`);
      return false;
    }

    // Checkout the PR branch
    console.log(`[workspace] Checking out PR branch: ${branch}`);
    try {
      await execFile('git', ['checkout', branch], { cwd: workspacePath });
    } catch {
      // Branch may not exist locally yet — create tracking branch
      await execFile('git', ['checkout', '-b', branch, `origin/${branch}`], {
        cwd: workspacePath,
      });
    }

    // Pull latest changes on the branch
    await execFile('git', ['pull', 'origin', branch], {
      cwd: workspacePath,
      timeout: 60000,
    });

    console.log(`[workspace] Reviewer workspace synced to branch '${branch}' at ${workspacePath}`);
    return true;
  } catch (error) {
    console.error(`[workspace] Failed to sync reviewer workspace: ${error}`);
    return false;
  }
}

/**
 * Initialize a new repository as a worktree-friendly repo
 * (Creates the .forge/workspaces directory structure)
 */
export async function initializeForgeWorkspaces(): Promise<void> {
  await ensureWorkspacesDir();
  console.log(`[workspace] Forge workspaces initialized at ${FORGE_WORKSPACES_DIR}`);
}