import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const SLX_CONFIG_PATH = path.join(os.homedir(), '.slx', 'config.json');
const SLACK_DATA_DIR = path.join(os.homedir(), '.tix-kanban', 'slack');

export interface SlxConfig {
  user: { name: string; slackId?: string };
  channels: Array<{ name: string; priority: 'high' | 'normal' | 'low' }>;
  sync: {
    dmsEnabled: boolean;
    mentionsOnly: boolean;
    maxMessages: number;
    lookbackHours: number;
    autoSyncEnabled?: boolean;
    autoSyncIntervalHours?: number;
  };
  output: { dir: string; format: 'daily' | 'channel' };
  claude?: { model?: string; maxTurns?: number };
}

export async function getSlxConfig(): Promise<SlxConfig | null> {
  try {
    const data = await fs.readFile(SLX_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveSlxConfig(config: SlxConfig): Promise<void> {
  await fs.mkdir(path.dirname(SLX_CONFIG_PATH), { recursive: true });
  await fs.writeFile(SLX_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function runSlxSync(hours?: number): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = ['sync'];
    if (hours) args.push('--hours', String(hours));
    
    const proc = spawn('slx', args, {
      env: { ...process.env },
      stdio: 'pipe'
    });
    
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr || `slx exited with code ${code}` });
      }
    });
    
    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

export async function runSlxDigest(focus?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['digest'];
    if (focus) args.push('--focus', focus);
    
    const proc = spawn('slx', args, {
      env: { ...process.env },
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `slx digest failed with code ${code}`));
    });
    
    proc.on('error', reject);
  });
}

export async function getSlackData(): Promise<any> {
  try {
    await fs.access(SLACK_DATA_DIR);
  } catch {
    // Directory doesn't exist, return empty data
    return {
      mentions: [],
      channels: [],
      dms: [],
      summary: '',
      digest: ''
    };
  }
  
  try {
    const files = await fs.readdir(SLACK_DATA_DIR);
    const data: any = {
      mentions: [],
      channels: [],
      dms: [],
      summary: '',
      digest: ''
    };
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(SLACK_DATA_DIR, file), 'utf8');
      
      if (file === 'mentions.md') {
        data.mentions = parseMarkdownMessages(content);
      } else if (file === 'summary.md') {
        data.summary = content;
      } else if (file === 'digest.md') {
        data.digest = content;
      } else if (file.startsWith('channel-')) {
        data.channels.push({ name: file.replace('channel-', '').replace('.md', ''), content });
      } else if (file.startsWith('dm-')) {
        data.dms.push({ name: file.replace('dm-', '').replace('.md', ''), content });
      }
    }
    
    return data;
  } catch {
    return {
      mentions: [],
      channels: [],
      dms: [],
      summary: '',
      digest: ''
    };
  }
}

function parseMarkdownMessages(md: string): any[] {
  // Simple parser — extract messages from markdown
  const messages: any[] = [];
  const lines = md.split('\n');
  let current: any = null;
  
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) messages.push(current);
      current = { channel: line.replace('## ', ''), text: '' };
    } else if (line.startsWith('**') && current) {
      const match = line.match(/\*\*(.+?)\*\* \((.+?)\)/);
      if (match) {
        current.author = match[1];
        current.timestamp = match[2];
      }
    } else if (current && line.trim()) {
      current.text += line + '\n';
    }
  }
  
  if (current) messages.push(current);
  return messages;
}

export async function getSlxStatus(): Promise<any> {
  try {
    const metaPath = path.join(SLACK_DATA_DIR, '.sync-meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    return meta;
  } catch {
    return null;
  }
}