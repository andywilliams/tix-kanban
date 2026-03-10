import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { getAllTasks } from './storage.js';
import { Task } from '../client/types/index.js';
import { spawn } from 'child_process';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const RULES_FILE = path.join(STORAGE_DIR, 'reminder-rules.json');
const COOLDOWN_FILE = path.join(STORAGE_DIR, 'reminder-cooldowns.json');
const HISTORY_FILE = path.join(STORAGE_DIR, 'reminder-history.json');

export interface ReminderRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  target: 'task' | 'pr' | 'backlog';
  conditions: RuleCondition[];
  action: RuleAction;
  cooldown: string; // e.g. "24h", "12h", "7d"
  createdAt: Date;
  updatedAt: Date;
  isBuiltIn?: boolean;
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains';
  value: any;
}

export interface RuleAction {
  type: 'slack' | 'console';
  message: string; // Template with placeholders like {id}, {title}, {age}
  channel?: string; // For Slack
}

interface CooldownEntry {
  ruleId: string;
  entityId: string; // task/pr id or "backlog"
  lastTriggered: Date;
}

interface HistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  entityId: string;
  entityTitle?: string;
  message: string;
  triggeredAt: Date;
  action: RuleAction;
}

// Built-in rule templates
const BUILT_IN_RULES: ReminderRule[] = [
  {
    id: 'builtin-stale-review',
    name: 'Stale Review',
    description: 'Alert when tasks stay in review for too long',
    enabled: true,
    target: 'task',
    conditions: [
      { field: 'status', operator: 'equals', value: 'review' },
      { field: 'age', operator: 'greater_than', value: '5d' }
    ],
    action: {
      type: 'slack',
      message: 'Task {id} "{title}" has been in review for {age} days'
    },
    cooldown: '24h',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBuiltIn: true
  },
  {
    id: 'builtin-stale-pr',
    name: 'Stale PR',
    description: 'Remind about PRs with no activity',
    enabled: true,
    target: 'pr',
    conditions: [
      { field: 'prAge', operator: 'greater_than', value: '3d' },
      { field: 'prApproved', operator: 'equals', value: false }
    ],
    action: {
      type: 'slack',
      message: 'PR {prUrl} on task {id} "{title}" has no activity for {prAge} days'
    },
    cooldown: '24h',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBuiltIn: true
  },
  {
    id: 'builtin-backlog-overflow',
    name: 'Backlog Overflow',
    description: 'Notify when backlog grows too large',
    enabled: true,
    target: 'backlog',
    conditions: [
      { field: 'count', operator: 'greater_than', value: 10 }
    ],
    action: {
      type: 'slack',
      message: 'Backlog has grown to {count} items'
    },
    cooldown: '12h',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBuiltIn: true
  },
  {
    id: 'builtin-blocked-task',
    name: 'Blocked Task',
    description: 'Alert about blocked tasks',
    enabled: true,
    target: 'task',
    conditions: [
      { field: 'tags', operator: 'contains', value: 'blocked' },
      { field: 'age', operator: 'greater_than', value: '2d' }
    ],
    action: {
      type: 'slack',
      message: 'Task {id} "{title}" has been blocked for {age} days'
    },
    cooldown: '24h',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBuiltIn: true
  },
  {
    id: 'builtin-unresolved-comments',
    name: 'Unresolved PR Comments',
    description: 'PRs with unresolved review comments',
    enabled: true,
    target: 'pr',
    conditions: [
      { field: 'prUnresolvedComments', operator: 'greater_than', value: 0 },
      { field: 'prAge', operator: 'greater_than', value: '1d' }
    ],
    action: {
      type: 'slack',
      message: 'PR {prUrl} has {prUnresolvedComments} unresolved comments for {prAge} days'
    },
    cooldown: '24h',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBuiltIn: true
  }
];

// Load rules from disk
export async function loadRules(): Promise<ReminderRule[]> {
  try {
    if (!existsSync(RULES_FILE)) {
      // Initialize with built-in rules
      await saveRules(BUILT_IN_RULES);
      return BUILT_IN_RULES;
    }

    const content = await fs.readFile(RULES_FILE, 'utf-8');
    const rules = JSON.parse(content);

    // Convert date strings back to Date objects
    return rules.map((rule: any) => ({
      ...rule,
      createdAt: new Date(rule.createdAt),
      updatedAt: new Date(rule.updatedAt)
    }));
  } catch (error) {
    console.error('Failed to load reminder rules:', error);
    return BUILT_IN_RULES;
  }
}

// Save rules to disk
async function saveRules(rules: ReminderRule[]): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(RULES_FILE, JSON.stringify(rules, null, 2));
}

// Load cooldown state
async function loadCooldowns(): Promise<CooldownEntry[]> {
  try {
    if (!existsSync(COOLDOWN_FILE)) {
      return [];
    }
    const content = await fs.readFile(COOLDOWN_FILE, 'utf-8');
    const cooldowns = JSON.parse(content);

    // Convert date strings to Date objects
    return cooldowns.map((c: any) => ({
      ...c,
      lastTriggered: new Date(c.lastTriggered)
    }));
  } catch (error) {
    console.error('Failed to load cooldowns:', error);
    return [];
  }
}

// Save cooldown state
async function saveCooldowns(cooldowns: CooldownEntry[]): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
}

// Load history
async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    if (!existsSync(HISTORY_FILE)) {
      return [];
    }
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(content);

    return history.map((h: any) => ({
      ...h,
      triggeredAt: new Date(h.triggeredAt)
    }));
  } catch (error) {
    console.error('Failed to load history:', error);
    return [];
  }
}

// Save history
async function saveHistory(history: HistoryEntry[]): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  // Keep only last 1000 entries
  const trimmedHistory = history.slice(-1000);
  await fs.writeFile(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
}

// Parse duration string (e.g. "24h", "5d") to milliseconds
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdw])$/);
  if (!match) {
    console.warn(`Invalid duration format: ${duration}, defaulting to 24h`);
    return 24 * 60 * 60 * 1000;
  }

  const [, num, unit] = match;
  const value = parseInt(num, 10);

  switch (unit) {
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}


// Get PR data from task links
function getPRData(task: Task): { url?: string; age?: number; approved?: boolean; unresolvedComments?: number } {
  const prLink = task.links?.find(link => link.type === 'pr');
  if (!prLink) return {};

  // For this implementation, we'll use basic heuristics
  // In a real implementation, you'd fetch actual PR data from GitHub API
  return {
    url: prLink.url,
    age: task.updatedAt ? Math.floor((Date.now() - task.updatedAt.getTime()) / (24 * 60 * 60 * 1000)) : 0,
    approved: false, // Would need GitHub API
    unresolvedComments: 0 // Would need GitHub API
  };
}

// Evaluate a single condition
function evaluateCondition(condition: RuleCondition, data: any): boolean {
  const fieldValue = data[condition.field];
  const conditionValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return fieldValue == conditionValue;

    case 'not_equals':
      return fieldValue != conditionValue;

    case 'greater_than':
      // Handle duration comparisons for age fields
      if (typeof conditionValue === 'string' && conditionValue.match(/^\d+[hdw]$/)) {
        const durationMs = parseDuration(conditionValue);
        const ageDays = durationMs / (24 * 60 * 60 * 1000);
        return fieldValue > ageDays;
      }
      return fieldValue > conditionValue;

    case 'less_than':
      if (typeof conditionValue === 'string' && conditionValue.match(/^\d+[hdw]$/)) {
        const durationMs = parseDuration(conditionValue);
        const ageDays = durationMs / (24 * 60 * 60 * 1000);
        return fieldValue < ageDays;
      }
      return fieldValue < conditionValue;

    case 'contains':
      if (fieldValue == null) return false;
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(conditionValue);
      }
      return String(fieldValue).includes(String(conditionValue));

    case 'not_contains':
      if (fieldValue == null) return true;
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(conditionValue);
      }
      return !String(fieldValue).includes(String(conditionValue));

    default:
      return false;
  }
}

// Check if cooldown has expired
function isCooldownExpired(cooldowns: CooldownEntry[], ruleId: string, entityId: string, cooldownDuration: string): boolean {
  const entry = cooldowns.find(c => c.ruleId === ruleId && c.entityId === entityId);
  if (!entry) return true;

  const cooldownMs = parseDuration(cooldownDuration);
  const elapsed = Date.now() - entry.lastTriggered.getTime();

  return elapsed >= cooldownMs;
}

// Send notification based on action type
async function sendNotification(action: RuleAction, message: string): Promise<void> {
  if (action.type === 'console') {
    console.log(`🔔 Reminder: ${message}`);
  } else if (action.type === 'slack') {
    // Use slx command to send Slack message
    // Format: slx send "message" or slx send "#channel" "message"
    const args = action.channel
      ? ['send', action.channel, message]
      : ['send', message];

    return new Promise((resolve) => {
      const slx = spawn('slx', args, { stdio: 'pipe' });

      slx.on('error', (err) => {
        console.error('Failed to send Slack notification:', err);
        resolve(); // Don't fail the whole process
      });

      slx.on('close', (code) => {
        if (code !== 0) {
          console.error(`slx exited with code ${code}`);
        }
        resolve();
      });
    });
  }
}

// Interpolate message template
function interpolateMessage(template: string, data: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (data[key] === undefined) return match;
    // Round numeric values for display (e.g. age in days)
    if (typeof data[key] === 'number') return String(Math.round(data[key]));
    return String(data[key]);
  });
}

// Evaluate rules against current state
export async function evaluateReminderRules(dryRun: boolean = false): Promise<void> {
  const rules = await loadRules();
  const cooldowns = await loadCooldowns();
  const history = await loadHistory();
  const tasks = await getAllTasks();

  const enabledRules = rules.filter(r => r.enabled);
  const newCooldowns = [...cooldowns];
  const newHistory = [...history];

  for (const rule of enabledRules) {
    try {
      if (rule.target === 'task') {
        // Evaluate against each task
        for (const task of tasks) {
          // Use last status change timestamp for age (time in current status), fallback to createdAt
          const lastStatusChange = task.activity
            ?.filter((a: any) => a.type === 'status_change')
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
          const ageBaseTime = lastStatusChange ? new Date(lastStatusChange.timestamp).getTime() : (task.createdAt ? new Date(task.createdAt).getTime() : Date.now());
          const age = (Date.now() - ageBaseTime) / (24 * 60 * 60 * 1000);
          const prData = getPRData(task);

          const data = {
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            tags: task.tags,
            age,
            prUrl: prData.url,
            prAge: prData.age,
            prApproved: prData.approved,
            prUnresolvedComments: prData.unresolvedComments
          };

          // Check all conditions
          const allConditionsMet = rule.conditions.every(c => evaluateCondition(c, data));

          if (allConditionsMet && isCooldownExpired(newCooldowns, rule.id, task.id, rule.cooldown)) {
            const message = interpolateMessage(rule.action.message, data);

            if (dryRun) {
              console.log(`[DRY RUN] Would trigger: ${rule.name} for task ${task.id}`);
              console.log(`  Message: ${message}`);
            } else {
              await sendNotification(rule.action, message);

              // Update cooldown
              const cooldownIndex = newCooldowns.findIndex(c => c.ruleId === rule.id && c.entityId === task.id);
              if (cooldownIndex >= 0) {
                newCooldowns[cooldownIndex].lastTriggered = new Date();
              } else {
                newCooldowns.push({
                  ruleId: rule.id,
                  entityId: task.id,
                  lastTriggered: new Date()
                });
              }

              // Add to history
              newHistory.push({
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                ruleId: rule.id,
                ruleName: rule.name,
                entityId: task.id,
                entityTitle: task.title,
                message,
                triggeredAt: new Date(),
                action: rule.action
              });
            }
          }
        }
      } else if (rule.target === 'pr') {
        // Evaluate PRs from tasks
        const tasksWithPRs = tasks.filter(t => t.links?.some(l => l.type === 'pr'));

        for (const task of tasksWithPRs) {
          const prData = getPRData(task);
          if (!prData.url) continue;

          const data = {
            id: task.id,
            title: task.title,
            prUrl: prData.url,
            prAge: prData.age || 0,
            prApproved: prData.approved || false,
            prUnresolvedComments: prData.unresolvedComments || 0
          };

          const allConditionsMet = rule.conditions.every(c => evaluateCondition(c, data));

          if (allConditionsMet && isCooldownExpired(newCooldowns, rule.id, `pr-${task.id}`, rule.cooldown)) {
            const message = interpolateMessage(rule.action.message, data);

            if (dryRun) {
              console.log(`[DRY RUN] Would trigger: ${rule.name} for PR on task ${task.id}`);
              console.log(`  Message: ${message}`);
            } else {
              await sendNotification(rule.action, message);

              // Update cooldown
              const cooldownIndex = newCooldowns.findIndex(c => c.ruleId === rule.id && c.entityId === `pr-${task.id}`);
              if (cooldownIndex >= 0) {
                newCooldowns[cooldownIndex].lastTriggered = new Date();
              } else {
                newCooldowns.push({
                  ruleId: rule.id,
                  entityId: `pr-${task.id}`,
                  lastTriggered: new Date()
                });
              }

              // Add to history
              newHistory.push({
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                ruleId: rule.id,
                ruleName: rule.name,
                entityId: `pr-${task.id}`,
                entityTitle: task.title,
                message,
                triggeredAt: new Date(),
                action: rule.action
              });
            }
          }
        }
      } else if (rule.target === 'backlog') {
        // Evaluate backlog as a whole
        const backlogTasks = tasks.filter(t => t.status === 'backlog');
        const data = {
          count: backlogTasks.length
        };

        const allConditionsMet = rule.conditions.every(c => evaluateCondition(c, data));

        if (allConditionsMet && isCooldownExpired(newCooldowns, rule.id, 'backlog', rule.cooldown)) {
          const message = interpolateMessage(rule.action.message, data);

          if (dryRun) {
            console.log(`[DRY RUN] Would trigger: ${rule.name} for backlog`);
            console.log(`  Message: ${message}`);
          } else {
            await sendNotification(rule.action, message);

            // Update cooldown
            const cooldownIndex = newCooldowns.findIndex(c => c.ruleId === rule.id && c.entityId === 'backlog');
            if (cooldownIndex >= 0) {
              newCooldowns[cooldownIndex].lastTriggered = new Date();
            } else {
              newCooldowns.push({
                ruleId: rule.id,
                entityId: 'backlog',
                lastTriggered: new Date()
              });
            }

            // Add to history
            newHistory.push({
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              ruleId: rule.id,
              ruleName: rule.name,
              entityId: 'backlog',
              message,
              triggeredAt: new Date(),
              action: rule.action
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error evaluating rule ${rule.name}:`, error);
      // Continue with other rules
    }
  }

  if (!dryRun) {
    // Save updated state
    await saveCooldowns(newCooldowns);
    await saveHistory(newHistory);
  }
}

// Add a custom rule
export async function addRule(rule: Omit<ReminderRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ReminderRule> {
  const rules = await loadRules();

  const newRule: ReminderRule = {
    ...rule,
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  rules.push(newRule);
  await saveRules(rules);

  return newRule;
}

// Update a rule
export async function updateRule(ruleId: string, updates: Partial<ReminderRule>): Promise<void> {
  const rules = await loadRules();
  const index = rules.findIndex(r => r.id === ruleId);

  if (index === -1) {
    throw new Error(`Rule ${ruleId} not found`);
  }

  // Don't allow updating built-in rules except for enabling/disabling
  if (rules[index].isBuiltIn && Object.keys(updates).some(k => k !== 'enabled')) {
    throw new Error('Cannot modify built-in rules');
  }

  // Preserve id and isBuiltIn flags to prevent client-side tampering
  const { id: _, isBuiltIn: __, createdAt: ___, ...allowedUpdates } = updates;

  rules[index] = {
    ...rules[index],
    ...allowedUpdates,
    updatedAt: new Date()
  };

  await saveRules(rules);
}

// Delete a rule
export async function deleteRule(ruleId: string): Promise<void> {
  const rules = await loadRules();
  const rule = rules.find(r => r.id === ruleId);

  if (!rule) {
    throw new Error(`Rule ${ruleId} not found`);
  }

  if (rule.isBuiltIn) {
    throw new Error('Cannot delete built-in rules');
  }

  const filtered = rules.filter(r => r.id !== ruleId);
  await saveRules(filtered);
}

// Get all rules
export async function getRules(): Promise<ReminderRule[]> {
  return await loadRules();
}

// Get reminder history
export async function getReminderHistory(): Promise<HistoryEntry[]> {
  return await loadHistory();
}

// Clear all cooldowns
export async function clearCooldowns(): Promise<void> {
  await saveCooldowns([]);
}