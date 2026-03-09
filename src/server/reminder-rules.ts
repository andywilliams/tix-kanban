/**
 * Smart Reminder Rules Engine
 *
 * Implements a lightweight rules engine for automatic reminders based on board state.
 * Rules evaluate against current tasks and PRs during scheduled checks.
 * Includes cooldown management to prevent notification spam.
 */

import { Task } from '../client/types/index.js';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const STORAGE_DIR = path.join(os.homedir(), '.tix-kanban');
const REMINDERS_DIR = path.join(STORAGE_DIR, 'reminders');
const RULES_FILE = path.join(REMINDERS_DIR, 'rules.json');
const COOLDOWNS_FILE = path.join(REMINDERS_DIR, 'cooldowns.json');
const HISTORY_FILE = path.join(REMINDERS_DIR, 'history.json');

// Rule condition operators
type Operator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'contains' | 'not_contains' | 'in' | 'not_in';

// What entity types can be targeted
type RuleTarget = 'ticket' | 'pr' | 'backlog';

// Rule condition definition
interface RuleCondition {
  field: string;           // e.g., 'status', 'age', 'unresolved_comments'
  operator: Operator;
  value: string | number | string[];
}

// Rule action definition
interface RuleAction {
  type: 'slack' | 'console';  // Where to send notification
  channel?: string;            // Slack channel (if type is slack)
  template: string;            // Message template with variables
}

// Complete rule definition
export interface ReminderRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  target: RuleTarget;
  conditions: RuleCondition[];  // All conditions must match (AND logic)
  action: RuleAction;
  cooldown: string;             // Duration string like '24h' or '30m'
  createdAt: Date;
  updatedAt: Date;
  isBuiltin?: boolean;          // Built-in templates can't be deleted
}

// Cooldown tracking per rule per entity
interface CooldownEntry {
  ruleId: string;
  entityId: string;     // task ID or PR number
  lastTriggered: Date;
}

// History entry for triggered reminders
interface ReminderHistory {
  id: string;
  ruleId: string;
  ruleName: string;
  entityId: string;
  entityTitle: string;
  message: string;
  triggeredAt: Date;
}

// PR data structure (from cache or API)
interface PRData {
  number: number;
  title: string;
  state: string;
  author?: string;
  repo: string;
  updatedAt?: Date;
  createdAt?: Date;
  approved?: boolean;
  changesRequested?: boolean;
  unresolvedComments?: number;
  headRefName?: string;
}

// Parse duration string to milliseconds
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdmw])$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default to 24h

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

// Calculate age in days
function ageInDays(date: Date | string): number {
  const then = new Date(date);
  const now = new Date();
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
}

// Evaluate a single condition against an entity
function evaluateCondition(condition: RuleCondition, entity: any): boolean {
  const { field, operator, value } = condition;
  let fieldValue = entity[field];

  // Special field handling
  if (field === 'age' && entity.createdAt) {
    fieldValue = ageInDays(entity.createdAt);
  } else if (field === 'days_since_update' && entity.updatedAt) {
    fieldValue = ageInDays(entity.updatedAt);
  } else if (field === 'days_in_status' && entity.statusChangedAt) {
    fieldValue = ageInDays(entity.statusChangedAt);
  }

  // Operator evaluation
  switch (operator) {
    case '=': return fieldValue == value;
    case '!=': return fieldValue != value;
    case '>': return Number(fieldValue) > Number(value);
    case '<': return Number(fieldValue) < Number(value);
    case '>=': return Number(fieldValue) >= Number(value);
    case '<=': return Number(fieldValue) <= Number(value);
    case 'contains':
      return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'not_contains':
      return !String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
    case 'in':
      return Array.isArray(value) ? value.includes(fieldValue) : false;
    case 'not_in':
      return Array.isArray(value) ? !value.includes(fieldValue) : true;
    default:
      return false;
  }
}

// Evaluate all conditions (AND logic)
function evaluateRule(rule: ReminderRule, entity: any): boolean {
  return rule.conditions.every(condition => evaluateCondition(condition, entity));
}

// Replace template variables with entity values
function interpolateTemplate(template: string, entity: any): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key === 'age' && entity.createdAt) {
      return Math.floor(ageInDays(entity.createdAt)) + ' days';
    }
    if (key === 'days_since_update' && entity.updatedAt) {
      return Math.floor(ageInDays(entity.updatedAt)) + ' days';
    }
    return entity[key] || match;
  });
}

// Check if an entity is in cooldown for a rule
async function isInCooldown(ruleId: string, entityId: string, cooldownMs: number): Promise<boolean> {
  try {
    const cooldowns = await loadCooldowns();
    const entry = cooldowns.find(c =>
      c.ruleId === ruleId && c.entityId === entityId
    );

    if (!entry) return false;

    const elapsed = Date.now() - new Date(entry.lastTriggered).getTime();
    return elapsed < cooldownMs;
  } catch {
    return false;
  }
}

// Update cooldown for a rule/entity pair
async function updateCooldown(ruleId: string, entityId: string): Promise<void> {
  try {
    const cooldowns = await loadCooldowns();
    const index = cooldowns.findIndex(c =>
      c.ruleId === ruleId && c.entityId === entityId
    );

    const entry: CooldownEntry = {
      ruleId,
      entityId,
      lastTriggered: new Date()
    };

    if (index >= 0) {
      cooldowns[index] = entry;
    } else {
      cooldowns.push(entry);
    }

    await saveCooldowns(cooldowns);
  } catch (error) {
    console.error('Failed to update cooldown:', error);
  }
}

// Add to reminder history
async function addToHistory(rule: ReminderRule, entity: any, message: string): Promise<void> {
  try {
    const history = await loadHistory();
    const entry: ReminderHistory = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      entityId: entity.id || entity.number?.toString() || 'unknown',
      entityTitle: entity.title || 'Unknown',
      message,
      triggeredAt: new Date()
    };

    history.push(entry);

    // Keep only last 1000 entries
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }

    await saveHistory(history);
  } catch (error) {
    console.error('Failed to add to history:', error);
  }
}

// Send notification via Slack
async function sendSlackNotification(channel: string, message: string): Promise<void> {
  try {
    // Use slx command to send Slack message (safe from shell injection)
    execFileSync('slx', ['send', channel, message], {
      encoding: 'utf8',
      timeout: 10000
    });
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
    // Fall back to console if Slack fails
    console.log(`[Reminder] ${message}`);
  }
}

// Send notification based on action type
async function sendNotification(action: RuleAction, message: string): Promise<void> {
  if (action.type === 'slack' && action.channel) {
    await sendSlackNotification(action.channel, message);
  } else {
    console.log(`[Reminder] ${message}`);
  }
}

// Load rules from storage
async function loadRules(): Promise<ReminderRule[]> {
  try {
    await fs.mkdir(REMINDERS_DIR, { recursive: true });
    const content = await fs.readFile(RULES_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Initialize with built-in templates if no rules exist
      const builtinRules = getBuiltinRules();
      await saveRules(builtinRules);
      return builtinRules;
    }
    console.error('Failed to load reminder rules:', error);
    return [];
  }
}

// Save rules to storage
async function saveRules(rules: ReminderRule[]): Promise<void> {
  await fs.mkdir(REMINDERS_DIR, { recursive: true });
  await fs.writeFile(RULES_FILE, JSON.stringify(rules, null, 2));
}

// Load cooldowns from storage
async function loadCooldowns(): Promise<CooldownEntry[]> {
  try {
    const content = await fs.readFile(COOLDOWNS_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// Save cooldowns to storage
async function saveCooldowns(cooldowns: CooldownEntry[]): Promise<void> {
  await fs.mkdir(REMINDERS_DIR, { recursive: true });
  await fs.writeFile(COOLDOWNS_FILE, JSON.stringify(cooldowns, null, 2));
}

// Load history from storage
async function loadHistory(): Promise<ReminderHistory[]> {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// Save history to storage
async function saveHistory(history: ReminderHistory[]): Promise<void> {
  await fs.mkdir(REMINDERS_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Load cached task data
async function loadTasksFromCache(): Promise<Task[]> {
  try {
    const summaryPath = path.join(STORAGE_DIR, '_summary.json');
    const content = await fs.readFile(summaryPath, 'utf8');
    const summaries = JSON.parse(content);

    // For reminder evaluation, summary data is sufficient
    return summaries.map((summary: any) => ({
      ...summary,
      createdAt: new Date(summary.createdAt),
      updatedAt: new Date(summary.updatedAt)
    }));
  } catch (error) {
    console.error('Failed to load task cache:', error);
    return [];
  }
}

// Load PR data from cache/API
async function loadPRsFromCache(): Promise<PRData[]> {
  try {
    const prCachePath = path.join(STORAGE_DIR, 'pr-cache.json');
    const content = await fs.readFile(prCachePath, 'utf8');
    const cache = JSON.parse(content);

    const allPRs: PRData[] = [];
    for (const [repo, data] of Object.entries(cache)) {
      if (data && typeof data === 'object' && 'prs' in data) {
        const repoPRs = (data as any).prs || [];
        repoPRs.forEach((pr: any) => {
          allPRs.push({
            ...pr,
            repo,
            // Add computed fields if needed
            updatedAt: pr.updatedAt ? new Date(pr.updatedAt) : undefined,
            createdAt: pr.createdAt ? new Date(pr.createdAt) : undefined
          });
        });
      }
    }

    return allPRs;
  } catch (error) {
    console.error('Failed to load PR cache:', error);
    return [];
  }
}

// Get backlog count
async function getBacklogCount(tasks: Task[]): Promise<number> {
  return tasks.filter(t => t.status === 'backlog').length;
}

// Get built-in rule templates
export function getBuiltinRules(): ReminderRule[] {
  const now = new Date();

  return [
    {
      id: 'builtin_stale_review',
      name: 'Stale Review',
      description: 'Alert when tasks stay in review for more than 5 days',
      enabled: true,
      target: 'ticket',
      conditions: [
        { field: 'status', operator: '=', value: 'review' },
        { field: 'days_in_status', operator: '>', value: 5 }
      ],
      action: {
        type: 'console',
        template: 'Task "{title}" has been in review for {days_in_status}'
      },
      cooldown: '24h',
      createdAt: now,
      updatedAt: now,
      isBuiltin: true
    },
    {
      id: 'builtin_stale_pr',
      name: 'Stale PR',
      description: 'Remind about PRs with no activity for 3 days',
      enabled: true,
      target: 'pr',
      conditions: [
        { field: 'state', operator: '=', value: 'open' },
        { field: 'days_since_update', operator: '>', value: 3 },
        { field: 'approved', operator: '!=', value: 'true' }
      ],
      action: {
        type: 'console',
        template: 'PR #{number} "{title}" has no activity for {days_since_update}'
      },
      cooldown: '24h',
      createdAt: now,
      updatedAt: now,
      isBuiltin: true
    },
    {
      id: 'builtin_backlog_overflow',
      name: 'Backlog Overflow',
      description: 'Notify when backlog grows beyond 10 items',
      enabled: true,
      target: 'backlog',
      conditions: [
        { field: 'count', operator: '>', value: 10 }
      ],
      action: {
        type: 'console',
        template: 'Backlog has grown to {count} items'
      },
      cooldown: '12h',
      createdAt: now,
      updatedAt: now,
      isBuiltin: true
    },
    {
      id: 'builtin_blocked_ticket',
      name: 'Blocked Ticket',
      description: 'Alert about blocked tickets older than 2 days',
      enabled: true,
      target: 'ticket',
      conditions: [
        { field: 'tags', operator: 'contains', value: 'blocked' },
        { field: 'age', operator: '>', value: 2 }
      ],
      action: {
        type: 'console',
        template: 'Task "{title}" has been blocked for {age}'
      },
      cooldown: '24h',
      createdAt: now,
      updatedAt: now,
      isBuiltin: true
    },
    {
      id: 'builtin_unresolved_pr_comments',
      name: 'Unresolved PR Comments',
      description: 'Notify about PRs with unresolved comments older than 1 day',
      enabled: true,
      target: 'pr',
      conditions: [
        { field: 'state', operator: '=', value: 'open' },
        { field: 'unresolvedComments', operator: '>', value: 0 },
        { field: 'days_since_update', operator: '>', value: 1 }
      ],
      action: {
        type: 'console',
        template: 'PR #{number} has {unresolvedComments} unresolved comments'
      },
      cooldown: '24h',
      createdAt: now,
      updatedAt: now,
      isBuiltin: true
    }
  ];
}

// Main evaluation function
export async function evaluateReminderRules(options: { dryRun?: boolean } = {}): Promise<{
  rulesChecked: number;
  remindersTriggered: number;
  errors: string[];
}> {
  const results = {
    rulesChecked: 0,
    remindersTriggered: 0,
    errors: [] as string[]
  };

  try {
    // Load all data
    const rules = await loadRules();
    const enabledRules = rules.filter(r => r.enabled);
    results.rulesChecked = enabledRules.length;

    if (enabledRules.length === 0) {
      return results;
    }

    const tasks = await loadTasksFromCache();
    const prs = await loadPRsFromCache();
    const backlogCount = await getBacklogCount(tasks);

    // Evaluate each rule
    for (const rule of enabledRules) {
      try {
        const cooldownMs = parseDuration(rule.cooldown);

        if (rule.target === 'ticket') {
          // Evaluate against tasks
          for (const task of tasks) {
            if (evaluateRule(rule, task)) {
              const entityId = task.id;

              if (!await isInCooldown(rule.id, entityId, cooldownMs)) {
                const message = interpolateTemplate(rule.action.template, task);

                if (!options.dryRun) {
                  await sendNotification(rule.action, message);
                  await updateCooldown(rule.id, entityId);
                  await addToHistory(rule, task, message);
                }

                results.remindersTriggered++;

                if (options.dryRun) {
                  console.log(`[DRY RUN] Would trigger: ${message}`);
                }
              }
            }
          }
        } else if (rule.target === 'pr') {
          // Evaluate against PRs
          for (const pr of prs) {
            if (evaluateRule(rule, pr)) {
              const entityId = `${pr.repo}#${pr.number}`;

              if (!await isInCooldown(rule.id, entityId, cooldownMs)) {
                const message = interpolateTemplate(rule.action.template, pr);

                if (!options.dryRun) {
                  await sendNotification(rule.action, message);
                  await updateCooldown(rule.id, entityId);
                  await addToHistory(rule, pr, message);
                }

                results.remindersTriggered++;

                if (options.dryRun) {
                  console.log(`[DRY RUN] Would trigger: ${message}`);
                }
              }
            }
          }
        } else if (rule.target === 'backlog') {
          // Evaluate backlog as a whole
          const backlogEntity = { count: backlogCount, id: 'backlog' };

          if (evaluateRule(rule, backlogEntity)) {
            const entityId = 'backlog';

            if (!await isInCooldown(rule.id, entityId, cooldownMs)) {
              const message = interpolateTemplate(rule.action.template, backlogEntity);

              if (!options.dryRun) {
                await sendNotification(rule.action, message);
                await updateCooldown(rule.id, entityId);
                await addToHistory(rule, backlogEntity, message);
              }

              results.remindersTriggered++;

              if (options.dryRun) {
                console.log(`[DRY RUN] Would trigger: ${message}`);
              }
            }
          }
        }
      } catch (error) {
        const errorMsg = `Error evaluating rule "${rule.name}": ${error}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

  } catch (error) {
    results.errors.push(`Fatal error in reminder evaluation: ${error}`);
    console.error('Fatal error in reminder evaluation:', error);
  }

  return results;
}

// Export additional functions for API use
export {
  loadRules,
  saveRules,
  loadHistory,
  loadCooldowns,
  saveCooldowns,
  parseDuration
};