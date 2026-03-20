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
 * Sanitize a repo name to contain only safe characters.
 * Extracted as a shared helper to avoid regex duplication (Bugbot LOW).
 * Only allows alphanumeric, hyphens, underscores, dots, and forward slash.
 */
export function sanitizeRepoName(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9\-_./]/g, '');
}

/**
 * Parse GitHub PR links from task links, deduplicating by repo+number.
 * Validates repo names to prevent injection attacks.
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
    // Sanitize repo to prevent tool-permission injection (Bugbot HIGH)
    const rawRepo = match[1];
    const repo = sanitizeRepoName(rawRepo);
    // Reject if sanitization changed the repo (indicates invalid chars)
    if (repo !== rawRepo) {
      console.warn(`Blocked potentially malicious PR link: ${link.url} — repo contained invalid characters`);
      continue;
    }
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

/**
 * Fetch the mergeable state of a GitHub PR.
 */
export async function getPRMergeableState(repo: string, number: number): Promise<'MERGEABLE' | 'CONFLICTING' | null> {
  try {
    const { stdout } = await execFile(
      'gh',
      ['pr', 'view', String(number), '--repo', repo, '--json', 'mergeable', '--jq', '.mergeable'],
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    const result = stdout.trim();
    if (result === 'true') return 'MERGEABLE';
    if (result === 'false') return 'CONFLICTING';
  } catch (error) {
    console.warn(`Failed to fetch PR mergeable state for ${repo}#${number}:`, error);
  }
  return null;
}
