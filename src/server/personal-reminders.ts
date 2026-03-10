import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ─── Storage Paths ────────────────────────────────────────────────────────────

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const REMINDERS_DIR = path.join(STORAGE_DIR, 'reminders');
const INDEX_FILE = path.join(REMINDERS_DIR, 'index.json');
/** Legacy single-file path — used for one-time migration only */
const LEGACY_REMINDERS_FILE = path.join(STORAGE_DIR, 'personal-reminders.json');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Recurrence {
  type: 'simple' | 'cron';
  interval?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  weekday?: string; // 'monday', 'tuesday', etc.
  cronExpr?: string; // e.g. "0 9 1 * *"
  nextOccurrence?: string; // ISO timestamp for next trigger
}

/**
 * Unified reminder schema (all types share this shape).
 *
 * Status lifecycle:
 *   pending → triggered → (snoozed → triggered)* → completed → [cleanup]
 *
 * `cleanupAfter` is set when the reminder first triggers.
 * Default retention: 7 days after trigger.
 *
 * Stored as individual JSON files: ~/.tix-kanban/reminders/<id>.json
 * ID format: rem_<base36-ts><rand7>
 */
export interface PersonalReminder {
  /** Stable identifier, format: rem_<nanoid> */
  id: string;
  /** Semantic classification */
  type: 'task-based' | 'recurring' | 'adhoc' | 'smart';
  /** Who created the reminder — "human:andy" or "persona:developer" */
  creator: string;
  /** Who should receive / action the reminder */
  target: string;
  /** Human-readable reminder text */
  message: string;
  /** Optional kanban task reference */
  taskId?: string;
  /** When the reminder should fire (ISO 8601) */
  triggerTime: string;
  /** Current lifecycle state */
  status: 'pending' | 'triggered' | 'snoozed' | 'paused' | 'completed';
  /** How many times this reminder has been snoozed */
  snoozeCount: number;
  /** Recurrence config, null for one-shot reminders */
  recurrence: Recurrence | null;
  /** When this reminder was first created (ISO 8601) */
  createdAt: string;
  /** When status first moved to "triggered" (ISO 8601), or null */
  triggeredAt: string | null;
  /**
   * When this reminder is eligible for GC (ISO 8601), or null.
   * Set to triggeredAt + 7 days when the reminder first triggers.
   */
  cleanupAfter: string | null;
}

/** Lightweight record stored in index.json for fast listing without reading all files */
export interface ReminderIndexEntry {
  id: string;
  type: PersonalReminder['type'];
  status: PersonalReminder['status'];
  triggerTime: string;
}

// ─── Legacy Types (migration) ─────────────────────────────────────────────────

interface LegacyReminder {
  id: string;
  message: string;
  remindAt?: string;
  triggerTime?: string;
  taskId?: string;
  createdAt: string;
  triggered?: boolean;
  creator: string;
  target: string;
  type?: string;
  recurrence?: Recurrence;
  status?: string;
  cleanupAfter?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reminderFilePath(id: string): string {
  return path.join(REMINDERS_DIR, `${id}.json`);
}

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substr(2, 7);
  return `rem_${ts}${rand}`;
}

const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function ensureRemindersDir(): Promise<void> {
  await fs.mkdir(REMINDERS_DIR, { recursive: true });
}

// ─── Index Management ─────────────────────────────────────────────────────────

async function loadIndex(): Promise<ReminderIndexEntry[]> {
  try {
    const content = await fs.readFile(INDEX_FILE, 'utf-8');
    return JSON.parse(content) as ReminderIndexEntry[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.error('Failed to load reminder index:', err);
    return [];
  }
}

async function saveIndex(index: ReminderIndexEntry[]): Promise<void> {
  await ensureRemindersDir();
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

function toIndexEntry(r: PersonalReminder): ReminderIndexEntry {
  return { id: r.id, type: r.type, status: r.status, triggerTime: r.triggerTime };
}

async function upsertIndexEntry(reminder: PersonalReminder): Promise<void> {
  const index = await loadIndex();
  const pos = index.findIndex(e => e.id === reminder.id);
  const entry = toIndexEntry(reminder);
  if (pos === -1) index.push(entry);
  else index[pos] = entry;
  await saveIndex(index);
}

async function removeIndexEntry(id: string): Promise<void> {
  const index = await loadIndex();
  await saveIndex(index.filter(e => e.id !== id));
}

// ─── Per-file CRUD ────────────────────────────────────────────────────────────

async function readReminderFile(id: string): Promise<PersonalReminder | null> {
  try {
    const content = await fs.readFile(reminderFilePath(id), 'utf-8');
    return JSON.parse(content) as PersonalReminder;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeReminderFile(reminder: PersonalReminder): Promise<void> {
  await ensureRemindersDir();
  await fs.writeFile(reminderFilePath(reminder.id), JSON.stringify(reminder, null, 2));
  await upsertIndexEntry(reminder);
}

async function deleteReminderFile(id: string): Promise<void> {
  try {
    await fs.unlink(reminderFilePath(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await removeIndexEntry(id);
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * One-time migration from the legacy single-file format.
 * Runs on first load when the reminders/ dir doesn't exist yet.
 */
async function migrateLegacyIfNeeded(): Promise<void> {
  // Already migrated if the dir exists
  try {
    await fs.access(REMINDERS_DIR);
    return;
  } catch {
    // dir doesn't exist — proceed with migration
  }

  let legacy: LegacyReminder[] = [];
  try {
    const content = await fs.readFile(LEGACY_REMINDERS_FILE, 'utf-8');
    legacy = JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to read legacy reminders for migration:', err);
    }
    // No legacy file — create an empty dir and return
    await ensureRemindersDir();
    return;
  }

  await ensureRemindersDir();
  console.log(`[reminders] Migrating ${legacy.length} legacy reminder(s) to per-file format…`);

  for (const raw of legacy) {
    const triggerTime = raw.triggerTime || raw.remindAt || raw.createdAt;

    // Map old type values
    let type: PersonalReminder['type'] = 'adhoc';
    if (raw.type === 'scheduled' || raw.recurrence) type = 'recurring';

    // Map old status values
    let status: PersonalReminder['status'] = 'pending';
    if (raw.status === 'paused') status = 'paused';
    else if (raw.triggered === true) status = 'triggered';

    const reminder: PersonalReminder = {
      id: raw.id.startsWith('rem_') ? raw.id : `rem_${raw.id}`,
      type,
      creator: raw.creator || 'human:andy',
      target: raw.target || 'human:andy',
      message: raw.message,
      taskId: raw.taskId,
      triggerTime: triggerTime!,
      status,
      snoozeCount: 0,
      recurrence: raw.recurrence || null,
      createdAt: raw.createdAt,
      triggeredAt: raw.triggered ? triggerTime! : null,
      cleanupAfter: raw.cleanupAfter || null,
    };

    await writeReminderFile(reminder);
  }

  // Rename the legacy file so we don't migrate again
  try {
    await fs.rename(LEGACY_REMINDERS_FILE, `${LEGACY_REMINDERS_FILE}.migrated`);
  } catch {
    // Non-fatal
  }

  console.log('[reminders] Migration complete.');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load all reminders from disk (triggers migration if needed). */
export async function loadReminders(): Promise<PersonalReminder[]> {
  await migrateLegacyIfNeeded();
  const index = await loadIndex();
  const results: PersonalReminder[] = [];
  for (const entry of index) {
    const r = await readReminderFile(entry.id);
    if (r) results.push(r);
  }
  return results;
}

/** Create a new one-shot reminder. */
export async function createReminder(
  message: string,
  triggerTime: Date,
  taskId: string | undefined,
  creator: string,
  target: string,
  type: PersonalReminder['type'] = 'adhoc',
  cleanupAfterDays = 7
): Promise<PersonalReminder> {
  await migrateLegacyIfNeeded();

  const triggerISO = triggerTime.toISOString();
  const cleanupAfter = new Date(triggerTime.getTime() + cleanupAfterDays * 24 * 60 * 60 * 1000).toISOString();

  const reminder: PersonalReminder = {
    id: generateId(),
    type,
    creator,
    target,
    message,
    taskId,
    triggerTime: triggerISO,
    status: 'pending',
    snoozeCount: 0,
    recurrence: null,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    cleanupAfter,
  };

  await writeReminderFile(reminder);
  return reminder;
}

/** Get all reminders (including history). */
export async function getAllReminders(): Promise<PersonalReminder[]> {
  return loadReminders();
}

/** Get reminders with status "pending". */
export async function getPendingReminders(): Promise<PersonalReminder[]> {
  await migrateLegacyIfNeeded();
  const index = await loadIndex();
  const pending = index.filter(e => e.status === 'pending');
  const results: PersonalReminder[] = [];
  for (const e of pending) {
    const r = await readReminderFile(e.id);
    if (r) results.push(r);
  }
  return results;
}

/** Get reminders whose triggerTime has passed and are still pending or snoozed. */
export async function getDueReminders(): Promise<PersonalReminder[]> {
  await migrateLegacyIfNeeded();
  const now = new Date().toISOString();
  const index = await loadIndex();
  const due = index.filter(e => (e.status === 'pending' || e.status === 'snoozed') && e.triggerTime <= now);
  const results: PersonalReminder[] = [];
  for (const e of due) {
    const r = await readReminderFile(e.id);
    if (r) results.push(r);
  }
  return results;
}

/** Get reminders past their cleanupAfter date. */
export async function getRemindersForCleanup(): Promise<PersonalReminder[]> {
  const now = new Date().toISOString();
  const all = await loadReminders();
  return all.filter(r =>
    r.cleanupAfter &&
    r.cleanupAfter <= now &&
    (r.status === 'triggered' || r.status === 'completed')
  );
}

/** Get reminders for a specific target. */
export async function getRemindersForTarget(target: string): Promise<PersonalReminder[]> {
  const all = await loadReminders();
  return all.filter(r => r.target === target);
}

/** Get a single reminder by ID. */
export async function getReminderById(id: string): Promise<PersonalReminder | null> {
  await migrateLegacyIfNeeded();
  return readReminderFile(id);
}

/** Mark a reminder as triggered (sets triggeredAt + cleanupAfter on first trigger). */
export async function markReminderTriggered(reminderId: string): Promise<void> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);

  const now = new Date().toISOString();
  reminder.status = 'triggered';
  if (!reminder.triggeredAt) {
    reminder.triggeredAt = now;
    if (!reminder.cleanupAfter) {
      reminder.cleanupAfter = new Date(Date.now() + CLEANUP_RETENTION_MS).toISOString();
    }
  }
  await writeReminderFile(reminder);
}

/** Mark a reminder as completed. */
export async function markReminderCompleted(reminderId: string): Promise<void> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);

  reminder.status = 'completed';
  await writeReminderFile(reminder);
}

/** Snooze a reminder — updates triggerTime, sets status to "snoozed", increments snoozeCount. */
export async function snoozeReminder(reminderId: string, newTriggerTime: Date): Promise<PersonalReminder> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);

  reminder.triggerTime = newTriggerTime.toISOString();
  reminder.status = 'snoozed';
  reminder.snoozeCount += 1;
  await writeReminderFile(reminder);
  return reminder;
}

/** Permanently delete a reminder. */
export async function deleteReminder(reminderId: string): Promise<void> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);
  await deleteReminderFile(reminderId);
}

/** Remove all triggered/completed reminders (housekeeping). */
export async function clearTriggeredReminders(): Promise<void> {
  await migrateLegacyIfNeeded();
  const index = await loadIndex();
  const toDelete = index.filter(e => e.status === 'triggered' || e.status === 'completed');
  for (const e of toDelete) {
    await deleteReminderFile(e.id);
  }
}

/** Remove reminders past their cleanupAfter retention date. Returns count removed. */
export async function cleanupOldReminders(): Promise<number> {
  const due = await getRemindersForCleanup();
  for (const r of due) {
    await deleteReminderFile(r.id);
  }
  return due.length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isHumanTarget(target: string): boolean {
  return target.startsWith('human:');
}

export function isPersonaTarget(target: string): boolean {
  return !target.startsWith('human:');
}

export function formatTarget(target: string): string {
  if (isHumanTarget(target)) {
    return target.replace('human:', '') + ' (human)';
  }
  return target + ' (persona)';
}

// ─── Recurrence Utilities ─────────────────────────────────────────────────────

export function parseSimpleInterval(expr: string): { interval: 'daily' | 'weekly' | 'biweekly' | 'monthly'; weekday?: string } | null {
  const lower = expr.toLowerCase().trim();
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  if (weekdays.includes(lower)) return { interval: 'weekly', weekday: lower };
  if (lower === 'daily') return { interval: 'daily' };
  if (lower === 'biweekly' || lower === '2w' || lower === '2weeks') return { interval: 'biweekly' };
  if (lower === 'monthly' || lower === '1m') return { interval: 'monthly' };
  if (lower === 'weekly' || lower === '1w' || lower === '1week') return { interval: 'weekly' };

  return null;
}

export function calculateNextOccurrence(recurrence: Recurrence, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);

  if (recurrence.type === 'cron' && recurrence.cronExpr) {
    // Basic fallback — next day at 9am. Replace with node-cron for precision.
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next;
  }

  if (recurrence.type === 'simple') {
    switch (recurrence.interval) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        next.setHours(9, 0, 0, 0);
        break;

      case 'weekly':
        if (recurrence.weekday) {
          const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const targetDay = weekdays.indexOf(recurrence.weekday.toLowerCase());
          const currentDay = next.getDay();
          let daysUntilTarget = targetDay - currentDay;
          if (daysUntilTarget <= 0) daysUntilTarget += 7;
          next.setDate(next.getDate() + daysUntilTarget);
        } else {
          next.setDate(next.getDate() + 7);
        }
        next.setHours(9, 0, 0, 0);
        break;

      case 'biweekly':
        next.setDate(next.getDate() + 14);
        next.setHours(9, 0, 0, 0);
        break;

      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
        next.setHours(9, 0, 0, 0);
        break;
    }
  }

  return next;
}

// ─── Recurring Reminders ──────────────────────────────────────────────────────

/** Schedule the next occurrence for a recurring reminder (after it fires). */
export async function scheduleNextOccurrence(reminderId: string): Promise<PersonalReminder | null> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder || !reminder.recurrence) return null;

  const nextDate = calculateNextOccurrence(reminder.recurrence, new Date(reminder.triggerTime));
  reminder.triggerTime = nextDate.toISOString();
  reminder.status = 'pending';
  if (reminder.recurrence) {
    reminder.recurrence.nextOccurrence = nextDate.toISOString();
  }

  await writeReminderFile(reminder);
  return reminder;
}

/** Create a new recurring reminder. */
export async function createRecurringReminder(
  message: string,
  recurrence: Recurrence,
  taskId: string | undefined,
  creator: string,
  target: string,
  initialTriggerTime?: Date,
  cleanupAfterDays = 7
): Promise<PersonalReminder> {
  await migrateLegacyIfNeeded();

  const firstOccurrence = initialTriggerTime || calculateNextOccurrence(recurrence, new Date());
  const cleanupAfter = new Date(firstOccurrence.getTime() + cleanupAfterDays * 24 * 60 * 60 * 1000).toISOString();

  const reminder: PersonalReminder = {
    id: generateId(),
    type: 'recurring',
    creator,
    target,
    message,
    taskId,
    triggerTime: firstOccurrence.toISOString(),
    status: 'pending',
    snoozeCount: 0,
    recurrence: {
      ...recurrence,
      nextOccurrence: firstOccurrence.toISOString(),
    },
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    cleanupAfter,
  };

  await writeReminderFile(reminder);
  return reminder;
}

/** Pause a recurring reminder. */
export async function pauseReminder(reminderId: string): Promise<PersonalReminder> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);

  reminder.status = 'paused';
  await writeReminderFile(reminder);
  return reminder;
}

/** Resume a paused recurring reminder. */
export async function resumeReminder(reminderId: string): Promise<PersonalReminder> {
  const reminder = await readReminderFile(reminderId);
  if (!reminder) throw new Error(`Reminder ${reminderId} not found`);

  if (reminder.recurrence) {
    const nextDate = calculateNextOccurrence(reminder.recurrence, new Date());
    reminder.triggerTime = nextDate.toISOString();
    reminder.recurrence.nextOccurrence = nextDate.toISOString();
  }

  reminder.status = 'pending';
  await writeReminderFile(reminder);
  return reminder;
}
