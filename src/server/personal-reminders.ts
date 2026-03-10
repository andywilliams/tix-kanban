import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const REMINDERS_FILE = path.join(STORAGE_DIR, 'personal-reminders.json');

export interface Recurrence {
  type: 'simple' | 'cron';
  interval?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  weekday?: string; // 'monday', 'tuesday', etc.
  cronExpr?: string; // e.g. "0 9 1 * *"
  nextOccurrence?: string; // ISO timestamp for next trigger
}

export interface PersonalReminder {
  id: string;
  message: string;
  remindAt: Date;
  taskId?: string; // Optional: if tied to a specific task
  createdAt: Date;
  triggered: boolean;
  creator: string; // persona-id or 'human:name'
  target: string; // persona-id or 'human:name'
  type: 'scheduled' | 'adhoc';
  recurrence?: Recurrence;
  status: 'pending' | 'paused';
}

// Load reminders from disk
export async function loadReminders(): Promise<PersonalReminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    const reminders = JSON.parse(content);

    // Convert date strings back to Date objects and handle backward compatibility
    return reminders.map((r: any) => ({
      ...r,
      remindAt: new Date(r.remindAt),
      createdAt: new Date(r.createdAt),
      // Backward compatibility: add default status and recurrence for old reminders
      status: r.status || 'pending',
      recurrence: r.recurrence || undefined
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    console.error('Failed to load personal reminders:', error);
    return [];
  }
}

// Save reminders to disk
async function saveReminders(reminders: PersonalReminder[]): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

// Create a new personal reminder
export async function createReminder(
  message: string,
  remindAt: Date,
  taskId: string | undefined,
  creator: string, // persona-id or 'human:name'
  target: string, // persona-id or 'human:name'
  type: 'scheduled' | 'adhoc' = 'adhoc',
  recurrence?: Recurrence
): Promise<PersonalReminder> {
  const reminders = await loadReminders();

  const newReminder: PersonalReminder = {
    id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    message,
    remindAt,
    taskId,
    createdAt: new Date(),
    triggered: false,
    creator,
    target,
    type,
    recurrence,
    status: 'pending'
  };

  reminders.push(newReminder);
  await saveReminders(reminders);

  return newReminder;
}

// Get all reminders (including triggered ones for history)
export async function getAllReminders(): Promise<PersonalReminder[]> {
  return await loadReminders();
}

// Get pending (not triggered) reminders
export async function getPendingReminders(): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  return reminders.filter(r => !r.triggered);
}

// Get reminders that are due (remindAt <= now and not triggered)
export async function getDueReminders(): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  const now = new Date();
  // Exclude paused reminders — they should not fire until resumed
  return reminders.filter(r => r.status === 'pending' && r.triggerTime <= now);
}

// Get reminders for a specific target (persona-id or 'human:name')
export async function getRemindersForTarget(target: string): Promise<PersonalReminder[]> {
  const reminders = await loadReminders();
  return reminders.filter(r => r.target === target);
}

// Get a single reminder by ID
export async function getReminderById(id: string): Promise<PersonalReminder | null> {
  const reminders = await loadReminders();
  return reminders.find(r => r.id === id) || null;
}

// Mark a reminder as triggered
export async function markReminderTriggered(reminderId: string): Promise<void> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);

  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }

  reminders[index].triggered = true;
  await saveReminders(reminders);
}

// Snooze a reminder - update remindAt time and reset triggered status
export async function snoozeReminder(reminderId: string, newRemindAt: Date): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);

  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }

  reminders[index].remindAt = newRemindAt;
  reminders[index].triggered = false;
  await saveReminders(reminders);

  return reminders[index];
}

// Delete a reminder
export async function deleteReminder(reminderId: string): Promise<void> {
  const reminders = await loadReminders();
  const filtered = reminders.filter(r => r.id !== reminderId);

  if (filtered.length === reminders.length) {
    throw new Error(`Reminder ${reminderId} not found`);
  }

  await saveReminders(filtered);
}

// Clear all triggered reminders
export async function clearTriggeredReminders(): Promise<void> {
  const reminders = await loadReminders();
  const active = reminders.filter(r => !r.triggered);
  await saveReminders(active);
}

// Helper function to check if a target is a human (starts with 'human:')
export function isHumanTarget(target: string): boolean {
  return target.startsWith('human:');
}

// Helper function to check if a target is a persona
export function isPersonaTarget(target: string): boolean {
  return !target.startsWith('human:');
}

// Format target for display
export function formatTarget(target: string): string {
  if (isHumanTarget(target)) {
    return target.replace('human:', '') + ' (human)';
  }
  return target + ' (persona)';
}

// Parse simple interval expressions like "monday", "2w", "daily", "monthly"
export function parseSimpleInterval(expr: string): { interval: 'daily' | 'weekly' | 'biweekly' | 'monthly'; weekday?: string } | null {
  const lower = expr.toLowerCase().trim();
  
  // Handle weekday expressions like "monday", "tuesday", etc.
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (weekdays.includes(lower)) {
    return { interval: 'weekly', weekday: lower };
  }
  
  // Handle daily
  if (lower === 'daily') {
    return { interval: 'daily' };
  }
  
  // Handle biweekly (also "2w", "2weeks", "biweekly")
  if (lower === 'biweekly' || lower === '2w' || lower === '2weeks') {
    return { interval: 'biweekly' };
  }
  
  // Handle monthly (also "monthly", "1m")
  if (lower === 'monthly' || lower === '1m') {
    return { interval: 'monthly' };
  }
  
  // Handle weekly (also "weekly", "1w", "1week")
  if (lower === 'weekly' || lower === '1w' || lower === '1week') {
    return { interval: 'weekly' };
  }
  
  return null;
}

// Calculate the next occurrence based on recurrence
export function calculateNextOccurrence(recurrence: Recurrence, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);
  
  if (recurrence.type === 'cron' && recurrence.cronExpr) {
    // For cron expressions, we'll use a simple approach - schedule for next day
    // More sophisticated cron parsing could be added with node-cron
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
            daysUntilTarget += 7; // Next week
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
        // Set date to 1 BEFORE incrementing month to avoid overflow
        // (e.g. Jan 31 + 1 month → Mar 3 without this fix)
        next.setDate(1);
        next.setMonth(next.getMonth() + 1);
        next.setHours(9, 0, 0, 0);
        break;
    }
  }
  
  return next;
}

// Schedule the next occurrence for a recurring reminder
export async function scheduleNextOccurrence(reminderId: string): Promise<PersonalReminder | null> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  
  if (index === -1 || !reminders[index].recurrence) {
    return null;
  }
  
  const reminder = reminders[index];
  const nextDate = calculateNextOccurrence(reminder.recurrence, reminder.remindAt);
  
  reminders[index].remindAt = nextDate;
  reminders[index].triggered = false;
  if (reminders[index].recurrence) {
    reminders[index].recurrence.nextOccurrence = nextDate.toISOString();
  }
  
  await saveReminders(reminders);
  return reminders[index];
}

// Create a recurring reminder
export async function createRecurringReminder(
  message: string,
  recurrence: Recurrence,
  taskId: string | undefined,
  creator: string,
  target: string,
  initialRemindAt?: Date
): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  
  // Calculate first occurrence if not provided
  const firstOccurrence = initialRemindAt || calculateNextOccurrence(recurrence, new Date());
  
  const newReminder: PersonalReminder = {
    id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    message,
    remindAt: firstOccurrence,
    taskId,
    createdAt: new Date(),
    triggered: false,
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

// Pause a recurring reminder
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

// Resume a paused recurring reminder
export async function resumeReminder(reminderId: string): Promise<PersonalReminder> {
  const reminders = await loadReminders();
  const index = reminders.findIndex(r => r.id === reminderId);
  
  if (index === -1) {
    throw new Error(`Reminder ${reminderId} not found`);
  }
  
  const reminder = reminders[index];
  
  // If it's a recurring reminder, calculate next occurrence
  if (reminder.recurrence) {
    const nextDate = calculateNextOccurrence(reminder.recurrence, new Date());
    reminder.remindAt = nextDate;
    reminder.recurrence.nextOccurrence = nextDate.toISOString();
  }
  
  reminder.status = 'pending';
  reminder.triggered = false;
  await saveReminders(reminders);
  
  return reminder;
}