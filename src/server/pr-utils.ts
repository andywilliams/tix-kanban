/**
 * Shared PR utilities — used by both auto-review.ts and worker.ts.
 * Extracted here to avoid circular imports and keep both files in sync.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Task } from '../client/types/index.js';

const execFileAsync = promisify(execFile);

export interface ParsedPRLink {
  repo: string;
  number: number;
  /** Unique key in the form `owner/repo#123` */
  key: string;
  url?: string;
}

/**
 * Parse task links and return unique PR references from github.com pull URLs.
 * Deduplicates by repo+number so the same PR linked twice isn't processed twice.
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
    if (!parsed.has(key)) {
      parsed.set(key, { repo, number, key, url: link.url });
    }
  }
  return [...parsed.values()];
}

/**
 * Fetch the current state of a GitHub PR via the `gh` CLI.
 * Returns 'open' | 'merged' | 'closed' | null (on error or unknown state).
 */
export async function getPRStateShared(repo: string, number: number): Promise<'open' | 'merged' | 'closed' | null> {
  try {
    const { stdout } = await execFileAsync(
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
