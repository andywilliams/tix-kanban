import React, { useState, useEffect } from 'react';
import '../App.css';

interface ReminderRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  target: 'task' | 'pr' | 'backlog';
  conditions: RuleCondition[];
  action: RuleAction;
  cooldown: string;
  createdAt: string;
  updatedAt: string;
  isBuiltIn?: boolean;
}

interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains';
  value: any;
}

interface RuleAction {
  type: 'slack' | 'console';
  message: string;
  channel?: string;
}

interface HistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  entityId: string;
  entityTitle?: string;
  message: string;
  triggeredAt: string;
  action: RuleAction;
}

const ReminderRulesPage: React.FC = () => {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ReminderRule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    enabled: true,
    target: 'task' as const,
    conditions: [{ field: '', operator: 'equals' as const, value: '' }],
    action: { type: 'slack' as const, message: '', channel: '' },
    cooldown: '24h'
  });

  // Load rules on mount
  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const response = await fetch('/api/reminder-rules');
      const data = await response.json();
      if (response.ok) {
        setRules(data.rules);
      } else {
        setError(data.error || 'Failed to load rules');
      }
    } catch (error) {
      setError('Failed to load rules');
    }
  };

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/reminder-rules/history');
      const data = await response.json();
      if (response.ok) {
        setHistory(data.history);
      } else {
        setError(data.error || 'Failed to load history');
      }
    } catch (error) {
      setError('Failed to load history');
    }
  };

  const toggleRule = async (rule: ReminderRule) => {
    try {
      const response = await fetch(`/api/reminder-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      });

      if (response.ok) {
        await loadRules();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to toggle rule');
      }
    } catch (error) {
      setError('Failed to toggle rule');
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    try {
      const response = await fetch(`/api/reminder-rules/${ruleId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadRules();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete rule');
      }
    } catch (error) {
      setError('Failed to delete rule');
    }
  };

  const createOrUpdateRule = async () => {
    setLoading(true);
    setError('');

    try {
      const method = editingRule ? 'PUT' : 'POST';
      const url = editingRule
        ? `/api/reminder-rules/${editingRule.id}`
        : '/api/reminder-rules';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        await loadRules();
        resetForm();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save rule');
      }
    } catch (error) {
      setError('Failed to save rule');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      enabled: true,
      target: 'task',
      conditions: [{ field: '', operator: 'equals', value: '' }],
      action: { type: 'slack', message: '', channel: '' },
      cooldown: '24h'
    });
    setShowCreateForm(false);
    setEditingRule(null);
  };

  const startEdit = (rule: ReminderRule) => {
    if (rule.isBuiltIn) {
      setError('Cannot edit built-in rules');
      return;
    }

    setFormData({
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      target: rule.target,
      conditions: rule.conditions.map(c => ({ ...c })),
      action: { ...rule.action },
      cooldown: rule.cooldown
    });
    setEditingRule(rule);
    setShowCreateForm(true);
  };

  const evaluateRules = async (dryRun: boolean) => {
    setLoading(true);
    try {
      const response = await fetch('/api/reminder-rules/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun })
      });

      if (response.ok) {
        alert(dryRun ? 'Dry run completed. Check console for results.' : 'Rules evaluated successfully');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to evaluate rules');
      }
    } catch (error) {
      setError('Failed to evaluate rules');
    } finally {
      setLoading(false);
    }
  };

  const clearCooldowns = async () => {
    if (!confirm('Are you sure you want to clear all cooldowns? This will allow rules to trigger again immediately.')) return;

    try {
      const response = await fetch('/api/reminder-rules/clear-cooldowns', {
        method: 'POST'
      });

      if (response.ok) {
        alert('Cooldowns cleared successfully');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to clear cooldowns');
      }
    } catch (error) {
      setError('Failed to clear cooldowns');
    }
  };

  const formatCondition = (condition: RuleCondition) => {
    return `${condition.field} ${condition.operator.replace('_', ' ')} ${condition.value}`;
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Reminder Rules</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowCreateForm(true)}
            className="primary-button"
          >
            Create Rule
          </button>
          <button
            onClick={() => evaluateRules(false)}
            disabled={loading}
          >
            Run Now
          </button>
          <button
            onClick={() => evaluateRules(true)}
            disabled={loading}
          >
            Dry Run
          </button>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory && history.length === 0) {
                loadHistory();
              }
            }}
          >
            {showHistory ? 'Show Rules' : 'Show History'}
          </button>
          <button
            onClick={clearCooldowns}
            style={{ marginLeft: 'auto' }}
          >
            Clear Cooldowns
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message" style={{ margin: '10px 0' }}>
          {error}
        </div>
      )}

      {showCreateForm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && resetForm()}>
          <div className="modal" style={{ maxWidth: '600px' }}>
            <h2>{editingRule ? 'Edit Rule' : 'Create Rule'}</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input
                type="text"
                placeholder="Rule name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />

              <textarea
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />

              <select
                value={formData.target}
                onChange={(e) => setFormData({ ...formData, target: e.target.value as any })}
              >
                <option value="task">Task</option>
                <option value="pr">Pull Request</option>
                <option value="backlog">Backlog</option>
              </select>

              <div>
                <h4>Conditions</h4>
                {formData.conditions.map((condition, index) => (
                  <div key={index} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                    <input
                      type="text"
                      placeholder="Field"
                      value={condition.field}
                      onChange={(e) => {
                        const newConditions = formData.conditions.map((c, i) =>
                          i === index ? { ...c, field: e.target.value } : c
                        );
                        setFormData({ ...formData, conditions: newConditions });
                      }}
                      style={{ flex: 1 }}
                    />
                    <select
                      value={condition.operator}
                      onChange={(e) => {
                        const newConditions = formData.conditions.map((c, i) =>
                          i === index ? { ...c, operator: e.target.value as any } : c
                        );
                        setFormData({ ...formData, conditions: newConditions });
                      }}
                    >
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="greater_than">greater than</option>
                      <option value="less_than">less than</option>
                      <option value="contains">contains</option>
                      <option value="not_contains">not contains</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Value"
                      value={condition.value}
                      onChange={(e) => {
                        const newConditions = formData.conditions.map((c, i) =>
                          i === index ? { ...c, value: e.target.value } : c
                        );
                        setFormData({ ...formData, conditions: newConditions });
                      }}
                      style={{ flex: 1 }}
                    />
                    {formData.conditions.length > 1 && (
                      <button
                        onClick={() => {
                          const newConditions = formData.conditions.filter((_, i) => i !== index);
                          setFormData({ ...formData, conditions: newConditions });
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => {
                    setFormData({
                      ...formData,
                      conditions: [...formData.conditions, { field: '', operator: 'equals', value: '' }]
                    });
                  }}
                  style={{ marginTop: '5px' }}
                >
                  Add Condition
                </button>
              </div>

              <div>
                <h4>Action</h4>
                <select
                  value={formData.action.type}
                  onChange={(e) => setFormData({
                    ...formData,
                    action: { ...formData.action, type: e.target.value as any }
                  })}
                >
                  <option value="slack">Slack</option>
                  <option value="console">Console</option>
                </select>

                {formData.action.type === 'slack' && (
                  <input
                    type="text"
                    placeholder="Channel (optional, e.g. #general)"
                    value={formData.action.channel || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      action: { ...formData.action, channel: e.target.value }
                    })}
                    style={{ marginTop: '5px' }}
                  />
                )}

                <textarea
                  placeholder="Message template (use {field} for placeholders)"
                  value={formData.action.message}
                  onChange={(e) => setFormData({
                    ...formData,
                    action: { ...formData.action, message: e.target.value }
                  })}
                  rows={3}
                  style={{ marginTop: '5px' }}
                />
              </div>

              <div>
                <label>
                  Cooldown:
                  <input
                    type="text"
                    value={formData.cooldown}
                    onChange={(e) => setFormData({ ...formData, cooldown: e.target.value })}
                    placeholder="e.g. 24h, 7d, 1w"
                    style={{ marginLeft: '10px', width: '100px' }}
                  />
                </label>
              </div>

              <label>
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                />
                Enabled
              </label>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={resetForm}>Cancel</button>
                <button
                  onClick={createOrUpdateRule}
                  disabled={loading || !formData.name || !formData.description}
                  className="primary-button"
                >
                  {editingRule ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!showHistory ? (
        <div style={{ marginTop: '20px' }}>
          {rules.length === 0 ? (
            <p>No rules configured</p>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className="task-card" style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: '0 0 5px 0' }}>
                      {rule.name}
                      {rule.isBuiltIn && <span style={{ fontSize: '12px', marginLeft: '10px', color: '#666' }}>(Built-in)</span>}
                    </h3>
                    <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>{rule.description}</p>

                    <div style={{ fontSize: '12px', marginBottom: '5px' }}>
                      <strong>Target:</strong> {rule.target} |
                      <strong> Cooldown:</strong> {rule.cooldown} |
                      <strong> Action:</strong> {rule.action.type}
                      {rule.action.channel && ` to ${rule.action.channel}`}
                    </div>

                    <div style={{ fontSize: '12px', marginBottom: '5px' }}>
                      <strong>Conditions:</strong> {rule.conditions.map(c => formatCondition(c)).join(' AND ')}
                    </div>

                    <div style={{ fontSize: '12px' }}>
                      <strong>Message:</strong> {rule.action.message}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button
                      onClick={() => toggleRule(rule)}
                      className={rule.enabled ? 'danger-button' : 'primary-button'}
                      style={{ fontSize: '12px', padding: '4px 8px' }}
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {!rule.isBuiltIn && (
                      <>
                        <button
                          onClick={() => startEdit(rule)}
                          style={{ fontSize: '12px', padding: '4px 8px' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="danger-button"
                          style={{ fontSize: '12px', padding: '4px 8px' }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ marginTop: '20px' }}>
          {history.length === 0 ? (
            <p>No reminder history</p>
          ) : (
            history.slice().reverse().map(entry => (
              <div key={entry.id} className="task-card" style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', marginBottom: '5px', color: '#666' }}>
                  {new Date(entry.triggeredAt).toLocaleString()} - {entry.ruleName}
                </div>
                <div style={{ fontSize: '14px' }}>
                  {entry.message}
                </div>
                {entry.entityTitle && (
                  <div style={{ fontSize: '12px', marginTop: '5px', color: '#666' }}>
                    Entity: {entry.entityTitle}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ReminderRulesPage;