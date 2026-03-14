/**
 * Collaboration Audit Trail
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const AUDIT_DIR = path.join(os.homedir(), '.tix-kanban', 'audit');
const APPEND_MODE = { flag: 'a' };

export type AuditEventType = 'collaboration-start' | 'collaboration-end' | 'turn-taken' | 'turn-denied' |
  'budget-check' | 'budget-exceeded' | 'pause' | 'resume' | 'timeout' | 'deadlock' | 'error' | 'warning' |
  'context-summarised' | 'message-sent';

export interface AuditEvent {
  timestamp: Date;
  type: AuditEventType;
  channelId: string;
  personaId?: string;
  taskId?: string;
  data: Record<string, any>;
  metadata?: { turnCount?: number; budgetRemaining?: number; messageId?: string; };
}

export async function initializeAuditStorage(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
}

function getAuditLogPath(channelId: string): string {
  return path.join(AUDIT_DIR, `${channelId}.jsonl`);
}

function getDailyAuditLogPath(): string {
  return path.join(AUDIT_DIR, `global-${new Date().toISOString().split('T')[0]}.jsonl`);
}

export async function auditEvent(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
  const fullEvent: AuditEvent = { ...event, timestamp: new Date() };
  const logLine = JSON.stringify(fullEvent) + '\n';
  await fs.writeFile(getAuditLogPath(event.channelId), logLine, APPEND_MODE);
  await fs.writeFile(getDailyAuditLogPath(), logLine, APPEND_MODE);
}

export async function auditTurnTaken(
  channelId: string, personaId: string, turnNumber: number, messageId: string,
  inputTokens: number, outputTokens: number, cost: number, taskId?: string
): Promise<void> {
  await auditEvent({
    type: 'turn-taken', channelId, personaId, taskId,
    data: { turnNumber, inputTokens, outputTokens, cost },
    metadata: { turnCount: turnNumber, messageId },
  });
}

export async function auditTurnDenied(channelId: string, personaId: string, reason: string, taskId?: string): Promise<void> {
  await auditEvent({ type: 'turn-denied', channelId, personaId, taskId, data: { reason } });
  console.log(`📝 Audit: Turn denied for ${personaId} in ${channelId} - ${reason}`);
}

export async function auditBudgetCheck(
  channelId: string, personaId: string, allowed: boolean, estimatedCost: number, remainingBudget: number, reason?: string
): Promise<void> {
  await auditEvent({
    type: allowed ? 'budget-check' : 'budget-exceeded', channelId, personaId,
    data: { allowed, estimatedCost, remainingBudget, reason },
    metadata: { budgetRemaining: remainingBudget },
  });
  if (!allowed) console.log(`📝 Audit: Budget exceeded for ${personaId} - ${reason}`);
}

export async function auditError(channelId: string, personaId: string | undefined, error: Error, context: Record<string, any> = {}): Promise<void> {
  await auditEvent({ type: 'error', channelId, personaId, data: { errorMessage: error.message, errorStack: error.stack, ...context } });
  console.log(`📝 Audit: Error in ${channelId} - ${error.message}`);
}

export async function auditContextSummarised(channelId: string, messagesSummarised: number, summaryTokens: number): Promise<void> {
  await auditEvent({ type: 'context-summarised', channelId, data: { messagesSummarised, summaryTokens } });
  console.log(`📝 Audit: Summarised ${messagesSummarised} messages in ${channelId}`);
}

export async function getAuditLog(channelId: string): Promise<AuditEvent[]> {
  const logPath = getAuditLogPath(channelId);
  try {
    const data = await fs.readFile(logPath, 'utf8');
    return data.trim().split('\n').filter(Boolean).map(line => {
      const event: AuditEvent = JSON.parse(line);
      event.timestamp = new Date(event.timestamp);
      return event;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function getDailyAuditLog(date?: string): Promise<AuditEvent[]> {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const logPath = path.join(AUDIT_DIR, `global-${targetDate}.jsonl`);
  try {
    const data = await fs.readFile(logPath, 'utf8');
    return data.trim().split('\n').filter(Boolean).map(line => {
      const event: AuditEvent = JSON.parse(line);
      event.timestamp = new Date(event.timestamp);
      return event;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function generateAuditReport(channelId: string): Promise<string> {
  const events = await getAuditLog(channelId);
  if (events.length === 0) return `No audit events found for channel ${channelId}`;
  const lines = [`# Audit Report: ${channelId}`, '', `Total events: ${events.length}`, ''];
  const byType: Record<string, number> = {};
  for (const event of events) byType[event.type] = (byType[event.type] || 0) + 1;
  lines.push('## Event Summary');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) lines.push(`- ${type}: ${count}`);
  lines.push('', '## Recent Events (last 10)');
  const recentEvents = events.slice(-10);
  for (const event of recentEvents) {
    lines.push(`[${event.timestamp.toISOString()}] ${event.type} - ${event.personaId || 'system'}`);
    lines.push(`  ${JSON.stringify(event.data)}`);
  }
  return lines.join('\n');
}

export async function archiveOldAuditLogs(daysOld: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  let archived = 0;
  try {
    const files = await fs.readdir(AUDIT_DIR);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(AUDIT_DIR, file);
      const stats = await fs.stat(filePath);
      if (stats.mtime < cutoffDate) {
        const archiveDir = path.join(AUDIT_DIR, 'archive');
        await fs.mkdir(archiveDir, { recursive: true });
        await fs.rename(filePath, path.join(archiveDir, file));
        archived++;
      }
    }
  } catch (error) {
    console.error('Error archiving audit logs:', error);
  }
  if (archived > 0) console.log(`📦 Archived ${archived} old audit logs`);
  return archived;
}
