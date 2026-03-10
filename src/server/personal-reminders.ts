import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const REMINDERS_FILE = path.join(STORAGE_DIR, 'personal-reminders.json');

export interface PersonalReminder {
  id: string;
  message: string;
  remindAt: Date;
  taskId?: string; // Optional: if tied to a specific task
  createdAt: Date;
  triggered: boolean;
  creator: string; // persona-id or 'human:name'
  target: string; // persona-id or 'human:name'
  type: 'scheduled' | 'adhoc'; // Type of reminder
}

// Load reminders from disk
export async function loadReminders(): Promise<PersonalReminder[]> {
  try {
    const content = await fs.readFile(REMINDERS_FILE, 'utf-8');
    const reminders = JSON.parse(content);

    // Convert date strings back to Date objects
    return reminders.map((r: any) => ({
      ...r,
      remindAt: new Date(r.remindAt),
      createdAt: new Date(r.createdAt)
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
  type: 'scheduled' | 'adhoc' = 'adhoc'
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
    type
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
  return reminders.filter(r => !r.triggered && r.remindAt <= now);
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