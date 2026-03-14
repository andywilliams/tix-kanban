/**
 * Collaboration Control System
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
// chat-storage import removed: getChannel was unused

const CONTROL_DIR = path.join(os.homedir(), '.tix-kanban', 'collaboration-control');
const MAX_TURNS_PER_COLLABORATION = 20;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEADLOCK_TIMEOUT_MS = 10 * 60 * 1000;

// Per-channel file locks to prevent concurrent read-modify-write races
const channelLocks = new Map<string, Promise<void>>();

function withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  channelLocks.set(channelId, next.then(() => {}, () => {}));
  return next;
}

export interface CollaborationState {
  channelId: string;
  isPaused: boolean;
  pausedAt?: Date;
  pausedBy?: string;
  turnCount: number;
  startedAt: Date;
  lastMessageAt: Date;
  lastProgressAt: Date;
  participatingPersonas: string[];
  warnings: string[];
}

export async function initializeControlStorage(): Promise<void> {
  await fs.mkdir(CONTROL_DIR, { recursive: true });
}

function getStateFilePath(channelId: string): string {
  return path.join(CONTROL_DIR, `${channelId}-state.json`);
}

export async function getCollaborationState(channelId: string): Promise<CollaborationState | null> {
  const filePath = getStateFilePath(channelId);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const state: CollaborationState = JSON.parse(data);
    state.startedAt = new Date(state.startedAt);
    state.lastMessageAt = new Date(state.lastMessageAt);
    state.lastProgressAt = new Date(state.lastProgressAt);
    if (state.pausedAt) state.pausedAt = new Date(state.pausedAt);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function initializeCollaboration(channelId: string, participatingPersonas: string[]): Promise<CollaborationState> {
  const now = new Date();
  const state: CollaborationState = {
    channelId, isPaused: false, turnCount: 0, startedAt: now, lastMessageAt: now,
    lastProgressAt: now, participatingPersonas, warnings: [],
  };
  await saveCollaborationState(state);
  return state;
}

export async function saveCollaborationState(state: CollaborationState): Promise<void> {
  await fs.writeFile(getStateFilePath(state.channelId), JSON.stringify(state, null, 2));
}

export async function pauseCollaboration(channelId: string, pausedBy: string): Promise<void> {
  return withChannelLock(channelId, async () => {
    let state = await getCollaborationState(channelId);
    if (!state) throw new Error(`No collaboration found for channel ${channelId}`);
    state.isPaused = true;
    state.pausedAt = new Date();
    state.pausedBy = pausedBy;
    await saveCollaborationState(state);
    console.log(`⏸️ Collaboration paused by ${pausedBy} in ${channelId}`);
  });
}

export async function resumeCollaboration(channelId: string): Promise<void> {
  return withChannelLock(channelId, async () => {
    let state = await getCollaborationState(channelId);
    if (!state) throw new Error(`No collaboration found for channel ${channelId}`);
    state.isPaused = false;
    state.pausedAt = undefined;
    state.pausedBy = undefined;
    await saveCollaborationState(state);
    console.log(`▶️ Collaboration resumed in ${channelId}`);
  });
}

export async function canTakeTurn(channelId: string, personaId: string): Promise<{ allowed: boolean; reason?: string }> {
  return withChannelLock(channelId, async () => {
    let state = await getCollaborationState(channelId);
    if (!state) state = await initializeCollaboration(channelId, [personaId]);
    if (state.isPaused) return { allowed: false, reason: `Collaboration paused by ${state.pausedBy}` };
    if (state.turnCount >= MAX_TURNS_PER_COLLABORATION) return { allowed: false, reason: `Turn limit reached (${state.turnCount}/${MAX_TURNS_PER_COLLABORATION})` };
    const timeSinceLastMessage = Date.now() - state.lastMessageAt.getTime();
    if (timeSinceLastMessage > IDLE_TIMEOUT_MS) return { allowed: false, reason: `Idle timeout - no messages for ${Math.floor(timeSinceLastMessage / 60000)} minutes` };
    const timeSinceProgress = Date.now() - state.lastProgressAt.getTime();
    if (timeSinceProgress > DEADLOCK_TIMEOUT_MS) return { allowed: false, reason: `Deadlock detected - no progress for ${Math.floor(timeSinceProgress / 60000)} minutes` };
    if (!state.participatingPersonas.includes(personaId)) {
      state.participatingPersonas.push(personaId);
      await saveCollaborationState(state);
    }
    return { allowed: true };
  });
}

export async function recordTurn(channelId: string, personaId: string, hasProgress: boolean = true): Promise<void> {
  return withChannelLock(channelId, async () => {
    let state = await getCollaborationState(channelId);
    if (!state) state = await initializeCollaboration(channelId, [personaId]);
    state.turnCount++;
    state.lastMessageAt = new Date();
    if (hasProgress) state.lastProgressAt = new Date();
    await saveCollaborationState(state);
    console.log(`📊 Turn ${state.turnCount}/${MAX_TURNS_PER_COLLABORATION} by ${personaId} in ${channelId}`);
  });
}

/**
 * Record a human message to reset the idle timer.
 * This prevents the collaboration from being blocked due to idle timeout
 * when humans send messages but no persona has responded yet.
 */
export async function recordHumanMessage(channelId: string): Promise<void> {
  return withChannelLock(channelId, async () => {
    let state = await getCollaborationState(channelId);
    if (!state) return; // No active collaboration to update
    state.lastMessageAt = new Date();
    await saveCollaborationState(state);
    console.log(`💬 Human message recorded in ${channelId} - idle timer reset`);
  });
}

export async function getCollaborationStatus(channelId: string): Promise<string> {
  const state = await getCollaborationState(channelId);
  if (!state) return 'No active collaboration';
  const lines = [
    `**Collaboration Status for ${channelId}**`, '',
    `- State: ${state.isPaused ? '⏸️ PAUSED' : '▶️ ACTIVE'}`,
    `- Turns: ${state.turnCount}/${MAX_TURNS_PER_COLLABORATION}`,
    `- Participants: ${state.participatingPersonas.join(', ')}`,
  ];
  if (state.warnings.length > 0) {
    lines.push('', '**Warnings:**', ...state.warnings.map(w => `- ${w}`));
  }
  return lines.join('\n');
}

export async function cleanupOldStates(daysOld: number = 7): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  let cleaned = 0;
  try {
    const files = await fs.readdir(CONTROL_DIR);
    for (const file of files) {
      if (!file.endsWith('-state.json')) continue;
      const filePath = path.join(CONTROL_DIR, file);
      const stats = await fs.stat(filePath);
      if (stats.mtime < cutoffDate) {
        await fs.unlink(filePath);
        cleaned++;
      }
    }
  } catch (error) {
    console.error('Error cleaning up old states:', error);
  }
  if (cleaned > 0) console.log(`🧹 Cleaned up ${cleaned} old collaboration states`);
  return cleaned;
}
