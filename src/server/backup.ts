import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getUserSettings, saveUserSettings, BackupSchedule, BackupCategories, getBackupCategoriesWithDefaults, expandBackupPath, validateBackupPath } from './user-settings.js';

const execAsync = promisify(execCallback);

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const BACKUP_STATE_FILE = path.join(STORAGE_DIR, 'backup-state.json');

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
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir });
    return true;
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
    const state = await readBackupState();
    
    if (!state.lastBackupTime) {
      return true; // Never backed up, need to backup
    }

    const lastBackupTime = new Date(state.lastBackupTime).getTime();
    
    // Check if any files in the storage directory have been modified since last backup
    const files = await getAllStorageFiles(STORAGE_DIR);
    
    for (const file of files) {
      const stats = await fs.stat(file);
      const mtime = stats.mtimeMs;
      
      if (mtime > lastBackupTime) {
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
async function readBackupState(): Promise<BackupState> {
  try {
    const content = await fs.readFile(BACKUP_STATE_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

/**
 * Write backup state to file
 */
async function writeBackupState(state: BackupState): Promise<void> {
  await fs.writeFile(BACKUP_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Run the backup - optionally commit all changes to git
 */
export async function runBackup(): Promise<{ success: boolean; message: string; skipped?: boolean }> {
  const timestamp = new Date().toISOString();
  let gitErrorMessage: string | undefined;
  
  try {
    // Get settings
    const settings = await getUserSettings();
    const gitAutoCommit = settings.backup?.gitAutoCommit ?? false;
    const backupDir = settings.backup?.backupDir;
    
    // Validate backup directory if specified
    if (backupDir && backupDir.trim()) {
      const validation = await validateBackupPath(backupDir);
      if (!validation.valid) {
        return { success: false, message: `Invalid backup directory: ${validation.error}` };
      }
      
      // Initialize the backup directory structure (create subdirectories)
      const storageDir = expandBackupPath(backupDir);
      const dataDir = path.join(storageDir, '.tix-kanban');
      const workDir = path.join(storageDir, 'tix-kanban');
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });
      console.log(`[backup] Backup directory structure initialized at: ${storageDir}`);
    }
    
    // Get the storage directory to use
    const storageDir = await getStorageDir();
    console.log(`[backup] Using storage directory: ${storageDir}`);
    
    // Check if there are changes to backup
    const changesExist = await hasChangesSinceLastBackup();
    
    if (!changesExist) {
      console.log(`[backup] No changes since last backup, skipping`);
      
      const state: BackupState = {
        lastBackupTime: timestamp,
        lastBackupResult: 'skipped',
        lastBackupError: undefined
      };
      await writeBackupState(storageDir, state);
      
      // Update user settings
      if (settings.backup) {
        settings.backup.lastRun = timestamp;
        settings.backup.lastStatus = 'skipped';
        settings.backup.lastError = undefined;
        await saveUserSettings(settings);
      }
      
      return { success: true, message: 'No changes since last backup', skipped: true };
    }

    // Get list of changed files
    const files = await getAllStorageFiles(storageDir);
    
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
        const repoExists = await isGitRepo(storageDir);
        
        if (!repoExists) {
          console.log('[backup] Initializing git repository for backups...');
          const initSuccess = await initGitRepo(storageDir);
          if (!initSuccess) {
            gitErrorMessage = 'Failed to initialize git repository';
          }
        }
        
        // If git repo is ready, perform commit
        if (!gitErrorMessage) {
          try {
            // Stage all files
            await execAsync(`git add -A`, { cwd: storageDir });
            
            // Check if there are staged changes
            const { stdout: statusOutput } = await execAsync(`git status --porcelain`, { cwd: storageDir });
            
            if (!statusOutput.trim()) {
              console.log(`[backup] No changes to commit`);
            } else {
              // Commit the changes
              const commitMessage = `backup: ${new Date().toISOString()}`;
              await execAsync(`git commit -m "${commitMessage}"`, { cwd: storageDir });
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
<<<<<<< Updated upstream
    await writeBackupState(state);
=======
    await writeBackupState(storageDir, state);
>>>>>>> Stashed changes
    
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
    
    // Try to get storage dir for state update
    let currentStorageDir = STORAGE_DIR;
    try {
      currentStorageDir = await getStorageDir();
    } catch {}
    
    // Update state with error
    const state: BackupState = {
      lastBackupTime: timestamp,
      lastBackupResult: 'failure',
      lastBackupError: errorMessage
    };
<<<<<<< Updated upstream
    await writeBackupState(state).catch(() => {});
=======
    await writeBackupState(currentStorageDir, state).catch(() => {});
>>>>>>> Stashed changes
    
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
const PBKDF2_ITERATIONS = 100000;

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
 * Create a tar archive of the storage directory for selected categories
 */
async function createTarArchive(storageDir: string, categories?: BackupCategories): Promise<Buffer> {
  const { spawn } = await import('child_process');
  
  // Get files to include based on categories
  const allFiles = await getAllStorageFiles(storageDir);
  
  if (allFiles.length === 0) {
    throw new Error('No files to backup');
  }

  return new Promise((resolve, reject) => {
    const tarArgs = ['-cf', '-', '-C', storageDir];
    
    // Add all files relative to storage dir
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
  
  // Ensure target directory exists
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
 * Returns the path to the backup file and metadata
 */
export async function createFileBackup(options: {
  outputDir: string;
  password?: string;
  categories?: BackupCategories;
}): Promise<{ backupPath: string; metadataPath: string; encrypted: boolean }> {
  const storageDir = await getStorageDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `backup-${timestamp}`;
  
  // Create tar archive
  const tarBuffer = await createTarArchive(storageDir, options.categories);
  
  let finalBuffer: Buffer;
  let metadata: BackupMetadata;
  
  if (options.password) {
    // Encrypt the tar archive
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
    // No encryption - use plain tar
    finalBuffer = tarBuffer;
    
    metadata = {
      version: '1.0',
      createdAt: timestamp,
      categories: options.categories,
      encrypted: false,
    };
  }
  
  // Determine file extensions
  const ext = options.password ? '.tar.enc' : '.tar';
  const backupPath = path.join(options.outputDir, `${baseName}${ext}`);
  const metadataPath = path.join(options.outputDir, `${baseName}-metadata.json`);
  
  // Write files
  await fs.writeFile(backupPath, finalBuffer);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  console.log(`[backup] File backup created: ${backupPath} (encrypted: ${!!options.password})`);
  
  return { backupPath, metadataPath, encrypted: !!options.password };
}

/**
 * Check if a backup file is encrypted by reading its metadata
 */
export async function getBackupMetadata(backupDir: string): Promise<BackupMetadata | null> {
  const files = await fs.readdir(backupDir);
  
  // Find metadata file (most recent)
  const metadataFiles = files.filter(f => f.endsWith('-metadata.json'));
  if (metadataFiles.length === 0) {
    return null;
  }
  
  // Sort by name (which includes timestamp) to get most recent
  metadataFiles.sort().reverse();
  const latestMetadataFile = metadataFiles[0];
  
  const content = await fs.readFile(path.join(backupDir, latestMetadataFile), 'utf8');
  return JSON.parse(content);
}

/**
 * Find the latest backup file in a directory
 */
async function findLatestBackup(backupDir: string): Promise<{ backupPath: string; metadataPath: string } | null> {
  const files = await fs.readdir(backupDir);
  
  // Find backup files and their metadata
  const backupFiles = files.filter(f => f.startsWith('backup-') && (f.endsWith('.tar') || f.endsWith('.tar.enc')));
  
  if (backupFiles.length === 0) {
    return null;
  }
  
  // Sort by name to get most recent (timestamp in name)
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
  // Find the latest backup
  const latest = await findLatestBackup(options.backupDir);
  
  if (!latest) {
    return { success: false, message: 'No backup found in directory', wasEncrypted: false };
  }
  
  // Read metadata
  let metadata: BackupMetadata;
  try {
    const metadataContent = await fs.readFile(latest.metadataPath, 'utf8');
    metadata = JSON.parse(metadataContent);
  } catch (error) {
    return { success: false, message: 'Failed to read backup metadata', wasEncrypted: false };
  }
  
  // Read the backup file
  const backupBuffer = await fs.readFile(latest.backupPath);
  
  let tarBuffer: Buffer;
  
  if (metadata.encrypted) {
    // Decrypt the backup
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
    // No encryption - use as-is
    tarBuffer = backupBuffer;
  }
  
  // Determine target directory
  const targetDir = options.targetDir || await getStorageDir();
  
  // Extract tar archive
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
        filename: metadataFile.replace('-metadata.json', '.tar.enc'),
        createdAt: metadata.createdAt,
        encrypted: metadata.encrypted,
        categories: metadata.categories,
      });
    } catch (error) {
      // Skip invalid metadata files
    }
  }
  
  // Sort by creation date (newest first)
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  
  return backups;
}
