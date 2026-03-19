import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  recordTokenUsage,
  getPersonaBudgetStatus,
  isPersonaPaused,
  resetMonthlyBudgets,
  initializeBudgetStorage
} from './collaboration-budget.js';

const BUDGET_DIR = path.join(os.homedir(), '.tix-kanban', 'budgets');
const MONTHLY_BUDGET_FILE = path.join(BUDGET_DIR, 'monthly-budget.json');

describe('Token Budget System', () => {
  beforeEach(async () => {
    // Clean up test data before each test
    try {
      await fs.unlink(MONTHLY_BUDGET_FILE);
    } catch {
      // File might not exist, that's fine
    }
    await initializeBudgetStorage();
  });

  it('should record token usage for a persona', async () => {
    await recordTokenUsage('test-persona', 1000, 2000, 10000);
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status).not.toBeNull();
    expect(status?.tokensUsed).toBe(3000);
    expect(status?.tokenLimit).toBe(10000);
    expect(status?.percentage).toBe(30);
    expect(status?.paused).toBe(false);
  });

  it('should pause persona when budget exceeded', async () => {
    await recordTokenUsage('test-persona', 5000, 6000, 10000);
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status?.tokensUsed).toBe(11000);
    expect(status?.paused).toBe(true);
    
    const paused = await isPersonaPaused('test-persona');
    expect(paused).toBe(true);
  });

  it('should not pause if no limit set', async () => {
    await recordTokenUsage('test-persona', 10000, 20000, 0); // 0 = unlimited
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status?.tokensUsed).toBe(30000);
    expect(status?.paused).toBe(false);
  });

  it('should reset monthly budgets', async () => {
    await recordTokenUsage('test-persona', 5000, 5000, 20000);
    await resetMonthlyBudgets();
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status).toBeNull(); // Budget reset, no entry for this persona
  });

  it('should calculate percentage correctly', async () => {
    await recordTokenUsage('test-persona', 4000, 4000, 10000);
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status?.percentage).toBe(80);
  });

  it('should handle multiple personas independently', async () => {
    await recordTokenUsage('persona-a', 3000, 3000, 10000);
    await recordTokenUsage('persona-b', 1000, 1000, 5000);
    
    const statusA = await getPersonaBudgetStatus('persona-a');
    const statusB = await getPersonaBudgetStatus('persona-b');
    
    expect(statusA?.tokensUsed).toBe(6000);
    expect(statusA?.percentage).toBe(60);
    expect(statusB?.tokensUsed).toBe(2000);
    expect(statusB?.percentage).toBe(40);
  });

  it('should accumulate token usage over multiple calls', async () => {
    await recordTokenUsage('test-persona', 1000, 1000, 10000);
    await recordTokenUsage('test-persona', 2000, 2000, 10000);
    await recordTokenUsage('test-persona', 1000, 1000, 10000);
    
    const status = await getPersonaBudgetStatus('test-persona');
    expect(status?.tokensUsed).toBe(8000);
    expect(status?.percentage).toBe(80);
  });
});
