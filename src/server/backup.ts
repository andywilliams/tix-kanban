import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getUserSettings, saveUserSettings, BackupSchedule, BackupCategories, getBackupCategoriesWithDefaults, resolveBackupDir } from './user-settings.js';

const execAsync = promisify(execCallback);

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const DEFAULT_BACKUP_DIR = path.join(os.homedir(), '.tix-kanban-backups');
const BACKUP_STATE_FILE = path.join(DEFAULT_STORAGE_DIR, 'backup-state.json');

export async function getBackupStorageDir(): Promise<string> {
  const settings = await getUserSettings();
  if (!settings.backupDir) return DEFAULT_BACKUP_DIR;

  const resolved = resolveBackupDir(settings.backupDir);
  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (err) {
    throw new Error(`Backup directory "${resolved}" could not be created: ${(err as Error).message}`);
  }
  const testFile = path.join(resolved, '.tix-write-test');
  try {
    await fs.writeFile(testFile, '');
    await fs.unlink(testFile);
  } catch {
    throw new Error(`Backup directory "${resolved}" is not writable.`);
  }
  return resolved;
}

const STORAGE_DIR = DEFAULT_STORAGE_DIR;

interface BackupState {
  lastBackupTime?: string;
  lastBackupResult?: 'success' | 'failure' | 'skipped';
  lastBackupError?: string;
}

/**
 * Check if git is installed on the system
 */
async function isGitInstalled(): Promise<boolean> {
  try {
    await execAsync('git --version');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Check if the storage directory is already a git repository
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    // Use --git-dir and compare to expected .git dir to avoid matching parent repos
    const { stdout } = await execAsync('git rev-parse --git-dir', { cwd: dir });
    const gitDir = path.resolve(dir, stdout.trim());
    const expectedGitDir = path.join(dir, '.git');
    return gitDir === expectedGitDir;
  } catch (error) {
    return false;
  }
}

/**
 * Initialize a git repository in the storage directory if not already initialized
 */
async function initGitRepo(dir: string): Promise<boolean> {
  try {
    await execAsync('git init', { cwd: dir });
    console.log('[backup] Git repository initialized');
    return true;
  } catch (error: any) {
    console.warn('[backup] Failed to initialize git repository:', error.message);
    return false;
  }
}

/**
 * Get the interval in milliseconds based on the backup schedule config
 */
export function getBackupIntervalMs(schedule: BackupSchedule): number {
  switch (schedule.frequency) {
    case 'hourly':
      return 60 * 60 * 1000; // 1 hour
    case 'daily':
      return 24 * 60 * 60 * 1000; // 24 hours
    case 'custom':
      return (schedule.customMinutes || 60) * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000; // Default to daily
  }
}

/**
 * Check if a backup is needed based on the schedule
 */
export function isBackupNeeded(schedule: BackupSchedule): boolean {
  if (!schedule.enabled) {
    return false;
  }

  if (!schedule.lastRun) {
    return true; // Never run, need to run
  }

  const lastRun = new Date(schedule.lastRun);
  const now = new Date();
  const intervalMs = getBackupIntervalMs(schedule);
  
  return (now.getTime() - lastRun.getTime()) >= intervalMs;
}

/**
 * Check if there are any changes since the last backup by looking at file modification times
 */
export async function hasChangesSinceLastBackup(): Promise<boolean> {
  try {
    const storageDir = await getBackupStorageDir();
    const state = await readBackupState(storageDir);
    
    if (!state.lastBackupTime) {
      return true; // Never backed up, need to backup
    }

    const lastBackupTime = new Date(state.lastBackupTime).getTime();
    
    // Check if any DATA files in the storage directory have been modified since last backup
    // Exclude metadata files updated on every backup run
    const EXCLUDED = new Set([
      path.join(storageDir, 'backup-state.json'),
      path.join(storageDir, 'user-settings.json'),
    ]);
    const files = await getAllStorageFiles(storageDir);

    for (const file of files) {
      if (EXCLUDED.has(file)) continue;
      const stats = await fs.stat(file);
      if (stats.mtimeMs > lastBackupTime) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.warn('[backup] Error checking for changes:', error);
    return true; // If error, assume there are changes to be safe
  }
}

/**
 * Get all files in the storage directory recursively
 */
async function getAllStorageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip git directory and other system files
      if (entry.name === '.git' || entry.name.startsWith('.')) {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subFiles = await getAllStorageFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors for missing directories
  }
  
  return files;
}

/**
 * Read backup state from file
 */
async function readBackupState(storageDir: string): Promise<BackupState> {
  const statePath = path.join(storageDir, BACKUP_STATE_FILE);
  try {
    const content = await fs.readFile(statePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

/**
 * Write backup state to file
 */
async function writeBackupState(storageDir: string, state: BackupState): Promise<void> {
  const statePath = path.join(storageDir, BACKUP_STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Run the backup - optionally commit all changes to git
 */
export async function runBackup(): Promise<{ success: boolean; message: string; skipped?: boolean }> {
  const timestamp = new Date().toISOString();
  let gitErrorMessage: string | undefined;
  
  try {
    // Get settings to check if git auto-commit is enabled
    const settings = await getUserSettings();
    const gitAutoCommit = settings.backup?.gitAutoCommit ?? false;
    
    // Check if there are changes to backup
    const changesExist = await hasChangesSinceLastBackup();
    
    if (!changesExist) {
      console.log(`[backup] No changes since last backup, skipping`);
      
      const state: BackupState = {
        lastBackupTime: timestamp,
        lastBackupResult: 'skipped',
        lastBackupError: undefined
      };
      await writeBackupState(STORAGE_DIR, state);
      
      // Update user settings
      if (settings.backup) {
        settings.backup.lastRun = timestamp;
        settings.backup.lastStatus = 'skipped';
        settings.backup.lastError = undefined;
        await saveUserSettings(settings);
      }
      
      return { success: true, message: 'No changes since last backup', skipped: true };
    }

    // Resolve the effective backup directory (may be custom)
    const effectiveStorageDir = await getBackupStorageDir();

    // Get list of changed files
    const files = await getAllStorageFiles(effectiveStorageDir);
    
    if (files.length === 0) {
      console.log(`[backup] No files to backup`);
      return { success: true, message: 'No files to backup', skipped: true };
    }

    // Handle git auto-commit if enabled
    if (gitAutoCommit) {
      // Check if git is installed
      const gitInstalled = await isGitInstalled();
      
      if (!gitInstalled) {
        console.warn('[backup] Git is not installed, skipping git auto-commit');
        gitErrorMessage = 'Git is not installed';
      } else {
        // Check if git repo exists, if not initialize it
        const repoExists = await isGitRepo(effectiveStorageDir);
        
        if (!repoExists) {
          console.log('[backup] Initializing git repository for backups...');
          const initSuccess = await initGitRepo(effectiveStorageDir);
          if (!initSuccess) {
            gitErrorMessage = 'Failed to initialize git repository';
          }
        }
        
        // If git repo is ready, perform commit
        if (!gitErrorMessage) {
          try {
            // Stage all files
            await execAsync(`git add -A`, { cwd: effectiveStorageDir });
            
            // Check if there are staged changes
            const { stdout: statusOutput } = await execAsync(`git status --porcelain`, { cwd: effectiveStorageDir });
            
            if (!statusOutput.trim()) {
              console.log(`[backup] No changes to commit`);
            } else {
              // Commit the changes
              const commitMessage = `backup: ${new Date().toISOString()}`;
              await execAsync(`git commit -m "${commitMessage}"`, { cwd: effectiveStorageDir });
              console.log(`[backup] Git commit created: ${commitMessage}`);
            }
          } catch (gitError: any) {
            gitErrorMessage = gitError.message || String(gitError);
            console.warn('[backup] Git commit failed:', gitErrorMessage);
          }
        }
      }
    } else {
      console.log('[backup] Git auto-commit is disabled');
    }
    
    console.log(`[backup] Backup completed successfully at ${timestamp}`);
    
    // Update state
    const state: BackupState = {
      lastBackupTime: timestamp,
      lastBackupResult: gitErrorMessage ? 'failure' : 'success',
      lastBackupError: gitErrorMessage
    };
    await writeBackupState(STORAGE_DIR, state);
    
    // Update user settings
    if (settings.backup) {
      settings.backup.lastRun = timestamp;
      settings.backup.lastStatus = gitErrorMessage ? 'failure' : 'success';
      settings.backup.lastError = gitErrorMessage;
      await saveUserSettings(settings);
    }
    
    if (gitErrorMessage) {
      return { success: true, message: `Backup completed but git auto-commit failed: ${gitErrorMessage}` };
    }
    
    return { success: true, message: 'Backup completed successfully' };
    
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    console.error(`[backup] Backup failed:`, errorMessage);
    
    // Update state with error
    const state: BackupState = {
      lastBackupTime: timestamp,
      lastBackupResult: 'failure',
      lastBackupError: errorMessage
    };
    await writeBackupState(STORAGE_DIR, state).catch(() => {});
    
    // Update user settings
    const settings = await getUserSettings();
    if (settings.backup) {
      settings.backup.lastRun = timestamp;
      settings.backup.lastStatus = 'failure';
      settings.backup.lastError = errorMessage;
      await saveUserSettings(settings).catch(() => {});
    }
    
    return { success: false, message: `Backup failed: ${errorMessage}` };
  }
}

/**
 * Get current backup status
 */
export async function getBackupStatus(): Promise<{
  configured: boolean;
  enabled: boolean;
  frequency?: string;
  gitAutoCommit?: boolean;
  lastRun?: string;
  lastStatus?: string;
  lastError?: string;
}> {
  const settings = await getUserSettings();
  
  if (!settings.backup) {
    return { configured: false, enabled: false };
  }
  
  return {
    configured: true,
    enabled: settings.backup.enabled,
    frequency: settings.backup.frequency,
    gitAutoCommit: settings.backup.gitAutoCommit,
    lastRun: settings.backup.lastRun,
    lastStatus: settings.backup.lastStatus,
    lastError: settings.backup.lastError
  };
}

/**
 * Update backup schedule configuration
 */
export async function updateBackupSchedule(updates: Partial<BackupSchedule>): Promise<BackupSchedule> {
  const settings = await getUserSettings();
  
  if (!settings.backup) {
    settings.backup = {
      enabled: false,
      frequency: 'daily',
      customMinutes: 60,
      gitAutoCommit: false
    };
  }
  
  settings.backup = { ...settings.backup, ...updates };
  await saveUserSettings(settings);
  
  return settings.backup;
}

/**
 * Get current backup category settings
 */
export async function getBackupCategories(): Promise<BackupCategories> {
  const settings = await getUserSettings();
  return getBackupCategoriesWithDefaults(settings.backupCategories);
}

/**
 * Update backup category settings
 */
export async function updateBackupCategories(categories: Partial<BackupCategories>): Promise<BackupCategories> {
  const settings = await getUserSettings();
  
  if (!settings.backupCategories) {
    settings.backupCategories = {};
  }
  
  settings.backupCategories = { ...settings.backupCategories, ...categories };
  await saveUserSettings(settings);
  
  return getBackupCategoriesWithDefaults(settings.backupCategories);
}

/**
 * Start the backup scheduler
 */
let backupIntervalId: NodeJS.Timeout | null = null;

export async function startBackupScheduler(): Promise<void> {
  const settings = await getUserSettings();
  
  if (!settings.backup || !settings.backup.enabled) {
    console.log('[backup] Backup scheduler not enabled');
    return;
  }
  
  const intervalMs = getBackupIntervalMs(settings.backup);
  console.log(`[backup] Starting backup scheduler with ${settings.backup.frequency} frequency (${intervalMs / 1000 / 60} minutes)`);
  
  // Run initial backup check on startup if needed
  if (isBackupNeeded(settings.backup)) {
    console.log('[backup] Running overdue backup on startup...');
    await runBackup();
  }
  
  // Schedule periodic backups
  backupIntervalId = setInterval(async () => {
    const currentSettings = await getUserSettings();
    
    if (currentSettings.backup?.enabled && isBackupNeeded(currentSettings.backup)) {
      console.log('[backup] Running scheduled backup...');
      await runBackup();
    }
  }, intervalMs);
}

/**
 * Stop the backup scheduler
 */
export function stopBackupScheduler(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log('[backup] Backup scheduler stopped');
  }
}

// ============ File-based Backup with Password Encryption ============

export interface BackupMetadata {
  version: string;
  createdAt: string;
  categories?: BackupCategories;
  encrypted: boolean;
  algorithm?: string;
  salt?: string;
  iv?: string;
  authTag?: string;
}

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive an encryption key from a password using scrypt
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: 2 ** 14,
    r: 8,
    p: 1,
  });
}

/**
 * Encrypt data with AES-256-GCM
 */
function encryptData(data: Buffer, password: string): { encrypted: Buffer; salt: Buffer; iv: Buffer; authTag: Buffer } {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, salt, iv, authTag };
}

/**
 * Decrypt data with AES-256-GCM
 */
function decryptData(encrypted: Buffer, password: string, salt: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Create a tar archive of the storage directory
 */
async function createTarArchive(storageDir: string): Promise<Buffer> {
  const { spawn } = await import('child_process');
  
  const allFiles = await getAllStorageFiles(storageDir);
  
  if (allFiles.length === 0) {
    throw new Error('No files to backup');
  }

  return new Promise((resolve, reject) => {
    const tarArgs = ['-cf', '-', '-C', storageDir];
    const relativeFiles = allFiles.map(f => path.relative(storageDir, f));
    tarArgs.push(...relativeFiles);
    
    const tarProc = spawn('tar', tarArgs);
    const chunks: Buffer[] = [];

    tarProc.stdout.on('data', (chunk) => chunks.push(chunk));
    tarProc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`tar exited with code ${code}`));
      }
    });
    tarProc.on('error', reject);
  });
}

/**
 * Extract a tar archive to a directory
 */
async function extractTarArchive(tarBuffer: Buffer, targetDir: string): Promise<void> {
  const { spawn } = await import('child_process');
  
  await fs.mkdir(targetDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const tarProc = spawn('tar', ['-xf', '-', '-C', targetDir]);
    
    tarProc.stdin.write(tarBuffer);
    tarProc.stdin.end();
    
    tarProc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with code ${code}`));
      }
    });
    tarProc.on('error', reject);
  });
}

/**
 * Create a file-based backup (optionally encrypted)
 */
export async function createFileBackup(options: {
  outputDir: string;
  password?: string;
  categories?: BackupCategories;
}): Promise<{ backupPath: string; metadataPath: string; encrypted: boolean }> {
  // Source = where the data lives (always DEFAULT_STORAGE_DIR / ~/.tix-kanban)
  // Output = where the backup file goes (configured backup dir)
  const sourceDir = DEFAULT_STORAGE_DIR;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `backup-${timestamp}`;
  
  const tarBuffer = await createTarArchive(sourceDir);
  
  let finalBuffer: Buffer;
  let metadata: BackupMetadata;
  
  if (options.password) {
    const { encrypted, salt, iv, authTag } = encryptData(tarBuffer, options.password);
    finalBuffer = encrypted;
    
    metadata = {
      version: '1.0',
      createdAt: timestamp,
      categories: options.categories,
      encrypted: true,
      algorithm: ENCRYPTION_ALGORITHM,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  } else {
    finalBuffer = tarBuffer;
    
    metadata = {
      version: '1.0',
      createdAt: timestamp,
      categories: options.categories,
      encrypted: false,
    };
  }
  
  const ext = options.password ? '.tar.enc' : '.tar';
  const backupPath = path.join(options.outputDir, `${baseName}${ext}`);
  const metadataPath = path.join(options.outputDir, `${baseName}-metadata.json`);
  
  await fs.writeFile(backupPath, finalBuffer);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  console.log(`[backup] File backup created: ${backupPath} (encrypted: ${!!options.password})`);
  
  return { backupPath, metadataPath, encrypted: !!options.password };
}

/**
 * Find the latest backup file in a directory
 */
async function findLatestBackup(backupDir: string): Promise<{ backupPath: string; metadataPath: string } | null> {
  const files = await fs.readdir(backupDir);
  
  const backupFiles = files.filter(f => f.startsWith('backup-') && (f.endsWith('.tar') || f.endsWith('.tar.enc')));
  
  if (backupFiles.length === 0) {
    return null;
  }
  
  backupFiles.sort().reverse();
  const latestBackup = backupFiles[0];
  
  const baseName = latestBackup.replace(/\.tar(\.enc)?$/, '');
  const metadataPath = path.join(backupDir, `${baseName}-metadata.json`);
  
  return {
    backupPath: path.join(backupDir, latestBackup),
    metadataPath,
  };
}

/**
 * Restore a file-based backup (with optional password decryption)
 */
export async function restoreFileBackup(options: {
  backupDir: string;
  password?: string;
  targetDir?: string;
}): Promise<{ success: boolean; message: string; wasEncrypted: boolean }> {
  const latest = await findLatestBackup(options.backupDir);
  
  if (!latest) {
    return { success: false, message: 'No backup found in directory', wasEncrypted: false };
  }
  
  let metadata: BackupMetadata;
  try {
    const metadataContent = await fs.readFile(latest.metadataPath, 'utf8');
    metadata = JSON.parse(metadataContent);
  } catch (error) {
    return { success: false, message: 'Failed to read backup metadata', wasEncrypted: false };
  }
  
  const backupBuffer = await fs.readFile(latest.backupPath);
  
  let tarBuffer: Buffer;
  
  if (metadata.encrypted) {
    if (!options.password) {
      return { success: false, message: 'Backup is encrypted. Please provide a password.', wasEncrypted: true };
    }
    
    try {
      const salt = Buffer.from(metadata.salt!, 'hex');
      const iv = Buffer.from(metadata.iv!, 'hex');
      const authTag = Buffer.from(metadata.authTag!, 'hex');
      
      tarBuffer = decryptData(backupBuffer, options.password, salt, iv, authTag);
    } catch (error) {
      return { success: false, message: 'Incorrect password or corrupted backup', wasEncrypted: true };
    }
  } else {
    tarBuffer = backupBuffer;
  }
  
  const targetDir = options.targetDir || await getBackupStorageDir();
  
  await extractTarArchive(tarBuffer, targetDir);
  
  console.log(`[backup] Backup restored to: ${targetDir}`);
  
  return { success: true, message: `Backup restored successfully to ${targetDir}`, wasEncrypted: metadata.encrypted };
}

/**
 * List available backups in a directory
 */
export async function listBackups(backupDir: string): Promise<Array<{
  filename: string;
  createdAt: string;
  encrypted: boolean;
  categories?: BackupCategories;
}>> {
  const files = await fs.readdir(backupDir);
  
  const metadataFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('-metadata.json'));
  
  const backups = [];
  for (const metadataFile of metadataFiles) {
    try {
      const content = await fs.readFile(path.join(backupDir, metadataFile), 'utf8');
      const metadata: BackupMetadata = JSON.parse(content);
      
      backups.push({
        filename: metadataFile.replace('-metadata.json', ''),
        createdAt: metadata.createdAt,
        encrypted: metadata.encrypted,
        categories: metadata.categories,
      });
    } catch (error) {
      // Skip invalid metadata files
    }
  }
  
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  return backups;
}
