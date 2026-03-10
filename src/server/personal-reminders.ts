import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const REMINDERS_FILE = path.join(STORAGE_DIR, 'personal-reminders.json');

export interface Recurrence {
  type: 'simple' | 'cron';
  interval?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  weekday?: string;
  cronExpr?: string;
  nextOccurrence?: string;
}

export interface PersonalReminder {
  id: string;
  message: string;
  triggerTime: Date;
  cleanupAfter?: Date;
  taskId?: string;
  createdAt: Date;
  creator: string;
  target: string;
  type: 'scheduled' | 'adhoc';
  recurrence?: Recurrence;
  status: 'pending' | 'triggered' | 'completed' | 'paused';
}

export async function loadReminders(): Promise<PersonalReminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    const reminders = JSON.parse(content);

    return reminders.map((r: any) => {
      const triggerTime = r.triggerTime 
        ? new Date(r.triggerTime) 
        : (r.remindAt ? new Date(r.remindAt) : new Date(r.createdAt));
      
      const cleanupAfter = r.cleanupAfter ? new Date(r.cleanupAfter) : undefined;
      
      let status: 'pending' | 'triggered' | 'completed' | 'paused' = 'pending';
      if (r.status) {
        status = r.status;
      } else if (r.triggered === true) {
        status = 'triggered';
      }

      return {
        ...r,
        triggerTime,
        cleanupAfter,
        createdAt: new Date(r.createdAt),
        status,
        triggered: undefined,
        remindAt: undefined
      };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    console.error('Failed to load personal reminders:', error);
    return [];
  }
}

async function saveReminders(reminders: PersonalReminder[]): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

export async function createReminder(
  message: string,
  triggerTime: Date,
  taskId: string | undefined,
  creator: string,
  target: string,
  type: 'scheduled' | 'adhoc' = 'adhoc',
  cleanupAfterDays: number = 7
): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const cleanupAfter = new Date(triggerTime.getTime() + cleanupAfterDays * 24 * 60 * 60 * 1000);

  const newReminder: PersonalReminder = {
    id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    message,
    triggerTime,
    cleanupAfter,
    taskId,
    createdAt: new Date(),
    creator,
    target,
    type,
    status: 'pending'
  };

  reminders.push(newReminder);
  await saveReminders(reminders);
  return newReminder;
}

export async function getAllReminders(): Promise<PersonalReminder[]> {
  return await loadReminders();
}

export async function getPendingReminders(): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  return reminders.filter(r => r.status === 'pending');
}

export async function getDueReminders(): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  const now = new Date();
  return reminders.filter(r => r.status === 'pending' && r.triggerTime <= now);
}

export async function getRemindersForCleanup(): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  const now = new Date();
  return reminders.filter(r => 
    r.cleanupAfter && 
    r.cleanupAfter <= now && 
    (r.status === 'triggered' || r.status === 'completed')
  );
}

export async function getRemindersForTarget(target: string): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  return reminders.filter(r => r.target === target);
}

export async function getReminderById(id: string): Promise<PersonalReminder | null> {
  const reminders = await loadReminders();
  return reminders.find(r => r.id === id) || null;
}

export async function markReminderTriggered(reminderId: string): Promise<void> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  reminders[index].status = 'triggered';
  await saveReminders(reminders);
}

export async function markReminderCompleted(reminderId: string): Promise<void> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  reminders[index].status = 'completed';
  await saveReminders(reminders);
}

export async function snoozeReminder(reminderId: string, newTriggerTime: Date): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  reminders[index].triggerTime = newTriggerTime;
  reminders[index].status = 'pending';
  await saveReminders(reminders);
  return reminders[index];
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const reminders = await loadReminders();
  const filtered = reminders.filter(r => r.id !== reminderId);
  if (filtered.length === reminders.length) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  await saveReminders(filtered);
}

export async function clearTriggeredReminders(): Promise<void> {
  const reminders = await loadReminders();
  const active = reminders.filter(r => r.status === 'pending' || r.status === 'paused');
  await saveReminders(active);
}

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

export function parseSimpleInterval(expr: string): { interval: 'daily' | 'weekly' | 'biweekly' | 'monthly'; weekday?: string } | null {
  const lower = expr.toLowerCase().trim();
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (weekdays.includes(lower)) {
    return { interval: 'weekly', weekday: lower };
  }
  if (lower === 'daily') {
    return { interval: 'daily' };
  }
  if (lower === 'biweekly' || lower === '2w' || lower === '2weeks') {
    return { interval: 'biweekly' };
  }
  if (lower === 'monthly' || lower === '1m') {
    return { interval: 'monthly' };
  }
  if (lower === 'weekly' || lower === '1w' || lower === '1week') {
    return { interval: 'weekly' };
  }
  return null;
}

export function calculateNextOccurrence(recurrence: Recurrence, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);
  
  if (recurrence.type === 'cron' && recurrence.cronExpr) {
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
          if (daysUntilTarget <= 0) {
            daysUntilTarget += 7;
          }
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

export async function scheduleNextOccurrence(reminderId: string): Promise<PersonalReminder | null> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1 || !reminders[index].recurrence) {
    return null;
  }
  const reminder = reminders[index];
  const nextDate = calculateNextOccurrence(reminder.recurrence, reminder.triggerTime);
  reminders[index].triggerTime = nextDate;
  reminders[index].status = 'pending';
  if (reminders[index].recurrence) {
    reminders[index].recurrence.nextOccurrence = nextDate.toISOString();
  }
  await saveReminders(reminders);
  return reminders[index];
}

export async function createRecurringReminder(
  message: string,
  recurrence: Recurrence,
  taskId: string | undefined,
  creator: string,
  target: string,
  initialTriggerTime?: Date,
  cleanupAfterDays: number = 7
): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const firstOccurrence = initialTriggerTime || calculateNextOccurrence(recurrence, new Date());
  const cleanupAfter = new Date(firstOccurrence.getTime() + cleanupAfterDays * 24 * 60 * 60 * 1000);
  
  const newReminder: PersonalReminder = {
    id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    message,
    triggerTime: firstOccurrence,
    cleanupAfter,
    taskId,
    createdAt: new Date(),
    creator,
    target,
    type: 'scheduled',
    recurrence: {
      ...recurrence,
      nextOccurrence: firstOccurrence.toISOString()
    },
    status: 'pending'
  };
  
  reminders.push(newReminder);
  await saveReminders(reminders);
  return newReminder;
}

export async function pauseReminder(reminderId: string): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  reminders[index].status = 'paused';
  await saveReminders(reminders);
  return reminders[index];
}

export async function resumeReminder(reminderId: string): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  const reminder = reminders[index];
  if (reminder.recurrence) {
    const nextDate = calculateNextOccurrence(reminder.recurrence, new Date());
    reminder.triggerTime = nextDate;
    reminder.recurrence.nextOccurrence = nextDate.toISOString();
  }
  reminder.status = 'pending';
  await saveReminders(reminders);
  return reminder;
}

export async function cleanupOldReminders(): Promise<number> {
  const reminders = await loadReminders();
  const now = new Date();
  const toKeep: PersonalReminder[] = [];
  let cleanedCount = 0;
  
  for (const reminder of reminders) {
    if (reminder.cleanupAfter && reminder.cleanupAfter <= now && 
        (reminder.status === 'triggered' || reminder.status === 'completed')) {
      cleanedCount++;
    } else {
      toKeep.push(reminder);
    }
  }
  
  if (cleanedCount > 0) {
    await saveReminders(toKeep);
  }
  return cleanedCount;
}
