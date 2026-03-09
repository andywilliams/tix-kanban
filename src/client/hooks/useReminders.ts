import { useState, useEffect, useCallback } from 'react';

export interface ReminderRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  target: 'ticket' | 'pr' | 'backlog';
  conditions: RuleCondition[];
  action: RuleAction;
  cooldown: string;
  createdAt: Date;
  updatedAt: Date;
  isBuiltin?: boolean;
  inCooldown?: boolean; // Added by API
}

export interface RuleCondition {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'not_contains' | 'in' | 'not_in';
  value: string | number | string[];
}

export interface RuleAction {
  type: 'slack' | 'console';
  channel?: string;
  template: string;
}

export interface ReminderHistory {
  id: string;
  ruleId: string;
  ruleName: string;
  entityId: string;
  entityTitle: string;
  message: string;
  triggeredAt: Date;
}

export interface EvaluationResult {
  rulesChecked: number;
  remindersTriggered: number;
  errors: string[];
}

export function useReminders() {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [history, setHistory] = useState<ReminderHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  // Fetch rules
  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/reminders/rules');
      if (!response.ok) throw new Error('Failed to fetch rules');
      const data = await response.json();
      setRules(data.rules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rules');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders/history');
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = await response.json();
      setHistory(data.history);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  }, []);

  // Create rule
  const createRule = useCallback(async (rule: Omit<ReminderRule, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const response = await fetch('/api/reminders/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!response.ok) throw new Error('Failed to create rule');
      const data = await response.json();
      setRules(prev => [...prev, data.rule]);
      return data.rule;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to create rule');
    }
  }, []);

  // Update rule
  const updateRule = useCallback(async (id: string, updates: Partial<ReminderRule>) => {
    try {
      const response = await fetch(`/api/reminders/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update rule');
      const data = await response.json();
      setRules(prev => prev.map(r => r.id === id ? data.rule : r));
      return data.rule;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to update rule');
    }
  }, []);

  // Delete rule
  const deleteRule = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/reminders/rules/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete rule');
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to delete rule');
    }
  }, []);

  // Toggle rule enabled/disabled
  const toggleRule = useCallback(async (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    return updateRule(id, { enabled: !rule.enabled });
  }, [rules, updateRule]);

  // Evaluate rules (dry run or real)
  const evaluateRules = useCallback(async (dryRun = true): Promise<EvaluationResult> => {
    try {
      setEvaluating(true);
      const response = await fetch('/api/reminders/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      if (!response.ok) throw new Error('Failed to evaluate rules');
      const result = await response.json();

      // Refresh history if not a dry run
      if (!dryRun) {
        await fetchHistory();
      }

      return result;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to evaluate rules');
    } finally {
      setEvaluating(false);
    }
  }, [fetchHistory]);

  // Reset cooldowns
  const resetCooldowns = useCallback(async (ruleId?: string) => {
    try {
      const url = ruleId
        ? `/api/reminders/cooldowns/reset/${ruleId}`
        : '/api/reminders/cooldowns/reset';
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset cooldowns');

      // Refresh rules to update cooldown status
      await fetchRules();
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to reset cooldowns');
    }
  }, [fetchRules]);

  // Fetch builtin templates
  const fetchTemplates = useCallback(async (): Promise<ReminderRule[]> => {
    try {
      const response = await fetch('/api/reminders/rules/templates');
      if (!response.ok) throw new Error('Failed to fetch templates');
      const data = await response.json();
      return data.templates;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to fetch templates');
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchRules();
    fetchHistory();
  }, [fetchRules, fetchHistory]);

  return {
    rules,
    history,
    loading,
    error,
    evaluating,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    evaluateRules,
    resetCooldowns,
    fetchTemplates,
    refetch: () => {
      fetchRules();
      fetchHistory();
    },
  };
}