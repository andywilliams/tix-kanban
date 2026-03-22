/**
 * Memory Maintenance Jobs
 * 
 * Scheduled jobs for memory decay and curation:
 * - Daily: Memory decay (archives old low/medium importance memories)
 * - Weekly: Memory curation (LLM review and promotion)
 */

import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getAllPersonas } from './persona-storage.js';
import { decayAllMemories, DecayResult } from './memory-decay.js';
import { curateAllMemories, generateWeeklyDigest, CurationResult } from './memory-curation.js';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const JOBS_DIR = path.join(STORAGE_DIR, 'memory-jobs');

// Job state
let decayJob: cron.ScheduledTask | null = null;
let curationJob: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Initialize memory maintenance jobs
 */
export async function initializeMemoryJobs(config?: {
  decayCron?: string;  // Default: '0 2 * * *' (2am daily)
  curationCron?: string;  // Default: '0 3 * * 0' (3am Sunday)
  enableDecay?: boolean;  // Default: true
  enableCuration?: boolean;  // Default: true
}): Promise<void> {
  if (isRunning) {
    console.log('[Memory Jobs] Already initialized');
    return;
  }
  
  await fs.mkdir(JOBS_DIR, { recursive: true });
  
  const decayCron = config?.decayCron || '0 2 * * *';
  const curationCron = config?.curationCron || '0 3 * * 0';
  const enableDecay = config?.enableDecay !== false;
  const enableCuration = config?.enableCuration !== false;
  
  // Daily memory decay job
  if (enableDecay) {
    decayJob = cron.schedule(decayCron, async () => {
      console.log('[Memory Jobs] Running daily decay job...');
      await runDecayJob();
    });
    console.log(`[Memory Jobs] Decay job scheduled: ${decayCron}`);
  }
  
  // Weekly memory curation job
  if (enableCuration) {
    curationJob = cron.schedule(curationCron, async () => {
      console.log('[Memory Jobs] Running weekly curation job...');
      await runCurationJob();
    });
    console.log(`[Memory Jobs] Curation job scheduled: ${curationCron}`);
  }
  
  isRunning = true;
}

/**
 * Stop all memory jobs
 */
export function stopMemoryJobs(): void {
  if (decayJob) {
    decayJob.stop();
    decayJob = null;
  }
  if (curationJob) {
    curationJob.stop();
    curationJob = null;
  }
  isRunning = false;
  console.log('[Memory Jobs] Stopped all jobs');
}

/**
 * Run decay job manually
 */
export async function runDecayJob(): Promise<DecayResult[]> {
  const startTime = Date.now();
  
  try {
    const personas = await getAllPersonas();
    const personaIds = personas.map(p => p.id);
    
    const results = await decayAllMemories(personaIds);
    
    // Log results
    const report = generateDecayReport(results);
    await saveJobReport('decay', report);
    
    const duration = Date.now() - startTime;
    console.log(`[Memory Jobs] Decay completed in ${duration}ms`);
    console.log(report);
    
    return results;
  } catch (error) {
    console.error('[Memory Jobs] Decay job failed:', error);
    throw error;
  }
}

/**
 * Run curation job manually
 */
export async function runCurationJob(): Promise<CurationResult[]> {
  const startTime = Date.now();
  
  try {
    const personas = await getAllPersonas();
    
    // Review last 7 days
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const results = await curateAllMemories(
      personas.map(p => ({ id: p.id, name: p.name })),
      { start, end }
    );
    
    // Generate digest
    const digest = generateWeeklyDigest(results);
    await saveJobReport('curation', digest);
    
    const duration = Date.now() - startTime;
    console.log(`[Memory Jobs] Curation completed in ${duration}ms`);
    console.log(digest);
    
    return results;
  } catch (error) {
    console.error('[Memory Jobs] Curation job failed:', error);
    throw error;
  }
}

/**
 * Generate decay report
 */
function generateDecayReport(results: DecayResult[]): string {
  let report = '# Daily Memory Decay Report\n\n';
  report += `Date: ${new Date().toISOString()}\n\n`;
  
  const totalEvaluated = results.reduce((sum, r) => sum + r.evaluated, 0);
  const totalArchived = results.reduce((sum, r) => sum + r.archived, 0);
  
  report += `## Summary\n\n`;
  report += `- **Total Memories Evaluated**: ${totalEvaluated}\n`;
  report += `- **Total Archived**: ${totalArchived}\n\n`;
  
  if (totalArchived > 0) {
    let lowCount = 0;
    let mediumCount = 0;
    let highCount = 0;
    
    for (const result of results) {
      lowCount += result.archivedByImportance.low;
      mediumCount += result.archivedByImportance.medium;
      highCount += result.archivedByImportance.high;
    }
    
    report += `### Archived by Importance\n\n`;
    report += `- Low: ${lowCount}\n`;
    report += `- Medium: ${mediumCount}\n`;
    report += `- High: ${highCount}\n\n`;
  }
  
  report += `## Per-Persona Results\n\n`;
  
  for (const result of results) {
    if (result.archived > 0) {
      report += `### ${result.personaId}\n`;
      report += `- Evaluated: ${result.evaluated}\n`;
      report += `- Archived: ${result.archived}\n`;
      report += `  - Low: ${result.archivedByImportance.low}\n`;
      report += `  - Medium: ${result.archivedByImportance.medium}\n`;
      report += `  - High: ${result.archivedByImportance.high}\n\n`;
    }
  }
  
  return report;
}

/**
 * Save job report to disk
 */
async function saveJobReport(jobType: 'decay' | 'curation', report: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${jobType}--${timestamp}.md`;
  const filepath = path.join(JOBS_DIR, filename);
  
  await fs.writeFile(filepath, report, 'utf8');
  console.log(`[Memory Jobs] Report saved: ${filepath}`);
}

/**
 * Get job status
 */
export function getJobStatus(): {
  isRunning: boolean;
  decayActive: boolean;
  curationActive: boolean;
} {
  return {
    isRunning,
    decayActive: decayJob !== null,
    curationActive: curationJob !== null,
  };
}

/**
 * Get recent job reports
 */
export async function getRecentReports(limit: number = 10): Promise<Array<{
  type: 'decay' | 'curation';
  timestamp: string;
  content: string;
}>> {
  try {
    const files = await fs.readdir(JOBS_DIR);
    const reports: Array<{
      type: 'decay' | 'curation';
      timestamp: string;
      content: string;
    }> = [];
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const basename = file.slice(0, -3);
      
      // Try splitting by '--' separator first (new format)
      let parts = basename.split('--');
      let type: string;
      let timestamp: string;
      
      // If no '--' separator, fall back to '-' separator (old format)
      // The timestamp always starts with a 4-digit year, so we split on the
      // '-' that precedes the year pattern (e.g., "decay-2024-01-15..." -> ["decay", "2024-01-15..."])
      if (parts.length !== 2) {
        const yearMatch = basename.match(/^([^-]+)-(\d{4}-)/);
        if (yearMatch) {
          type = yearMatch[1];
          timestamp = yearMatch[2] + basename.slice(yearMatch[0].length);
        } else {
          continue;
        }
      } else {
        type = parts[0];
        timestamp = parts[1];
      }
      
      if (type !== 'decay' && type !== 'curation') continue;
      
      const filepath = path.join(JOBS_DIR, file);
      const content = await fs.readFile(filepath, 'utf8');
      
      reports.push({
        type: type as 'decay' | 'curation',
        timestamp,
        content,
      });
    }
    
    // Sort by timestamp (newest first)
    reports.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    return reports.slice(0, limit);
  } catch (error) {
    console.error('[Memory Jobs] Failed to read reports:', error);
    return [];
  }
}
