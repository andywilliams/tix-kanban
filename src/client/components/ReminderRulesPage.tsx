import React, { useState, useEffect } from 'react';
import { ReminderRule } from '../types/reminder';

export function ReminderRulesPage() {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ReminderRule | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const response = await fetch('/api/reminders/rules');
      if (!response.ok) throw new Error('Failed to load rules');
      const data = await response.json();
      setRules(data.rules);
      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/reminders/history?limit=50');
      if (!response.ok) throw new Error('Failed to load history');
      const data = await response.json();
      setHistory(data.history);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  const toggleRule = async (rule: ReminderRule) => {
    try {
      const response = await fetch(`/api/reminders/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      });
      if (!response.ok) throw new Error('Failed to toggle rule');
      await loadRules();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!window.confirm('Delete this reminder rule?')) return;

    try {
      const response = await fetch(`/api/reminders/rules/${ruleId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete rule');
      await loadRules();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const evaluateRules = async (dryRun: boolean) => {
    try {
      setEvaluating(true);
      const response = await fetch('/api/reminders/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun })
      });
      if (!response.ok) throw new Error('Failed to evaluate rules');
      const results = await response.json();
      alert(
        `Rules evaluated: ${results.rulesChecked}\n` +
        `Reminders triggered: ${results.remindersTriggered}\n` +
        (results.errors.length > 0 ? `Errors: ${results.errors.length}` : '')
      );
    } catch (err) {
      console.error('Failed to evaluate rules:', err);
    } finally {
      setEvaluating(false);
    }
  };

  const resetCooldowns = async (ruleId?: string) => {
    const endpoint = ruleId
      ? `/api/reminders/cooldowns/reset/${ruleId}`
      : '/api/reminders/cooldowns/reset';

    try {
      const response = await fetch(endpoint, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reset cooldowns');
      await loadRules();
    } catch (err) {
      console.error('Failed to reset cooldowns:', err);
    }
  };

  if (loading) {
    return (
      <div className="reminders-loading">
        <div className="spinner" />
        <p>Loading reminder rules...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reminders-error">
        <p>Error: {error}</p>
        <button onClick={loadRules}>Retry</button>
      </div>
    );
  }

  if (showHistory) {
    return (
      <div className="reminders-container">
        <div className="reminders-header">
          <h1>🔔 Reminder History</h1>
          <button className="secondary-button" onClick={() => setShowHistory(false)}>
            Back to Rules
          </button>
        </div>
        <div className="history-list">
          {history.length === 0 ? (
            <p>No reminders have been triggered yet.</p>
          ) : (
            history.map(entry => (
              <div key={entry.id} className="history-entry">
                <div className="history-time">
                  {new Date(entry.triggeredAt).toLocaleString()}
                </div>
                <div className="history-rule">{entry.ruleName}</div>
                <div className="history-message">{entry.message}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="reminders-container">
      <div className="reminders-header">
        <h1>🔔 Reminder Rules</h1>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => { loadHistory(); setShowHistory(true); }}
          >
            View History
          </button>
          <button
            className="secondary-button"
            onClick={() => resetCooldowns()}
          >
            Reset All Cooldowns
          </button>
          <button
            className="secondary-button"
            onClick={() => evaluateRules(true)}
            disabled={evaluating}
          >
            Test Rules (Dry Run)
          </button>
          <button
            className="primary-button"
            onClick={() => evaluateRules(false)}
            disabled={evaluating}
          >
            Run Rules Now
          </button>
        </div>
      </div>

      <div className="rules-list">
        {rules.map(rule => (
          <div key={rule.id} className={`rule-card ${!rule.enabled ? 'disabled' : ''}`}>
            <div className="rule-header">
              <h3>{rule.name}</h3>
              <div className="rule-actions">
                <button
                  className="toggle-button"
                  onClick={() => toggleRule(rule)}
                >
                  {rule.enabled ? '✓ Enabled' : '○ Disabled'}
                </button>
                {rule.hasActiveCooldowns && (
                  <button
                    className="reset-cooldown-button"
                    onClick={() => resetCooldowns(rule.id)}
                    title="Reset cooldowns for this rule"
                  >
                    🔄
                  </button>
                )}
                {!rule.isBuiltin && (
                  <button
                    className="delete-button"
                    onClick={() => deleteRule(rule.id)}
                  >
                    🗑️
                  </button>
                )}
              </div>
            </div>
            <p className="rule-description">{rule.description}</p>
            <div className="rule-details">
              <span className="rule-target">Target: {rule.target}</span>
              <span className="rule-cooldown">Cooldown: {rule.cooldown}</span>
              {rule.isBuiltin && <span className="builtin-badge">Built-in</span>}
            </div>
            <div className="rule-conditions">
              <strong>Conditions:</strong>
              <ul>
                {rule.conditions.map((condition, i) => (
                  <li key={i}>
                    {condition.field} {condition.operator} {
                      Array.isArray(condition.value)
                        ? condition.value.join(', ')
                        : condition.value
                    }
                  </li>
                ))}
              </ul>
            </div>
            <div className="rule-action">
              <strong>Action:</strong> {rule.action.type}
              {rule.action.channel && ` → ${rule.action.channel}`}
              <div className="action-template">{rule.action.template}</div>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .reminders-container {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .reminders-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }

        .reminders-header h1 {
          margin: 0;
          font-size: 28px;
        }

        .header-actions {
          display: flex;
          gap: 10px;
        }

        .reminders-loading,
        .reminders-error {
          text-align: center;
          padding: 50px;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .rules-list {
          display: grid;
          gap: 20px;
        }

        .rule-card {
          background: var(--card-background, #ffffff);
          border: 1px solid var(--border-color, #e0e0e0);
          border-radius: 8px;
          padding: 20px;
          transition: all 0.2s;
        }

        .rule-card.disabled {
          opacity: 0.6;
        }

        .rule-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .rule-header h3 {
          margin: 0;
          font-size: 20px;
        }

        .rule-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .rule-description {
          color: var(--text-secondary, #666);
          margin-bottom: 15px;
        }

        .rule-details {
          display: flex;
          gap: 20px;
          margin-bottom: 15px;
          font-size: 14px;
        }

        .rule-details span {
          padding: 4px 8px;
          background: var(--tag-background, #f0f0f0);
          border-radius: 4px;
        }

        .builtin-badge {
          background: var(--primary-color, #4a90e2);
          color: white;
        }

        .rule-conditions,
        .rule-action {
          margin-top: 15px;
        }

        .rule-conditions ul {
          margin: 5px 0 0 20px;
          padding: 0;
        }

        .action-template {
          margin-top: 5px;
          padding: 10px;
          background: var(--code-background, #f5f5f5);
          border-radius: 4px;
          font-family: monospace;
          font-size: 13px;
        }

        .toggle-button {
          background: none;
          border: 1px solid var(--border-color, #e0e0e0);
          padding: 5px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toggle-button:hover {
          background: var(--hover-background, #f5f5f5);
        }

        .reset-cooldown-button,
        .delete-button {
          background: none;
          border: none;
          font-size: 16px;
          cursor: pointer;
          padding: 4px;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .reset-cooldown-button:hover,
        .delete-button:hover {
          opacity: 1;
        }

        .primary-button,
        .secondary-button {
          padding: 8px 16px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .primary-button {
          background: var(--primary-color, #4a90e2);
          color: white;
        }

        .primary-button:hover:not(:disabled) {
          background: var(--primary-hover, #357abd);
        }

        .secondary-button {
          background: var(--secondary-background, #f0f0f0);
          color: var(--text-primary, #333);
        }

        .secondary-button:hover {
          background: var(--secondary-hover, #e0e0e0);
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* History styles */
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .history-entry {
          background: var(--card-background, #ffffff);
          border: 1px solid var(--border-color, #e0e0e0);
          border-radius: 4px;
          padding: 12px;
        }

        .history-time {
          font-size: 12px;
          color: var(--text-secondary, #666);
          margin-bottom: 5px;
        }

        .history-rule {
          font-weight: bold;
          margin-bottom: 5px;
        }

        .history-message {
          font-size: 14px;
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .rule-card {
            background: var(--card-background, #1e1e1e);
            border-color: var(--border-color, #333);
          }

          .action-template {
            background: var(--code-background, #2a2a2a);
          }

          .rule-details span {
            background: var(--tag-background, #333);
          }
        }
      `}</style>
    </div>
  );
}