/**
 * Collaboration Budget System
 *
 * Tracks and enforces token/cost budgets across:
 * - Global daily limit ($10/day)
 * - Per-ticket limit ($2/ticket)
 * - Per-persona limit ($0.50/persona)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const BUDGET_DIR = path.join(os.homedir(), '.tix-kanban', 'budgets');
const DAILY_BUDGET_FILE = path.join(BUDGET_DIR, 'daily-budget.json');
const MONTHLY_BUDGET_FILE = path.join(BUDGET_DIR, 'monthly-budget.json');

// File lock to prevent concurrent read-modify-write races on budget file
let budgetLock: Promise<void> = Promise.resolve();

function withBudgetLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = budgetLock;
  const next = prev.then(fn, fn);
  budgetLock = next.then(() => {}, () => {});
  return next;
}

// Budget limits (in USD)
export const BUDGET_LIMITS = {
  globalDaily: 10.0,
  perTicket: 2.0,
  perPersona: 0.5,
};

// Token costs per model (approximate, in USD per 1M tokens)
const MODEL_COSTS = {
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  default: { input: 3.0, output: 15.0 },
};
export const DEFAULT_COST_MODEL = 'default';

export interface BudgetEntry {
  timestamp: Date;
  taskId?: string;
  personaId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface DailyBudget {
  date: string;
  entries: BudgetEntry[];
  totalCost: number;
  byTask: Record<string, number>;
  byPersona: Record<string, number>;
}

export interface MonthlyPersonaBudget {
  month: string; // "2026-03"
  personaId: string;
  tokenLimit: number; // e.g. 10_000_000
  tokensUsed: number;
  paused: boolean;
}

export interface MonthlyBudgetData {
  month: string;
  personas: Record<string, MonthlyPersonaBudget>;
}

export async function initializeBudgetStorage(): Promise<void> {
  await fs.mkdir(BUDGET_DIR, { recursive: true });
}

async function getTodaysBudget(): Promise<DailyBudget> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = await fs.readFile(DAILY_BUDGET_FILE, 'utf8');
    const budget: DailyBudget = JSON.parse(data);
    if (budget.date !== today) {
      // Archive previous day's data before starting fresh (fix: rollover data loss)
      if (budget.totalCost > 0 || budget.entries.length > 0) {
        const archivePath = path.join(BUDGET_DIR, `daily-budget-${budget.date}.json`);
        await fs.writeFile(archivePath, JSON.stringify(budget, null, 2));
        console.log(`📦 Archived budget for ${budget.date}: $${budget.totalCost.toFixed(2)}`);
      }
      return { date: today, entries: [], totalCost: 0, byTask: {}, byPersona: {} };
    }
    budget.entries.forEach(entry => { entry.timestamp = new Date(entry.timestamp); });
    return budget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { date: today, entries: [], totalCost: 0, byTask: {}, byPersona: {} };
    }
    throw error;
  }
}

async function saveBudget(budget: DailyBudget): Promise<void> {
  await fs.writeFile(DAILY_BUDGET_FILE, JSON.stringify(budget, null, 2));
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model as keyof typeof MODEL_COSTS] || MODEL_COSTS.default;
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

export async function recordUsage(
  personaId: string, model: string, inputTokens: number, outputTokens: number, taskId?: string
): Promise<void> {
  return withBudgetLock(async () => {
    const budget = await getTodaysBudget();
    const cost = calculateCost(model, inputTokens, outputTokens);
    budget.entries.push({ timestamp: new Date(), taskId, personaId, model, inputTokens, outputTokens, cost });
    budget.totalCost += cost;
    budget.byPersona[personaId] = (budget.byPersona[personaId] || 0) + cost;
    if (taskId) budget.byTask[taskId] = (budget.byTask[taskId] || 0) + cost;
    await saveBudget(budget);
    console.log(`💰 Budget: ${personaId} used $${cost.toFixed(4)} (${inputTokens}/${outputTokens} tokens)`);
  });
}

/**
 * Atomically check budget and record usage in a single lock acquisition.
 * Prevents the TOCTOU race between separate checkBudget and recordUsage calls.
 */
export async function checkAndRecordUsage(
  personaId: string, model: string, inputTokens: number, outputTokens: number, taskId?: string,
  options: { dryRun?: boolean } = {}
): Promise<{ allowed: boolean; reason?: string }> {
  return withBudgetLock(async () => {
    const budget = await getTodaysBudget();
    const resolvedModel = model || DEFAULT_COST_MODEL;
    const cost = calculateCost(resolvedModel, inputTokens, outputTokens);
    const previousTotalCost = budget.totalCost;
    const previousPersonaCost = budget.byPersona[personaId] || 0;
    const previousTaskCost = taskId ? (budget.byTask[taskId] || 0) : 0;

    // Dry-run: just check limits, don't record usage
    if (options.dryRun) {
      if (previousTotalCost + cost > BUDGET_LIMITS.globalDaily) {
        return { allowed: false, reason: `Global daily budget exceeded ($${previousTotalCost.toFixed(2)} / $${BUDGET_LIMITS.globalDaily})` };
      }
      if (previousPersonaCost + cost > BUDGET_LIMITS.perPersona) {
        return { allowed: false, reason: `Persona budget exceeded for ${personaId} ($${previousPersonaCost.toFixed(2)} / $${BUDGET_LIMITS.perPersona})` };
      }
      if (taskId && previousTaskCost + cost > BUDGET_LIMITS.perTicket) {
        return { allowed: false, reason: `Task budget exceeded for ${taskId} ($${previousTaskCost.toFixed(2)} / $${BUDGET_LIMITS.perTicket})` };
      }
      return { allowed: true };
    }

    // Always record usage first: spend already occurred once we have token counts.
    budget.entries.push({ timestamp: new Date(), taskId, personaId, model: resolvedModel, inputTokens, outputTokens, cost });
    budget.totalCost += cost;
    budget.byPersona[personaId] = (budget.byPersona[personaId] || 0) + cost;
    if (taskId) budget.byTask[taskId] = (budget.byTask[taskId] || 0) + cost;
    await saveBudget(budget);
    console.log(`💰 Budget: ${personaId} used $${cost.toFixed(4)} (${inputTokens}/${outputTokens} tokens)`);

    // Evaluate limits after recording so overages still include incurred usage.
    if (budget.totalCost > BUDGET_LIMITS.globalDaily) {
      return { allowed: false, reason: `Global daily budget exceeded ($${budget.totalCost.toFixed(2)} / $${BUDGET_LIMITS.globalDaily})` };
    }
    if (budget.byPersona[personaId] > BUDGET_LIMITS.perPersona) {
      return { allowed: false, reason: `Persona budget exceeded for ${personaId} ($${budget.byPersona[personaId].toFixed(2)} / $${BUDGET_LIMITS.perPersona})` };
    }
    if (taskId && budget.byTask[taskId] > BUDGET_LIMITS.perTicket) {
      return { allowed: false, reason: `Task budget exceeded for ${taskId} ($${budget.byTask[taskId].toFixed(2)} / $${BUDGET_LIMITS.perTicket})` };
    }
    return { allowed: true };
  });
}

export async function getBudgetStatus() {
  return withBudgetLock(async () => {
  const budget = await getTodaysBudget();
  const byTask: Record<string, { cost: number; remaining: number }> = {};
  for (const [taskId, cost] of Object.entries(budget.byTask)) {
    byTask[taskId] = { cost, remaining: BUDGET_LIMITS.perTicket - cost };
  }
  const byPersona: Record<string, { cost: number; remaining: number }> = {};
  for (const [personaId, cost] of Object.entries(budget.byPersona)) {
    byPersona[personaId] = { cost, remaining: BUDGET_LIMITS.perPersona - cost };
  }
  return {
    date: budget.date,
    totalCost: budget.totalCost,
    globalRemaining: BUDGET_LIMITS.globalDaily - budget.totalCost,
    byTask,
    byPersona,
  };
  }); // end withBudgetLock
}

export async function archiveTodaysBudget(): Promise<void> {
  return withBudgetLock(async () => {
    const budget = await getTodaysBudget();
    await fs.writeFile(path.join(BUDGET_DIR, `daily-budget-${budget.date}.json`), JSON.stringify(budget, null, 2));
    console.log(`📦 Archived budget for ${budget.date}: $${budget.totalCost.toFixed(2)}`);
  });
}

// Monthly budget tracking functions

async function getMonthlyBudget(): Promise<MonthlyBudgetData> {
  const currentMonth = new Date().toISOString().substring(0, 7); // "2026-03"
  try {
    const data = await fs.readFile(MONTHLY_BUDGET_FILE, 'utf8');
    const budget: MonthlyBudgetData = JSON.parse(data);
    
    // Reset if new month
    if (budget.month !== currentMonth) {
      console.log(`📅 New month detected (${currentMonth}), resetting monthly budgets`);
      // Archive previous month's data
      if (Object.keys(budget.personas).length > 0) {
        const archivePath = path.join(BUDGET_DIR, `monthly-budget-${budget.month}.json`);
        await fs.writeFile(archivePath, JSON.stringify(budget, null, 2));
        console.log(`📦 Archived monthly budget for ${budget.month}`);
      }
      return { month: currentMonth, personas: {} };
    }
    return budget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { month: currentMonth, personas: {} };
    }
    throw error;
  }
}

async function saveMonthlyBudget(budget: MonthlyBudgetData): Promise<void> {
  await fs.writeFile(MONTHLY_BUDGET_FILE, JSON.stringify(budget, null, 2));
}

export async function recordTokenUsage(
  personaId: string,
  inputTokens: number,
  outputTokens: number,
  tokenLimit?: number
): Promise<void> {
  return withBudgetLock(async () => {
    const budget = await getMonthlyBudget();
    const totalTokens = inputTokens + outputTokens;
    
    // Initialize persona budget if not exists
    if (!budget.personas[personaId]) {
      budget.personas[personaId] = {
        month: budget.month,
        personaId,
        tokenLimit: tokenLimit || 0, // 0 = unlimited
        tokensUsed: 0,
        paused: false,
      };
    }
    
    const personaBudget = budget.personas[personaId];
    personaBudget.tokensUsed += totalTokens;
    
    // Update token limit if provided
    if (tokenLimit !== undefined) {
      personaBudget.tokenLimit = tokenLimit;
    }
    
    // Check if budget exceeded
    if (personaBudget.tokenLimit > 0 && personaBudget.tokensUsed >= personaBudget.tokenLimit) {
      if (!personaBudget.paused) {
        personaBudget.paused = true;
        console.warn(`⚠️ ${personaId} has exceeded its monthly token budget (${personaBudget.tokensUsed.toLocaleString()} / ${personaBudget.tokenLimit.toLocaleString()} tokens)`);
      }
    } else if (personaBudget.paused && personaBudget.tokenLimit > 0 && personaBudget.tokensUsed < personaBudget.tokenLimit) {
      // Resume persona if usage is now below the budget limit (e.g., admin increased limit)
      personaBudget.paused = false;
      console.log(`✅ ${personaId} has been resumed - usage (${personaBudget.tokensUsed.toLocaleString()}) is below updated limit (${personaBudget.tokenLimit.toLocaleString()})`);
    }
    
    await saveMonthlyBudget(budget);
    console.log(`🪙 Token usage: ${personaId} used ${totalTokens.toLocaleString()} tokens (total: ${personaBudget.tokensUsed.toLocaleString()})`);
  });
}

export async function getPersonaBudgetStatus(personaId: string): Promise<{
  tokensUsed: number;
  tokenLimit: number;
  percentage: number;
  paused: boolean;
  month: string;
} | null> {
  return withBudgetLock(async () => {
    const budget = await getMonthlyBudget();
    const personaBudget = budget.personas[personaId];
    
    if (!personaBudget) {
      return null;
    }
    
    const percentage = personaBudget.tokenLimit > 0 
      ? (personaBudget.tokensUsed / personaBudget.tokenLimit) * 100 
      : 0;
    
    return {
      tokensUsed: personaBudget.tokensUsed,
      tokenLimit: personaBudget.tokenLimit,
      percentage,
      paused: personaBudget.paused,
      month: personaBudget.month,
    };
  });
}

export async function isPersonaPaused(personaId: string): Promise<boolean> {
  return withBudgetLock(async () => {
    const budget = await getMonthlyBudget();
    return budget.personas[personaId]?.paused || false;
  });
}

export async function resetMonthlyBudgets(): Promise<void> {
  return withBudgetLock(async () => {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const budget = await getMonthlyBudget();
    
    // Archive current month
    if (budget.month !== currentMonth && Object.keys(budget.personas).length > 0) {
      const archivePath = path.join(BUDGET_DIR, `monthly-budget-${budget.month}.json`);
      await fs.writeFile(archivePath, JSON.stringify(budget, null, 2));
      console.log(`📦 Archived monthly budget for ${budget.month}`);
    }
    
    // Reset to new month
    const newBudget: MonthlyBudgetData = { month: currentMonth, personas: {} };
    await saveMonthlyBudget(newBudget);
    console.log(`🔄 Monthly budgets reset for ${currentMonth}`);
  });
}
