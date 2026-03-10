import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SETTINGS_FILE = path.join(os.homedir(), '.tix-kanban', 'user-settings.json');

export interface BackupSchedule {
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'custom';
  customMinutes?: number; // Custom interval in minutes (only used when frequency is 'custom')
  gitAutoCommit?: boolean; // Whether to auto-commit backups to git (default: false)
  lastRun?: string; // ISO date of last backup
  lastStatus?: 'success' | 'failure' | 'skipped';
  lastError?: string; // Error message from last failed backup
  backupDir?: string; // Custom backup directory path (supports ~ for home directory)
}

export interface BackupCategories {
  tasks?: boolean;
  chat?: boolean;
  userSettings?: boolean;
  githubSettings?: boolean;
  personas?: boolean;
  agentMemories?: boolean;
  souls?: boolean;
  knowledge?: boolean;
  reports?: boolean;
  pipelines?: boolean;
  autoReviewConfig?: boolean;
  slack?: boolean;
  reviewStates?: boolean;
}

export interface UserSettings {
  userName: string;
  workspaceDir?: string;
  repoPaths?: Record<string, string>; // e.g. { "andywilliams/em-transactions-api": "/Users/me/dev/equals/em-transactions-api" }
  githubUsername?: string; // GitHub username for PR scanning
  prResolver?: {
    enabled: boolean;
    frequency: string; // Cron expression for PR checking
    lastRun?: string; // ISO date of last run
  };
  backup?: BackupSchedule;
  backupCategories?: BackupCategories;
  reminderCheckInterval?: number; // Check frequency in minutes (default: 5)
}

const DEFAULT_SETTINGS: UserSettings = {
  userName: 'User',
};

// Default backup categories - all enabled by default
export const DEFAULT_BACKUP_CATEGORIES: BackupCategories = {
  tasks: true,
  chat: true,
  userSettings: true,
  githubSettings: true,
  personas: true,
  agentMemories: true,
  souls: true,
  knowledge: true,
  reports: true,
  pipelines: true,
  autoReviewConfig: true,
  slack: true,
  reviewStates: true,
};

/**
 * Get backup categories with defaults applied (all true if not specified)
 */
export function getBackupCategoriesWithDefaults(categories?: BackupCategories): BackupCategories {
  return {
    ...DEFAULT_BACKUP_CATEGORIES,
    ...categories,
  };
}

/**
 * Expand ~ to home directory and resolve relative paths
 */
export function expandBackupPath(backupDir: string): string {
  if (backupDir.startsWith('~')) {
    return path.join(os.homedir(), backupDir.slice(1).replace(/^\//, ''));
  }
  // Resolve relative paths relative to current working directory
  return path.resolve(backupDir);
}

/**
 * Validate that a backup directory path is valid and writable
 * Returns { valid: true } if valid, or { valid: false, error: string } if invalid
 */
export async function validateBackupPath(backupDir: string): Promise<{ valid: boolean; error?: string }> {
  if (!backupDir || backupDir.trim() === '') {
    return { valid: false, error: 'Backup directory path is not set' };
  }

  const expandedPath = expandBackupPath(backupDir);
  
  try {
    // Check if path exists
    await fs.access(expandedPath, fs.constants.W_OK);
    
    // Path exists and is writable - good!
    return { valid: true };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Path doesn't exist - try to create it to see if we can
      try {
        await fs.mkdir(expandedPath, { recursive: true });
        // Created successfully, now check if it's writable
        await fs.access(expandedPath, fs.constants.W_OK);
        return { valid: true };
      } catch (createError: any) {
        return { valid: false, error: `Cannot create backup directory: ${createError.message}` };
      }
    } else if (error.code === 'EACCES') {
      return { valid: false, error: `Backup directory is not writable: ${expandedPath}` };
    }
    return { valid: false, error: `Invalid backup path: ${error.message}` };
  }
}

export async function getUserSettings(): Promise<UserSettings> {
  try {
    const content = await fs.readFile(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveUserSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

export async function saveUserSettings(settings: UserSettings): Promise<void> {
  const dir = path.dirname(SETTINGS_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}
