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

export async function initializeBudgetStorage(): Promise<void> {
  await fs.mkdir(BUDGET_DIR, { recursive: true });
}

async function getTodaysBudget(): Promise<DailyBudget> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = await fs.readFile(DAILY_BUDGET_FILE, 'utf8');
    const budget: DailyBudget = JSON.parse(data);
    if (budget.date !== today) {
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

export async function checkBudget(
  personaId: string, model: string, estimatedInputTokens: number, estimatedOutputTokens: number, taskId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  const budget = await getTodaysBudget();
  const estimatedCost = calculateCost(model, estimatedInputTokens, estimatedOutputTokens);
  if (budget.totalCost + estimatedCost > BUDGET_LIMITS.globalDaily) {
    return { allowed: false, reason: \`Global daily budget exceeded (\$\${budget.totalCost.toFixed(2)} / \$\${BUDGET_LIMITS.globalDaily})\` };
  }
  const personaCost = budget.byPersona[personaId] || 0;
  if (personaCost + estimatedCost > BUDGET_LIMITS.perPersona) {
    return { allowed: false, reason: \`Persona budget exceeded for \${personaId} (\$\${personaCost.toFixed(2)} / \$\${BUDGET_LIMITS.perPersona})\` };
  }
  if (taskId) {
    const taskCost = budget.byTask[taskId] || 0;
    if (taskCost + estimatedCost > BUDGET_LIMITS.perTicket) {
      return { allowed: false, reason: \`Task budget exceeded for \${taskId} (\$\${taskCost.toFixed(2)} / \$\${BUDGET_LIMITS.perTicket})\` };
    }
  }
  return { allowed: true };
}

export async function recordUsage(
  personaId: string, model: string, inputTokens: number, outputTokens: number, taskId?: string
): Promise<void> {
  const budget = await getTodaysBudget();
  const cost = calculateCost(model, inputTokens, outputTokens);
  budget.entries.push({ timestamp: new Date(), taskId, personaId, model, inputTokens, outputTokens, cost });
  budget.totalCost += cost;
  budget.byPersona[personaId] = (budget.byPersona[personaId] || 0) + cost;
  if (taskId) budget.byTask[taskId] = (budget.byTask[taskId] || 0) + cost;
  await saveBudget(budget);
  console.log(\`💰 Budget: \${personaId} used \$\${cost.toFixed(4)} (\${inputTokens}/\${outputTokens} tokens)\`);
}

export async function getBudgetStatus() {
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
}

export async function archiveTodaysBudget(): Promise<void> {
  const budget = await getTodaysBudget();
  await fs.writeFile(path.join(BUDGET_DIR, \`daily-budget-\${budget.date}.json\`), JSON.stringify(budget, null, 2));
  console.log(\`📦 Archived budget for \${budget.date}: \$\${budget.totalCost.toFixed(2)}\`);
}
