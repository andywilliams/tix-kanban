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
}

const DEFAULT_SETTINGS: UserSettings = {
  userName: 'User',
};

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
