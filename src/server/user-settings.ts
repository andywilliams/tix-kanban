import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SETTINGS_FILE = path.join(os.homedir(), '.tix-kanban', 'user-settings.json');

export interface UserSettings {
  userName: string;
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
