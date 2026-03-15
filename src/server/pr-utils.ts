import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { Task } from '../client/types/index.js';

const execFile = promisify(execFileCallback);

export interface ParsedPRLink {
  repo: string;
  number: number;
  key: string;
  url?: string;
}

/**
 * Parse GitHub PR links from task links, deduplicating by repo+number.
 */
export function parsePRLinks(links: Task['links']): ParsedPRLink[] {
  const parsed = new Map<string, ParsedPRLink>();
  for (const link of links || []) {
    if (link.type !== 'pr' && !link.url?.includes('/pull/')) {
      continue;
    }
    const match = link.url?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) {
      continue;
    }
    const repo = match[1];
    const number = parseInt(match[2], 10);
    if (!Number.isFinite(number)) {
      continue;
    }
    const key = `${repo}#${number}`;
    parsed.set(key, { repo, number, key, url: link.url });
  }
  return [...parsed.values()];
}

/**
 * Fetch the current state of a GitHub PR.
 */
export async function getPRState(repo: string, number: number): Promise<'open' | 'closed' | 'merged' | null> {
  try {
    const { stdout } = await execFile(
      'gh',
      ['pr', 'view', String(number), '--repo', repo, '--json', 'state', '--jq', '.state'],
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    const state = stdout.trim().toUpperCase();
    if (state === 'OPEN') return 'open';
    if (state === 'MERGED') return 'merged';
    if (state === 'CLOSED') return 'closed';
  } catch (error) {
    console.warn(`Failed to fetch PR state for ${repo}#${number}:`, error);
  }
  return null;
}
